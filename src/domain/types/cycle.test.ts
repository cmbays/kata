import { describe, it, expect } from 'vitest';
import {
  CycleState,
  BudgetSchema,
  PipelineMappingSchema,
  BudgetAlertLevel,
  BudgetStatusSchema,
  CycleSchema,
} from './cycle.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('CycleState', () => {
  it('accepts all valid states', () => {
    for (const s of ['planning', 'active', 'cooldown', 'complete']) {
      expect(CycleState.parse(s)).toBe(s);
    }
  });
});

describe('BudgetSchema', () => {
  it('parses token budget', () => {
    const result = BudgetSchema.parse({ tokenBudget: 500_000 });
    expect(result.tokenBudget).toBe(500_000);
  });

  it('parses time budget', () => {
    const result = BudgetSchema.parse({ timeBudget: '2 weeks' });
    expect(result.timeBudget).toBe('2 weeks');
  });

  it('parses empty budget', () => {
    const result = BudgetSchema.parse({});
    expect(result.tokenBudget).toBeUndefined();
    expect(result.timeBudget).toBeUndefined();
  });

  it('rejects negative token budget', () => {
    expect(() => BudgetSchema.parse({ tokenBudget: -1 })).toThrow();
  });

  it('rejects non-integer token budget', () => {
    expect(() => BudgetSchema.parse({ tokenBudget: 1.5 })).toThrow();
  });
});

describe('PipelineMappingSchema', () => {
  it('parses valid mapping', () => {
    const result = PipelineMappingSchema.parse({
      pipelineId: uuid(),
      betId: uuid(),
    });
    expect(result.pipelineId).toBeDefined();
    expect(result.betId).toBeDefined();
  });
});

describe('BudgetAlertLevel', () => {
  it('accepts all levels', () => {
    for (const l of ['info', 'warning', 'critical']) {
      expect(BudgetAlertLevel.parse(l)).toBe(l);
    }
  });
});

describe('BudgetStatusSchema', () => {
  it('parses with defaults', () => {
    const result = BudgetStatusSchema.parse({
      cycleId: uuid(),
      budget: { tokenBudget: 100_000 },
    });
    expect(result.tokensUsed).toBe(0);
    expect(result.utilizationPercent).toBe(0);
    expect(result.perBet).toEqual([]);
  });

  it('parses full budget status', () => {
    const betId = uuid();
    const result = BudgetStatusSchema.parse({
      cycleId: uuid(),
      budget: { tokenBudget: 100_000 },
      tokensUsed: 75_000,
      utilizationPercent: 75,
      alertLevel: 'warning',
      perBet: [
        { betId, allocated: 50_000, used: 40_000, utilizationPercent: 80 },
      ],
    });
    expect(result.alertLevel).toBe('warning');
    expect(result.perBet).toHaveLength(1);
  });
});

describe('CycleSchema', () => {
  it('parses minimal cycle with defaults', () => {
    const ts = now();
    const result = CycleSchema.parse({
      id: uuid(),
      budget: { tokenBudget: 200_000 },
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.state).toBe('planning');
    expect(result.bets).toEqual([]);
    expect(result.pipelineMappings).toEqual([]);
    expect(result.cooldownReserve).toBe(10);
  });

  it('parses full cycle with bets', () => {
    const ts = now();
    const betId = uuid();
    const pipelineId = uuid();
    const result = CycleSchema.parse({
      id: uuid(),
      name: 'Sprint 1',
      budget: { tokenBudget: 500_000, timeBudget: '2 weeks' },
      bets: [
        { id: betId, description: 'Build methodology engine', appetite: 60 },
      ],
      pipelineMappings: [
        { pipelineId, betId },
      ],
      state: 'active',
      cooldownReserve: 15,
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.bets).toHaveLength(1);
    expect(result.cooldownReserve).toBe(15);
  });

  it('rejects cooldownReserve over 100', () => {
    expect(() =>
      CycleSchema.parse({
        id: uuid(),
        budget: {},
        cooldownReserve: 101,
        createdAt: now(),
        updatedAt: now(),
      })
    ).toThrow();
  });
});
