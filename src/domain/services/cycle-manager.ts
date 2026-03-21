import { join } from 'node:path';
import type { IPersistence } from '@domain/ports/persistence.js';
import { CycleSchema } from '@domain/types/cycle.js';
import type { Cycle, Budget, BudgetStatus, CycleState } from '@domain/types/cycle.js';
import type { CooldownReport } from '@domain/types/cooldown.js';
import type { Bet, KataAssignment } from '@domain/types/bet.js';
import { CycleNotFoundError, KataError } from '@shared/lib/errors.js';
import { calculateUtilization } from '@domain/rules/budget-rules.js';
import { canTransitionCycleState } from '@domain/rules/cycle-rules.js';
import { createBet, requireBet, trySetBetOutcome, applyBetOutcomes } from '@domain/rules/bet-rules.js';
import { normalizeCycleName } from '@domain/services/cycle-name.js';
import { generateCooldownReport } from '@domain/services/cooldown-reporter.js';

function requireCycleNameForActivation(cycle: Cycle, name: string | undefined): string {
  const resolvedName = normalizeCycleName(name) ?? normalizeCycleName(cycle.name);
  if (!resolvedName) {
    throw new KataError(
      `Cannot transition cycle "${cycle.id}" from "planning" to "active": cycle name is required before activation.`,
    );
  }
  return resolvedName;
}

// Re-export for backwards compatibility — consumers import from here
export type { CooldownReport, CooldownBetReport } from '@domain/types/cooldown.js';

/**
 * Manages development cycles (time-boxed work periods with budgets and bets).
 * Persists cycles as individual JSON files in the basePath directory.
 */
export class CycleManager {
  private readonly basePath: string;
  private readonly persistence: IPersistence;

  constructor(basePath: string, persistence: IPersistence) {
    this.basePath = basePath;
    this.persistence = persistence;
    this.persistence.ensureDir(basePath);
  }

  // --- Cycle CRUD ---

  create(budget: Budget, name?: string): Cycle {
    const now = new Date().toISOString();
    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name: normalizeCycleName(name),
      budget,
      bets: [],
      pipelineMappings: [],
      state: 'planning',
      cooldownReserve: 10,
      createdAt: now,
      updatedAt: now,
    };
    this.save(cycle);
    return cycle;
  }

  get(cycleId: string): Cycle {
    const path = this.cyclePath(cycleId);
    if (!this.persistence.exists(path)) {
      throw new CycleNotFoundError(cycleId);
    }
    return this.persistence.read(path, CycleSchema);
  }

  list(): Cycle[] {
    return this.persistence.list(this.basePath, CycleSchema);
  }

  deleteCycle(cycleId: string): void {
    const cycle = this.get(cycleId);
    if (cycle.state !== 'planning') {
      throw new Error(
        `Cannot delete cycle "${cycleId}": cycle is in state "${cycle.state}". Only planning-state cycles can be deleted.`,
      );
    }
    this.persistence.delete(this.cyclePath(cycleId));
  }

  // --- Bet operations ---

  addBet(cycleId: string, bet: Omit<Bet, 'id'>): Cycle {
    const cycle = this.get(cycleId);
    const newBet = createBet(cycle, bet);
    cycle.bets.push(newBet);
    return this.touch(cycle);
  }

  setRunId(cycleId: string, betId: string, runId: string): Cycle {
    const cycle = this.get(cycleId);
    const bet = requireBet(cycle, betId);
    bet.runId = runId;
    return this.touch(cycle);
  }

  updateBet(cycleId: string, betId: string, updates: { kata: KataAssignment }): Cycle {
    const cycle = this.get(cycleId);
    const bet = requireBet(cycle, betId);
    bet.kata = updates.kata;
    return this.touch(cycle);
  }

  setBetOutcome(cycleId: string, betId: string, outcome: 'complete' | 'partial'): Cycle {
    const cycle = this.get(cycleId);
    const changed = trySetBetOutcome(cycle, betId, outcome);
    if (!changed) return cycle;
    return this.touch(cycle);
  }

  updateBetOutcomes(
    cycleId: string,
    outcomes: Array<{ betId: string; outcome: string; notes?: string }>,
  ): { cycle: Cycle; unmatchedBetIds: string[] } {
    const cycle = this.get(cycleId);
    const unmatchedBetIds = applyBetOutcomes(cycle, outcomes);
    if (unmatchedBetIds.length === outcomes.length && outcomes.length > 0) {
      return { cycle, unmatchedBetIds };
    }
    return { cycle: this.touch(cycle), unmatchedBetIds };
  }

  removeBet(cycleId: string, betId: string): Cycle {
    const cycle = this.get(cycleId);
    if (cycle.state !== 'planning') {
      throw new Error(
        `Cannot remove a bet from cycle "${cycleId}": cycle is in state "${cycle.state}". Only planning cycles support bet removal.`,
      );
    }
    const betIndex = cycle.bets.findIndex((b) => b.id === betId);
    if (betIndex === -1) {
      throw new KataError(`Bet "${betId}" not found in cycle "${cycle.name ?? cycle.id}".`);
    }
    cycle.bets.splice(betIndex, 1);
    return this.touch(cycle);
  }

  findBetCycle(betId: string): { cycle: Cycle; bet: Bet } | null {
    for (const cycle of this.list()) {
      const bet = cycle.bets.find((b) => b.id === betId);
      if (bet) return { cycle, bet };
    }
    return null;
  }

  mapPipeline(cycleId: string, betId: string, pipelineId: string): Cycle {
    const cycle = this.get(cycleId);
    requireBet(cycle, betId);
    cycle.pipelineMappings.push({ pipelineId, betId });
    return this.touch(cycle);
  }

  // --- State transitions ---

  /**
   * Transition cycle state without validation.
   * Use only for error recovery rollbacks and test fixture setup.
   */
  updateState(cycleId: string, state: CycleState): Cycle {
    const cycle = this.get(cycleId);
    cycle.state = state;
    return this.touch(cycle);
  }

  /**
   * Transition cycle state with validation.
   * Enforces: planning → active → cooldown → complete.
   */
  transitionState(cycleId: string, state: CycleState, name?: string): Cycle {
    const cycle = this.get(cycleId);
    const normalizedName = normalizeCycleName(name);

    if (cycle.state === state) {
      return this.renameCycleIfNeeded(cycle, normalizedName);
    }

    this.assertTransitionAllowed(cycle, cycleId, state);
    this.applyTransitionName(cycle, state, normalizedName);
    cycle.state = state;
    return this.touch(cycle);
  }

  startCycle(cycleId: string, name?: string): { cycle: Cycle; betsWithoutKata: string[] } {
    const cycle = this.get(cycleId);
    if (cycle.state !== 'planning') {
      throw new Error(
        `Cannot start cycle "${cycleId}": already in state "${cycle.state}". Only planning cycles can be started.`,
      );
    }
    const betsWithoutKata = cycle.bets
      .filter((b) => !b.kata)
      .map((b) => b.description);
    if (betsWithoutKata.length > 0) {
      return { cycle, betsWithoutKata };
    }
    return { cycle: this.transitionState(cycleId, 'active', name), betsWithoutKata: [] };
  }

  // --- Reporting ---

  getBudgetStatus(cycleId: string): BudgetStatus {
    const cycle = this.get(cycleId);
    const tokensUsed = 0;
    const { percent, alertLevel } = calculateUtilization(cycle.budget, tokensUsed);
    const perBet = cycle.bets.map((bet) => {
      const allocated = cycle.budget.tokenBudget
        ? Math.round((bet.appetite / 100) * cycle.budget.tokenBudget)
        : 0;
      return { betId: bet.id, allocated, used: 0, utilizationPercent: 0 };
    });
    return { cycleId, budget: cycle.budget, tokensUsed, utilizationPercent: percent, alertLevel, perBet };
  }

  generateCooldown(cycleId: string): CooldownReport {
    return generateCooldownReport(this.get(cycleId));
  }

  // --- Private helpers ---

  private cyclePath(cycleId: string): string {
    return join(this.basePath, `${cycleId}.json`);
  }

  private save(cycle: Cycle): void {
    this.persistence.write(this.cyclePath(cycle.id), cycle, CycleSchema);
  }

  private renameCycleIfNeeded(cycle: Cycle, normalizedName: string | undefined): Cycle {
    if (normalizedName !== undefined && cycle.name !== normalizedName) {
      cycle.name = normalizedName;
      return this.touch(cycle);
    }
    return cycle;
  }

  private assertTransitionAllowed(cycle: Cycle, cycleId: string, state: CycleState): void {
    if (!canTransitionCycleState(cycle.state, state)) {
      throw new KataError(
        `Cannot transition cycle "${cycle.name ?? cycleId}" from "${cycle.state}" to "${state}".`,
      );
    }
  }

  private applyTransitionName(cycle: Cycle, state: CycleState, normalizedName: string | undefined): void {
    if (this.requiresActivationName(cycle.state, state)) {
      cycle.name = requireCycleNameForActivation(cycle, normalizedName);
      return;
    }

    if (normalizedName !== undefined) {
      cycle.name = normalizedName;
    }
  }

  private requiresActivationName(currentState: CycleState, nextState: CycleState): boolean {
    return currentState === 'planning' && nextState === 'active';
  }

  /** Update timestamp and persist. Returns the saved cycle. */
  private touch(cycle: Cycle): Cycle {
    cycle.updatedAt = new Date().toISOString();
    this.save(cycle);
    return cycle;
  }
}
