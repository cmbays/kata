import { join } from 'node:path';
import { z } from 'zod/v4';
import { JsonStore } from '@infra/persistence/json-store.js';
import { TokenUsageSchema } from '@domain/types/history.js';
import type { TokenUsage } from '@domain/types/history.js';
import type { Budget, BudgetAlertLevel } from '@domain/types/cycle.js';
import { calculateUtilization } from '@domain/rules/budget-rules.js';
import { logger } from '@shared/lib/logger.js';

export interface BudgetAlert {
  level: BudgetAlertLevel;
  message: string;
  utilizationPercent: number;
  /** Token budget tracking (populated by checkBudget; undefined for cost-based alerts) */
  tokensUsed?: number;
  tokenBudget?: number;
  /** Cost budget tracking (populated by checkCostBudget; undefined for token-based alerts) */
  costUsed?: number;
  costBudget?: number;
  currency?: string;
}

/** Extended token usage with optional bet attribution for team execution. */
const AttributedUsageSchema = TokenUsageSchema.extend({
  betId: z.string().optional(),
});

type AttributedUsage = z.infer<typeof AttributedUsageSchema>;

/** Schema for persisted usage records: a map of stageId -> AttributedUsage */
const UsageRecordSchema = z.record(z.string(), AttributedUsageSchema);

type UsageRecord = z.infer<typeof UsageRecordSchema>;

/**
 * Tracks token usage from Claude Code JSONL session files.
 * Persists usage data to `.kata/tracking/usage.json`.
 */
export class TokenTracker {
  private readonly usagePath: string;

  constructor(basePath: string) {
    this.usagePath = join(basePath, 'usage.json');
  }

  /**
   * Record token usage for a stage execution.
   * Optionally tag with a betId for per-bet aggregation during team execution.
   */
  recordUsage(stageId: string, tokenUsage: TokenUsage, betId?: string): void {
    const records = this.loadRecords();
    records[stageId] = betId ? { ...tokenUsage, betId } : tokenUsage;
    JsonStore.write(this.usagePath, records, UsageRecordSchema);
  }

  /**
   * Retrieve token usage for a specific stage.
   */
  getUsage(stageId: string): AttributedUsage | undefined {
    const records = this.loadRecords();
    return records[stageId];
  }

  /**
   * Sum token usage for a specific bet across all stages tagged with that betId.
   */
  getUsageByBet(betId: string): number {
    const records = this.loadRecords();
    let total = 0;
    for (const usage of Object.values(records)) {
      if (usage.betId === betId) {
        total += usage.total;
      }
    }
    return total;
  }

  /**
   * Sum all recorded token usage across all stages.
   */
  getTotalUsage(): number {
    const records = this.loadRecords();
    let total = 0;
    for (const usage of Object.values(records)) {
      total += usage.total;
    }
    return total;
  }

  /**
   * Sum all recorded dollar costs across all stages (for ComposioAdapter).
   * Returns 0 if no cost data has been recorded.
   */
  getTotalCost(): number {
    const records = this.loadRecords();
    let total = 0;
    for (const usage of Object.values(records)) {
      total += usage.costUsd ?? 0;
    }
    return total;
  }

  /**
   * Evaluate current dollar cost against costBudget, return any alerts.
   */
  checkCostBudget(budget: Budget, costUsed: number): BudgetAlert[] {
    if (!budget.costBudget) {
      return [];
    }

    const percent = (costUsed / budget.costBudget) * 100;
    let alertLevel: BudgetAlertLevel | undefined;
    if (percent >= 100) alertLevel = 'critical';
    else if (percent >= 90) alertLevel = 'warning';
    else if (percent >= 75) alertLevel = 'info';

    if (!alertLevel) return [];

    const currency = budget.currency ?? 'USD';
    const messages: Record<BudgetAlertLevel, string> = {
      info: `Cost at ${percent.toFixed(1)}% of budget — consider wrapping up soon`,
      warning: `Cost at ${percent.toFixed(1)}% of budget — approaching limit`,
      critical: `Cost at ${percent.toFixed(1)}% of budget — budget exceeded`,
    };

    return [{
      level: alertLevel,
      message: messages[alertLevel],
      utilizationPercent: percent,
      costUsed,
      costBudget: budget.costBudget,
      currency,
    }];
  }

  /**
   * Evaluate current usage against budget, return any alerts.
   */
  checkBudget(budget: Budget, tokensUsed: number): BudgetAlert[] {
    const alerts: BudgetAlert[] = [];

    if (!budget.tokenBudget) {
      return alerts;
    }

    const { percent, alertLevel } = calculateUtilization(budget, tokensUsed);

    if (alertLevel) {
      const messages: Record<BudgetAlertLevel, string> = {
        info: `Token usage at ${percent.toFixed(1)}% of budget — consider wrapping up soon`,
        warning: `Token usage at ${percent.toFixed(1)}% of budget — approaching limit`,
        critical: `Token usage at ${percent.toFixed(1)}% of budget — budget exceeded`,
      };

      alerts.push({
        level: alertLevel,
        message: messages[alertLevel],
        tokensUsed,
        tokenBudget: budget.tokenBudget,
        utilizationPercent: percent,
      });
    }

    return alerts;
  }

  /**
   * Load persisted usage records, returning empty object if file doesn't exist.
   */
  private loadRecords(): UsageRecord {
    if (!JsonStore.exists(this.usagePath)) {
      return {};
    }
    try {
      return JsonStore.read(this.usagePath, UsageRecordSchema);
    } catch (err) {
      logger.error(
        `TokenTracker: failed to load usage records from "${this.usagePath}". Budget tracking data is unavailable.`,
        { error: err instanceof Error ? err.message : String(err) },
      );
      return {};
    }
  }
}
