import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TokenTracker } from './token-tracker.js';
import type { TokenUsage } from '@domain/types/history.js';
import type { Budget } from '@domain/types/cycle.js';

let tempDir: string;
let tracker: TokenTracker;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-tracker-test-'));
  tracker = new TokenTracker(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeUsage(overrides?: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 10,
    cacheReadTokens: 5,
    total: 165,
    ...overrides,
  };
}

describe('TokenTracker.recordUsage', () => {
  it('records and persists token usage for a stage', () => {
    const usage = makeUsage();
    tracker.recordUsage('stage-1', usage);

    const retrieved = tracker.getUsage('stage-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.inputTokens).toBe(100);
    expect(retrieved!.outputTokens).toBe(50);
    expect(retrieved!.total).toBe(165);
  });

  it('overwrites previous usage for the same stage', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));
    tracker.recordUsage('stage-1', makeUsage({ total: 200 }));

    const retrieved = tracker.getUsage('stage-1');
    expect(retrieved!.total).toBe(200);
  });

  it('records multiple stages independently', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));
    tracker.recordUsage('stage-2', makeUsage({ total: 200 }));

    expect(tracker.getUsage('stage-1')!.total).toBe(100);
    expect(tracker.getUsage('stage-2')!.total).toBe(200);
  });
});

describe('TokenTracker.getUsage', () => {
  it('returns undefined for unrecorded stage', () => {
    const result = tracker.getUsage('nonexistent');
    expect(result).toBeUndefined();
  });

  it('returns usage after recording', () => {
    const usage = makeUsage({ inputTokens: 500, outputTokens: 250, total: 750 });
    tracker.recordUsage('my-stage', usage);

    const result = tracker.getUsage('my-stage');
    expect(result).toBeDefined();
    expect(result!.inputTokens).toBe(500);
    expect(result!.outputTokens).toBe(250);
  });
});

describe('TokenTracker.getTotalUsage', () => {
  it('returns 0 when no usage recorded', () => {
    expect(tracker.getTotalUsage()).toBe(0);
  });

  it('sums total across all recorded stages', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));
    tracker.recordUsage('stage-2', makeUsage({ total: 250 }));
    tracker.recordUsage('stage-3', makeUsage({ total: 350 }));

    expect(tracker.getTotalUsage()).toBe(700);
  });

  it('reflects updated values after overwriting', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));
    tracker.recordUsage('stage-2', makeUsage({ total: 200 }));
    expect(tracker.getTotalUsage()).toBe(300);

    tracker.recordUsage('stage-1', makeUsage({ total: 500 }));
    expect(tracker.getTotalUsage()).toBe(700);
  });
});

describe('TokenTracker.checkBudget', () => {
  it('returns empty array when no token budget set', () => {
    const budget: Budget = {};
    const alerts = tracker.checkBudget(budget, 1000);
    expect(alerts).toHaveLength(0);
  });

  it('returns empty array when usage is below 75%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const alerts = tracker.checkBudget(budget, 500);
    expect(alerts).toHaveLength(0);
  });

  it('returns info alert at 75% usage', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const alerts = tracker.checkBudget(budget, 750);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('info');
    expect(alerts[0]!.tokensUsed).toBe(750);
    expect(alerts[0]!.tokenBudget).toBe(1000);
    expect(alerts[0]!.utilizationPercent).toBe(75);
  });

  it('returns warning alert at 90% usage', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const alerts = tracker.checkBudget(budget, 900);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('warning');
    expect(alerts[0]!.message).toContain('approaching limit');
  });

  it('returns critical alert at 100%+ usage', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const alerts = tracker.checkBudget(budget, 1200);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('critical');
    expect(alerts[0]!.message).toContain('exceeded');
    expect(alerts[0]!.utilizationPercent).toBe(120);
  });

  it('includes correct utilization percent in alert', () => {
    const budget: Budget = { tokenBudget: 2000 };
    const alerts = tracker.checkBudget(budget, 1800);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.utilizationPercent).toBe(90);
  });
});

describe('TokenTracker.getTotalCost', () => {
  it('returns 0 when no cost recorded', () => {
    expect(tracker.getTotalCost()).toBe(0);
  });

  it('returns 0 when usages have no costUsd', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));
    expect(tracker.getTotalCost()).toBe(0);
  });

  it('sums costUsd across all stages', () => {
    tracker.recordUsage('stage-1', makeUsage({ costUsd: 0.05 }));
    tracker.recordUsage('stage-2', makeUsage({ costUsd: 0.12 }));

    expect(tracker.getTotalCost()).toBeCloseTo(0.17);
  });

  it('mixes stages with and without costUsd', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 500 }));           // no cost
    tracker.recordUsage('stage-2', makeUsage({ total: 200, costUsd: 0.08 }));

    expect(tracker.getTotalCost()).toBeCloseTo(0.08);
    expect(tracker.getTotalUsage()).toBe(700);
  });
});

describe('TokenTracker.checkCostBudget', () => {
  it('returns empty array when no costBudget set', () => {
    const alerts = tracker.checkCostBudget({ currency: 'USD' }, 1.5);
    expect(alerts).toHaveLength(0);
  });

  it('returns empty array when cost is below 75%', () => {
    const alerts = tracker.checkCostBudget({ costBudget: 10, currency: 'USD' }, 5);
    expect(alerts).toHaveLength(0);
  });

  it('returns info alert at 75% cost', () => {
    const alerts = tracker.checkCostBudget({ costBudget: 10, currency: 'USD' }, 7.5);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('info');
    expect(alerts[0]!.costUsed).toBe(7.5);
    expect(alerts[0]!.costBudget).toBe(10);
    expect(alerts[0]!.currency).toBe('USD');
  });

  it('returns warning alert at 90% cost', () => {
    const alerts = tracker.checkCostBudget({ costBudget: 10, currency: 'USD' }, 9);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('warning');
    expect(alerts[0]!.message).toContain('approaching limit');
  });

  it('returns critical alert at 100%+ cost', () => {
    const alerts = tracker.checkCostBudget({ costBudget: 10, currency: 'USD' }, 12);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.level).toBe('critical');
    expect(alerts[0]!.message).toContain('exceeded');
  });
});

describe('TokenTracker persistence', () => {
  it('persists data across tracker instances', () => {
    tracker.recordUsage('stage-1', makeUsage({ total: 100 }));

    // Create a new tracker pointing to the same directory
    const tracker2 = new TokenTracker(tempDir);
    const usage = tracker2.getUsage('stage-1');
    expect(usage).toBeDefined();
    expect(usage!.total).toBe(100);
  });

  it('handles fresh start with no existing data', () => {
    const freshTracker = new TokenTracker(join(tempDir, 'fresh'));
    expect(freshTracker.getTotalUsage()).toBe(0);
    expect(freshTracker.getUsage('anything')).toBeUndefined();
  });
});
