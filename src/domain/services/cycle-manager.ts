import { join } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { CycleSchema } from '@domain/types/cycle.js';
import type { Cycle, Budget, BudgetStatus, BudgetAlertLevel } from '@domain/types/cycle.js';
import { BetSchema, BetOutcome } from '@domain/types/bet.js';
import type { Bet } from '@domain/types/bet.js';
import type { CycleState } from '@domain/types/cycle.js';
import { CycleNotFoundError } from '@shared/lib/errors.js';
import { validateAppetite } from '@domain/rules/budget-rules.js';
import { calculateUtilization } from '@domain/rules/budget-rules.js';

export interface CooldownReport {
  cycleId: string;
  cycleName?: string;
  budget: Budget;
  tokensUsed: number;
  utilizationPercent: number;
  alertLevel?: BudgetAlertLevel;
  bets: CooldownBetReport[];
  completionRate: number;
  summary: string;
}

export interface CooldownBetReport {
  betId: string;
  description: string;
  appetite: number;
  outcome: string;
  outcomeNotes?: string;
  pipelineCount: number;
}

/**
 * Manages development cycles (time-boxed work periods with budgets and bets).
 * Persists cycles as individual JSON files in the basePath directory.
 */
export class CycleManager {
  private readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    JsonStore.ensureDir(basePath);
  }

  /**
   * Create a new cycle with a budget and optional name.
   */
  create(budget: Budget, name?: string): Cycle {
    const now = new Date().toISOString();
    const cycle: Cycle = {
      id: crypto.randomUUID(),
      name,
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

  /**
   * Retrieve a cycle by ID. Throws CycleNotFoundError if missing.
   */
  get(cycleId: string): Cycle {
    const path = this.cyclePath(cycleId);
    if (!JsonStore.exists(path)) {
      throw new CycleNotFoundError(cycleId);
    }
    return JsonStore.read(path, CycleSchema);
  }

  /**
   * List all cycles.
   */
  list(): Cycle[] {
    return JsonStore.list(this.basePath, CycleSchema);
  }

  /**
   * Add a bet to a cycle. Generates UUID for the bet.
   * Validates that total appetite (all bets + cooldown reserve) does not exceed 100%.
   */
  addBet(cycleId: string, bet: Omit<Bet, 'id'>): Cycle {
    const cycle = this.get(cycleId);

    const newBet: Bet = {
      ...BetSchema.parse({
        ...bet,
        id: crypto.randomUUID(),
      }),
    };

    // Validate appetite before adding
    const allBets = [...cycle.bets, newBet];
    const validation = validateAppetite(allBets, cycle.cooldownReserve);
    if (!validation.valid) {
      throw new Error(
        `Cannot add bet: ${validation.errors.join('; ')}`,
      );
    }

    cycle.bets.push(newBet);
    cycle.updatedAt = new Date().toISOString();
    this.save(cycle);
    return cycle;
  }

  /**
   * Link a pipeline execution to a bet within a cycle.
   */
  mapPipeline(cycleId: string, betId: string, pipelineId: string): Cycle {
    const cycle = this.get(cycleId);

    // Verify the bet exists in this cycle
    const bet = cycle.bets.find((b) => b.id === betId);
    if (!bet) {
      throw new Error(`Bet "${betId}" not found in cycle "${cycleId}"`);
    }

    cycle.pipelineMappings.push({ pipelineId, betId });
    cycle.updatedAt = new Date().toISOString();
    this.save(cycle);
    return cycle;
  }

  /**
   * Calculate current budget utilization.
   * Includes per-bet breakdown and alert level.
   */
  getBudgetStatus(cycleId: string): BudgetStatus {
    const cycle = this.get(cycleId);

    // For now, tokensUsed is tracked externally via TokenTracker.
    // This method computes the structure; callers provide actual usage.
    const tokensUsed = 0;
    const { percent, alertLevel } = calculateUtilization(cycle.budget, tokensUsed);

    const perBet = cycle.bets.map((bet) => {
      const allocated = cycle.budget.tokenBudget
        ? Math.round((bet.appetite / 100) * cycle.budget.tokenBudget)
        : 0;
      return {
        betId: bet.id,
        allocated,
        used: 0,
        utilizationPercent: 0,
      };
    });

    return {
      cycleId,
      budget: cycle.budget,
      tokensUsed,
      utilizationPercent: percent,
      alertLevel,
      perBet,
    };
  }

  /**
   * Update bet outcomes on a cycle. Skips unknown betIds and returns the list of unmatched IDs.
   */
  updateBetOutcomes(
    cycleId: string,
    outcomes: Array<{ betId: string; outcome: string; notes?: string }>,
  ): { cycle: Cycle; unmatchedBetIds: string[] } {
    const cycle = this.get(cycleId);
    const unmatchedBetIds: string[] = [];

    for (const record of outcomes) {
      const parsed = BetOutcome.safeParse(record.outcome);
      if (!parsed.success) {
        throw new Error(`Invalid bet outcome "${record.outcome}". Must be one of: pending, complete, partial, abandoned`);
      }

      const bet = cycle.bets.find((b) => b.id === record.betId);
      if (bet) {
        bet.outcome = parsed.data;
        if (record.notes) {
          bet.outcomeNotes = record.notes;
        }
      } else {
        unmatchedBetIds.push(record.betId);
      }
    }

    if (unmatchedBetIds.length === outcomes.length && outcomes.length > 0) {
      return { cycle, unmatchedBetIds };
    }

    cycle.updatedAt = new Date().toISOString();
    this.save(cycle);
    return { cycle, unmatchedBetIds };
  }

  /**
   * Transition cycle state.
   */
  updateState(cycleId: string, state: CycleState): Cycle {
    const cycle = this.get(cycleId);
    cycle.state = state;
    cycle.updatedAt = new Date().toISOString();
    this.save(cycle);
    return cycle;
  }

  /**
   * Generate a cooldown report for the cycle.
   */
  generateCooldown(cycleId: string): CooldownReport {
    const cycle = this.get(cycleId);

    const { percent, alertLevel } = calculateUtilization(cycle.budget, 0);

    const bets: CooldownBetReport[] = cycle.bets.map((bet) => ({
      betId: bet.id,
      description: bet.description,
      appetite: bet.appetite,
      outcome: bet.outcome,
      outcomeNotes: bet.outcomeNotes,
      pipelineCount: cycle.pipelineMappings.filter((m) => m.betId === bet.id).length,
    }));

    const completedBets = cycle.bets.filter((b) => b.outcome === 'complete').length;
    const totalBets = cycle.bets.length;
    const completionRate = totalBets > 0 ? (completedBets / totalBets) * 100 : 0;

    const summary = buildCooldownSummary(cycle, completionRate, bets);

    return {
      cycleId,
      cycleName: cycle.name,
      budget: cycle.budget,
      tokensUsed: 0,
      utilizationPercent: percent,
      alertLevel,
      bets,
      completionRate,
      summary,
    };
  }

  private cyclePath(cycleId: string): string {
    return join(this.basePath, `${cycleId}.json`);
  }

  private save(cycle: Cycle): void {
    JsonStore.write(this.cyclePath(cycle.id), cycle, CycleSchema);
  }
}

function buildCooldownSummary(
  cycle: Cycle,
  completionRate: number,
  bets: CooldownBetReport[],
): string {
  const lines: string[] = [];
  lines.push(`Cycle: ${cycle.name ?? cycle.id}`);
  lines.push(`State: ${cycle.state}`);
  lines.push(`Bets: ${bets.length}`);
  lines.push(`Completion rate: ${completionRate.toFixed(1)}%`);

  if (cycle.budget.tokenBudget) {
    lines.push(`Token budget: ${cycle.budget.tokenBudget.toLocaleString()}`);
  }
  if (cycle.budget.timeBudget) {
    lines.push(`Time budget: ${cycle.budget.timeBudget}`);
  }

  const outcomes = bets.reduce<Record<string, number>>((acc, bet) => {
    acc[bet.outcome] = (acc[bet.outcome] ?? 0) + 1;
    return acc;
  }, {});

  for (const [outcome, count] of Object.entries(outcomes)) {
    lines.push(`  ${outcome}: ${count}`);
  }

  return lines.join('\n');
}
