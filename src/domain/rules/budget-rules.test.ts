import { describe, it, expect } from 'vitest';
import {
  validateAppetite,
  calculateUtilization,
  checkBudgetConstraint,
} from './budget-rules.js';
import type { Bet } from '@domain/types/bet.js';
import type { Budget } from '@domain/types/cycle.js';

function makeBet(appetite: number, overrides?: Partial<Bet>): Bet {
  return {
    id: crypto.randomUUID(),
    description: `Test bet (${appetite}%)`,
    appetite,
    issueRefs: [],
    outcome: 'pending',
    ...overrides,
  };
}

describe('validateAppetite', () => {
  it('returns valid when total appetite + reserve is under 100%', () => {
    const bets = [makeBet(30), makeBet(20)];
    const result = validateAppetite(bets, 10);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBe(40);
    expect(result.errors).toHaveLength(0);
  });

  it('returns valid when total appetite + reserve equals exactly 100%', () => {
    const bets = [makeBet(40), makeBet(30), makeBet(20)];
    const result = validateAppetite(bets, 10);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('returns invalid when total appetite + reserve exceeds 100%', () => {
    const bets = [makeBet(50), makeBet(40)];
    const result = validateAppetite(bets, 15);
    expect(result.valid).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('exceeds 100%');
  });

  it('works with empty bets array', () => {
    const result = validateAppetite([], 10);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBe(90);
  });

  it('returns invalid for negative cooldown reserve', () => {
    const result = validateAppetite([], -5);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Cooldown reserve must be between 0 and 100');
  });

  it('returns invalid for cooldown reserve over 100', () => {
    const result = validateAppetite([], 105);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('handles single bet that uses all available appetite', () => {
    const bets = [makeBet(90)];
    const result = validateAppetite(bets, 10);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('handles zero cooldown reserve', () => {
    const bets = [makeBet(50), makeBet(50)];
    const result = validateAppetite(bets, 0);
    expect(result.valid).toBe(true);
    expect(result.remaining).toBe(0);
  });
});

describe('calculateUtilization', () => {
  it('returns 0% when no token budget is set', () => {
    const budget: Budget = {};
    const result = calculateUtilization(budget, 1000);
    expect(result.percent).toBe(0);
    expect(result.alertLevel).toBeUndefined();
  });

  it('returns no alert below 75%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 500);
    expect(result.percent).toBe(50);
    expect(result.alertLevel).toBeUndefined();
  });

  it('returns no alert at exactly 74.9%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 749);
    expect(result.percent).toBe(74.9);
    expect(result.alertLevel).toBeUndefined();
  });

  it('returns info at exactly 75%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 750);
    expect(result.percent).toBe(75);
    expect(result.alertLevel).toBe('info');
  });

  it('returns info at 89%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 890);
    expect(result.percent).toBe(89);
    expect(result.alertLevel).toBe('info');
  });

  it('returns warning at exactly 90%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 900);
    expect(result.percent).toBe(90);
    expect(result.alertLevel).toBe('warning');
  });

  it('returns warning at 99%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 990);
    expect(result.percent).toBe(99);
    expect(result.alertLevel).toBe('warning');
  });

  it('returns critical at exactly 100%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 1000);
    expect(result.percent).toBe(100);
    expect(result.alertLevel).toBe('critical');
  });

  it('returns critical above 100%', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 1500);
    expect(result.percent).toBe(150);
    expect(result.alertLevel).toBe('critical');
  });

  it('handles zero tokens used', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = calculateUtilization(budget, 0);
    expect(result.percent).toBe(0);
    expect(result.alertLevel).toBeUndefined();
  });

  it('handles zero token budget gracefully', () => {
    const budget: Budget = { tokenBudget: 0 };
    const result = calculateUtilization(budget, 0);
    expect(result.percent).toBe(0);
    expect(result.alertLevel).toBeUndefined();
  });
});

describe('checkBudgetConstraint', () => {
  it('returns within budget when no token budget set', () => {
    const budget: Budget = {};
    const result = checkBudgetConstraint(budget, 1000000);
    expect(result.withinBudget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it('returns within budget when usage is under budget', () => {
    const budget: Budget = { tokenBudget: 2000000 };
    const result = checkBudgetConstraint(budget, 1000000);
    expect(result.withinBudget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it('returns within budget when usage equals budget exactly', () => {
    const budget: Budget = { tokenBudget: 2000000 };
    const result = checkBudgetConstraint(budget, 2000000);
    expect(result.withinBudget).toBe(true);
    expect(result.overage).toBe(0);
  });

  it('returns over budget when usage exceeds budget', () => {
    const budget: Budget = { tokenBudget: 2000000 };
    const result = checkBudgetConstraint(budget, 2500000);
    expect(result.withinBudget).toBe(false);
    expect(result.overage).toBe(500000);
  });

  it('returns zero overage when within budget', () => {
    const budget: Budget = { tokenBudget: 1000 };
    const result = checkBudgetConstraint(budget, 500);
    expect(result.overage).toBe(0);
  });
});
