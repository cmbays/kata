import type { Bet } from '@domain/types/bet.js';
import type { Budget } from '@domain/types/cycle.js';
import type { BudgetAlertLevel } from '@domain/types/cycle.js';

export interface AppetiteValidationResult {
  valid: boolean;
  remaining: number;
  errors: string[];
}

export interface UtilizationResult {
  percent: number;
  alertLevel?: BudgetAlertLevel;
}

export interface BudgetConstraintResult {
  withinBudget: boolean;
  overage: number;
}

/**
 * Validate that total appetite of all bets + cooldown reserve does not exceed 100%.
 */
export function validateAppetite(
  bets: Bet[],
  cooldownReserve: number,
): AppetiteValidationResult {
  const errors: string[] = [];

  if (cooldownReserve < 0 || cooldownReserve > 100) {
    errors.push(`Cooldown reserve must be between 0 and 100, got ${cooldownReserve}`);
  }

  const totalAppetite = bets.reduce((sum, bet) => sum + bet.appetite, 0);
  const totalWithReserve = totalAppetite + cooldownReserve;
  const remaining = 100 - totalWithReserve;

  if (totalWithReserve > 100) {
    errors.push(
      `Total appetite (${totalAppetite}%) + cooldown reserve (${cooldownReserve}%) = ${totalWithReserve}%, which exceeds 100%`,
    );
  }

  return {
    valid: errors.length === 0,
    remaining: Math.max(0, remaining),
    errors,
  };
}

/**
 * Calculate utilization percentage and alert level.
 *
 * Thresholds:
 * - Below 75%: no alert
 * - 75-89%: 'info'
 * - 90-99%: 'warning'
 * - 100%+: 'critical'
 */
export function calculateUtilization(
  budget: Budget,
  tokensUsed: number,
): UtilizationResult {
  if (!budget.tokenBudget || budget.tokenBudget === 0) {
    return { percent: 0 };
  }

  const percent = (tokensUsed / budget.tokenBudget) * 100;

  let alertLevel: BudgetAlertLevel | undefined;
  if (percent >= 100) {
    alertLevel = 'critical';
  } else if (percent >= 90) {
    alertLevel = 'warning';
  } else if (percent >= 75) {
    alertLevel = 'info';
  }

  return { percent, alertLevel };
}

/**
 * Check if token usage is within budget.
 * Budget is a constraint, NOT a hard stop (Shape Up philosophy).
 */
export function checkBudgetConstraint(
  budget: Budget,
  tokensUsed: number,
): BudgetConstraintResult {
  if (!budget.tokenBudget) {
    return { withinBudget: true, overage: 0 };
  }

  const overage = Math.max(0, tokensUsed - budget.tokenBudget);

  return {
    withinBudget: tokensUsed <= budget.tokenBudget,
    overage,
  };
}
