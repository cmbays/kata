import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CycleManager } from './cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { CycleNotFoundError } from '@shared/lib/errors.js';
import type { Budget } from '@domain/types/cycle.js';
import type { Bet } from '@domain/types/bet.js';

let tempDir: string;
let manager: CycleManager;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-cycle-test-'));
  manager = new CycleManager(tempDir, JsonStore);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeBudget(overrides?: Partial<Budget>): Budget {
  return {
    tokenBudget: 2000000,
    timeBudget: '2 weeks',
    ...overrides,
  };
}

function makeBetInput(overrides?: Partial<Omit<Bet, 'id'>>): Omit<Bet, 'id'> {
  return {
    description: 'Test bet',
    appetite: 30,
    issueRefs: [],
    outcome: 'pending',
    ...overrides,
  };
}

describe('CycleManager.create', () => {
  it('creates a cycle with a budget and default state', () => {
    const budget = makeBudget();
    const cycle = manager.create(budget);

    expect(cycle.id).toBeDefined();
    expect(cycle.budget).toEqual(budget);
    expect(cycle.state).toBe('planning');
    expect(cycle.bets).toHaveLength(0);
    expect(cycle.pipelineMappings).toHaveLength(0);
    expect(cycle.cooldownReserve).toBe(10);
    expect(cycle.createdAt).toBeDefined();
    expect(cycle.updatedAt).toBeDefined();
  });

  it('creates a cycle with a name', () => {
    const cycle = manager.create(makeBudget(), 'Sprint 1');
    expect(cycle.name).toBe('Sprint 1');
  });

  it('creates a cycle without a name', () => {
    const cycle = manager.create(makeBudget());
    expect(cycle.name).toBeUndefined();
  });

  it('persists the cycle to disk', () => {
    const cycle = manager.create(makeBudget());
    const retrieved = manager.get(cycle.id);
    expect(retrieved.id).toBe(cycle.id);
  });

  it('generates unique IDs for each cycle', () => {
    const c1 = manager.create(makeBudget());
    const c2 = manager.create(makeBudget());
    expect(c1.id).not.toBe(c2.id);
  });

  it('creates a cycle with only time budget', () => {
    const cycle = manager.create({ timeBudget: '1 week' });
    expect(cycle.budget.tokenBudget).toBeUndefined();
    expect(cycle.budget.timeBudget).toBe('1 week');
  });

  it('creates a cycle with only token budget', () => {
    const cycle = manager.create({ tokenBudget: 500000 });
    expect(cycle.budget.tokenBudget).toBe(500000);
    expect(cycle.budget.timeBudget).toBeUndefined();
  });
});

describe('CycleManager.get', () => {
  it('retrieves a cycle by ID', () => {
    const created = manager.create(makeBudget(), 'My Cycle');
    const retrieved = manager.get(created.id);
    expect(retrieved.id).toBe(created.id);
    expect(retrieved.name).toBe('My Cycle');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    const fakeId = crypto.randomUUID();
    expect(() => manager.get(fakeId)).toThrow(CycleNotFoundError);
  });
});

describe('CycleManager.list', () => {
  it('returns empty array when no cycles exist', () => {
    const cycles = manager.list();
    expect(cycles).toHaveLength(0);
  });

  it('returns all created cycles', () => {
    manager.create(makeBudget(), 'Cycle A');
    manager.create(makeBudget(), 'Cycle B');
    manager.create(makeBudget(), 'Cycle C');

    const cycles = manager.list();
    expect(cycles).toHaveLength(3);
    const names = cycles.map((c) => c.name).sort();
    expect(names).toEqual(['Cycle A', 'Cycle B', 'Cycle C']);
  });
});

describe('CycleManager.addBet', () => {
  it('adds a bet to a cycle', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());

    expect(updated.bets).toHaveLength(1);
    expect(updated.bets[0]!.description).toBe('Test bet');
    expect(updated.bets[0]!.id).toBeDefined();
  });

  it('generates a UUID for the bet', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    expect(updated.bets[0]!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('adds multiple bets to a cycle', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ description: 'Bet 1', appetite: 20 }));
    const updated = manager.addBet(cycle.id, makeBetInput({ description: 'Bet 2', appetite: 30 }));

    expect(updated.bets).toHaveLength(2);
    expect(updated.bets[0]!.description).toBe('Bet 1');
    expect(updated.bets[1]!.description).toBe('Bet 2');
  });

  it('throws error when appetite exceeds available budget', () => {
    const cycle = manager.create(makeBudget());
    // Add bets that total 90% + 10% cooldown = 100%
    manager.addBet(cycle.id, makeBetInput({ appetite: 50 }));
    manager.addBet(cycle.id, makeBetInput({ appetite: 40 }));

    // This should fail: 50 + 40 + 20 + 10 (cooldown) = 120%
    expect(() =>
      manager.addBet(cycle.id, makeBetInput({ appetite: 20 })),
    ).toThrow('Cannot add bet');
  });

  it('allows bets that exactly fill remaining appetite', () => {
    const cycle = manager.create(makeBudget());
    // 50% + 40% + 10% cooldown = 100%
    manager.addBet(cycle.id, makeBetInput({ appetite: 50 }));
    const updated = manager.addBet(cycle.id, makeBetInput({ appetite: 40 }));
    expect(updated.bets).toHaveLength(2);
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() =>
      manager.addBet(crypto.randomUUID(), makeBetInput()),
    ).toThrow(CycleNotFoundError);
  });

  it('persists the bet to disk', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ description: 'Persisted bet' }));

    const retrieved = manager.get(cycle.id);
    expect(retrieved.bets).toHaveLength(1);
    expect(retrieved.bets[0]!.description).toBe('Persisted bet');
  });

  it('updates the updatedAt timestamp', () => {
    const cycle = manager.create(makeBudget());
    const originalUpdatedAt = cycle.updatedAt;

    // Small delay to ensure different timestamp
    const updated = manager.addBet(cycle.id, makeBetInput());
    expect(updated.updatedAt).toBeDefined();
    // Timestamps are ISO strings; they should be >= original
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(originalUpdatedAt).getTime(),
    );
  });
});

describe('CycleManager.mapPipeline', () => {
  it('maps a pipeline to a bet in the cycle', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;
    const pipelineId = crypto.randomUUID();

    const result = manager.mapPipeline(cycle.id, betId, pipelineId);
    expect(result.pipelineMappings).toHaveLength(1);
    expect(result.pipelineMappings[0]).toEqual({ pipelineId, betId });
  });

  it('allows multiple pipeline mappings for the same bet', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    manager.mapPipeline(cycle.id, betId, crypto.randomUUID());
    const result = manager.mapPipeline(cycle.id, betId, crypto.randomUUID());
    expect(result.pipelineMappings).toHaveLength(2);
  });

  it('throws error for nonexistent bet', () => {
    const cycle = manager.create(makeBudget());
    expect(() =>
      manager.mapPipeline(cycle.id, crypto.randomUUID(), crypto.randomUUID()),
    ).toThrow('not found in cycle');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() =>
      manager.mapPipeline(crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()),
    ).toThrow(CycleNotFoundError);
  });
});

describe('CycleManager.getBudgetStatus', () => {
  it('returns budget status for a cycle with no bets', () => {
    const cycle = manager.create(makeBudget());
    const status = manager.getBudgetStatus(cycle.id);

    expect(status.cycleId).toBe(cycle.id);
    expect(status.budget).toEqual(cycle.budget);
    expect(status.tokensUsed).toBe(0);
    expect(status.utilizationPercent).toBe(0);
    expect(status.perBet).toHaveLength(0);
  });

  it('returns per-bet allocation breakdown', () => {
    const cycle = manager.create({ tokenBudget: 1000000 });
    manager.addBet(cycle.id, makeBetInput({ appetite: 40 }));
    manager.addBet(cycle.id, makeBetInput({ appetite: 30 }));

    const status = manager.getBudgetStatus(cycle.id);
    expect(status.perBet).toHaveLength(2);
    expect(status.perBet[0]!.allocated).toBe(400000);
    expect(status.perBet[1]!.allocated).toBe(300000);
  });

  it('returns zero allocation when no token budget set', () => {
    const cycle = manager.create({ timeBudget: '2 weeks' });
    manager.addBet(cycle.id, makeBetInput({ appetite: 50 }));

    const status = manager.getBudgetStatus(cycle.id);
    expect(status.perBet[0]!.allocated).toBe(0);
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() => manager.getBudgetStatus(crypto.randomUUID())).toThrow(
      CycleNotFoundError,
    );
  });
});

describe('CycleManager.updateState', () => {
  it('transitions cycle state to active', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.updateState(cycle.id, 'active');
    expect(updated.state).toBe('active');
  });

  it('transitions cycle state to cooldown', () => {
    const cycle = manager.create(makeBudget());
    manager.updateState(cycle.id, 'active');
    const updated = manager.updateState(cycle.id, 'cooldown');
    expect(updated.state).toBe('cooldown');
  });

  it('transitions cycle state to complete', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.updateState(cycle.id, 'complete');
    expect(updated.state).toBe('complete');
  });

  it('persists state change to disk', () => {
    const cycle = manager.create(makeBudget());
    manager.updateState(cycle.id, 'active');

    const retrieved = manager.get(cycle.id);
    expect(retrieved.state).toBe('active');
  });

  it('updates the updatedAt timestamp', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.updateState(cycle.id, 'active');
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(cycle.updatedAt).getTime(),
    );
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() => manager.updateState(crypto.randomUUID(), 'active')).toThrow(
      CycleNotFoundError,
    );
  });
});

describe('CycleManager.updateBetOutcomes', () => {
  it('updates bet outcomes and persists to disk', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    const result = manager.updateBetOutcomes(cycle.id, [
      { betId, outcome: 'complete', notes: 'Done!' },
    ]);

    expect(result.unmatchedBetIds).toHaveLength(0);
    expect(result.cycle.bets[0]!.outcome).toBe('complete');
    expect(result.cycle.bets[0]!.outcomeNotes).toBe('Done!');

    // Verify persisted
    const reloaded = manager.get(cycle.id);
    expect(reloaded.bets[0]!.outcome).toBe('complete');
  });

  it('returns unmatched bet IDs for nonexistent bets', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput());

    const result = manager.updateBetOutcomes(cycle.id, [
      { betId: 'nonexistent-id', outcome: 'complete' },
    ]);

    expect(result.unmatchedBetIds).toEqual(['nonexistent-id']);
  });

  it('handles mix of matched and unmatched bet IDs', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    const result = manager.updateBetOutcomes(cycle.id, [
      { betId, outcome: 'partial', notes: 'Half done' },
      { betId: 'ghost-bet', outcome: 'abandoned' },
    ]);

    expect(result.unmatchedBetIds).toEqual(['ghost-bet']);
    expect(result.cycle.bets[0]!.outcome).toBe('partial');
  });

  it('skips disk write when all bet IDs are unmatched', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput());
    const originalUpdatedAt = manager.get(cycle.id).updatedAt;

    manager.updateBetOutcomes(cycle.id, [
      { betId: 'fake-1', outcome: 'complete' },
      { betId: 'fake-2', outcome: 'abandoned' },
    ]);

    // updatedAt should not change since no bets were matched
    expect(manager.get(cycle.id).updatedAt).toBe(originalUpdatedAt);
  });

  it('throws for invalid outcome values', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    expect(() =>
      manager.updateBetOutcomes(cycle.id, [
        { betId, outcome: 'invalid-state' },
      ]),
    ).toThrow('Invalid bet outcome "invalid-state"');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() =>
      manager.updateBetOutcomes(crypto.randomUUID(), []),
    ).toThrow(CycleNotFoundError);
  });
});

describe('CycleManager.updateBet', () => {
  it('sets kata assignment on a bet', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    const result = manager.updateBet(cycle.id, betId, {
      kata: { type: 'named', pattern: 'full-feature' },
    });

    expect(result.bets[0]!.kata).toEqual({ type: 'named', pattern: 'full-feature' });
  });

  it('persists the kata assignment to disk', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;

    manager.updateBet(cycle.id, betId, { kata: { type: 'ad-hoc', stages: ['research', 'build'] } });

    const retrieved = manager.get(cycle.id);
    expect(retrieved.bets[0]!.kata).toEqual({ type: 'ad-hoc', stages: ['research', 'build'] });
  });

  it('throws when bet is not found in cycle', () => {
    const cycle = manager.create(makeBudget());
    expect(() =>
      manager.updateBet(cycle.id, crypto.randomUUID(), { kata: { type: 'named', pattern: 'x' } }),
    ).toThrow('not found in cycle');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() =>
      manager.updateBet(crypto.randomUUID(), crypto.randomUUID(), { kata: { type: 'named', pattern: 'x' } }),
    ).toThrow(CycleNotFoundError);
  });
});

describe('CycleManager.findBetCycle', () => {
  it('returns cycle and bet when found', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput({ description: 'Find me' }));
    const betId = updated.bets[0]!.id;

    const result = manager.findBetCycle(betId);
    expect(result).not.toBeNull();
    expect(result!.cycle.id).toBe(cycle.id);
    expect(result!.bet.description).toBe('Find me');
  });

  it('returns null when bet is not in any cycle', () => {
    manager.create(makeBudget());
    const result = manager.findBetCycle(crypto.randomUUID());
    expect(result).toBeNull();
  });

  it('finds bet across multiple cycles', () => {
    const c1 = manager.create(makeBudget());
    manager.addBet(c1.id, makeBetInput({ description: 'Bet A', appetite: 20 }));
    const c2 = manager.create(makeBudget());
    const updated = manager.addBet(c2.id, makeBetInput({ description: 'Bet B', appetite: 20 }));
    const betId = updated.bets[0]!.id;

    const result = manager.findBetCycle(betId);
    expect(result!.cycle.id).toBe(c2.id);
    expect(result!.bet.description).toBe('Bet B');
  });
});

describe('CycleManager.startCycle', () => {
  it('transitions cycle to active when all bets have kata', () => {
    const cycle = manager.create(makeBudget());
    const withBet = manager.addBet(cycle.id, makeBetInput());
    const betId = withBet.bets[0]!.id;
    manager.updateBet(cycle.id, betId, { kata: { type: 'named', pattern: 'full-feature' } });

    const result = manager.startCycle(cycle.id);
    expect(result.betsWithoutKata).toHaveLength(0);
    expect(result.cycle.state).toBe('active');
  });

  it('returns unassigned bets without transitioning when bets lack kata', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ description: 'Missing kata bet', appetite: 20 }));

    const result = manager.startCycle(cycle.id);
    expect(result.betsWithoutKata).toEqual(['Missing kata bet']);
    // State should remain planning
    expect(manager.get(cycle.id).state).toBe('planning');
  });

  it('throws if cycle is already active', () => {
    const cycle = manager.create(makeBudget());
    manager.updateState(cycle.id, 'active');
    expect(() => manager.startCycle(cycle.id)).toThrow('already in state');
  });

  it('throws if cycle is in cooldown state', () => {
    const cycle = manager.create(makeBudget());
    manager.updateState(cycle.id, 'cooldown');
    expect(() => manager.startCycle(cycle.id)).toThrow('already in state');
  });

  it('throws if cycle is complete', () => {
    const cycle = manager.create(makeBudget());
    manager.updateState(cycle.id, 'complete');
    expect(() => manager.startCycle(cycle.id)).toThrow('already in state');
  });

  it('allows starting a cycle with no bets', () => {
    const cycle = manager.create(makeBudget());
    const result = manager.startCycle(cycle.id);
    expect(result.betsWithoutKata).toHaveLength(0);
    expect(result.cycle.state).toBe('active');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() => manager.startCycle(crypto.randomUUID())).toThrow(CycleNotFoundError);
  });
});

describe('CycleManager.generateCooldown', () => {
  it('generates cooldown report for a cycle with no bets', () => {
    const cycle = manager.create(makeBudget(), 'Empty Cycle');
    const report = manager.generateCooldown(cycle.id);

    expect(report.cycleId).toBe(cycle.id);
    expect(report.cycleName).toBe('Empty Cycle');
    expect(report.bets).toHaveLength(0);
    expect(report.completionRate).toBe(0);
    expect(report.summary).toContain('Empty Cycle');
  });

  it('generates report with per-bet breakdown', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ description: 'Build auth', appetite: 40 }));
    manager.addBet(cycle.id, makeBetInput({ description: 'Fix bugs', appetite: 30 }));

    const report = manager.generateCooldown(cycle.id);
    expect(report.bets).toHaveLength(2);
    expect(report.bets[0]!.description).toBe('Build auth');
    expect(report.bets[1]!.description).toBe('Fix bugs');
  });

  it('calculates completion rate correctly', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ outcome: 'complete', appetite: 20 }));
    manager.addBet(cycle.id, makeBetInput({ outcome: 'partial', appetite: 20 }));
    manager.addBet(cycle.id, makeBetInput({ outcome: 'complete', appetite: 20 }));

    const report = manager.generateCooldown(cycle.id);
    expect(report.bets).toHaveLength(3);
    // 2 out of 3 bets are 'complete' = 66.67%
    expect(report.completionRate).toBeCloseTo(66.67, 1);
  });

  it('calculates 0% completion when all bets are pending', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ outcome: 'pending', appetite: 30 }));
    manager.addBet(cycle.id, makeBetInput({ outcome: 'pending', appetite: 30 }));

    const report = manager.generateCooldown(cycle.id);
    expect(report.completionRate).toBe(0);
  });

  it('calculates 100% completion when all bets are complete', () => {
    const cycle = manager.create(makeBudget());
    manager.addBet(cycle.id, makeBetInput({ outcome: 'complete', appetite: 30 }));
    manager.addBet(cycle.id, makeBetInput({ outcome: 'complete', appetite: 30 }));

    const report = manager.generateCooldown(cycle.id);
    expect(report.completionRate).toBe(100);
  });

  it('counts pipeline mappings per bet', () => {
    const cycle = manager.create(makeBudget());
    const updated = manager.addBet(cycle.id, makeBetInput());
    const betId = updated.bets[0]!.id;
    manager.mapPipeline(cycle.id, betId, crypto.randomUUID());
    manager.mapPipeline(cycle.id, betId, crypto.randomUUID());

    const report = manager.generateCooldown(cycle.id);
    expect(report.bets[0]!.pipelineCount).toBe(2);
  });

  it('includes budget information', () => {
    const budget = makeBudget({ tokenBudget: 2000000 });
    const cycle = manager.create(budget);
    const report = manager.generateCooldown(cycle.id);

    expect(report.budget).toEqual(budget);
    expect(report.summary).toContain('2,000,000');
  });

  it('includes summary text', () => {
    const cycle = manager.create(makeBudget(), 'Test Cycle');
    const report = manager.generateCooldown(cycle.id);

    expect(report.summary).toContain('Test Cycle');
    expect(report.summary).toContain('Bets: 0');
    expect(report.summary).toContain('Completion rate: 0.0%');
  });

  it('throws CycleNotFoundError for nonexistent cycle', () => {
    expect(() => manager.generateCooldown(crypto.randomUUID())).toThrow(
      CycleNotFoundError,
    );
  });
});
