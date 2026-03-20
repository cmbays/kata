import { z } from 'zod/v4';
import { BudgetSchema, BudgetAlertLevel } from './cycle.js';

export const CooldownBetReportSchema = z.object({
  betId: z.string(),
  description: z.string(),
  appetite: z.number(),
  outcome: z.string(),
  outcomeNotes: z.string().optional(),
  pipelineCount: z.number().int().min(0),
});

export type CooldownBetReport = z.infer<typeof CooldownBetReportSchema>;

export const CooldownReportSchema = z.object({
  cycleId: z.string(),
  cycleName: z.string().optional(),
  budget: BudgetSchema,
  tokensUsed: z.number().int().min(0),
  utilizationPercent: z.number().min(0),
  alertLevel: BudgetAlertLevel.optional(),
  bets: z.array(CooldownBetReportSchema),
  completionRate: z.number().min(0),
  summary: z.string(),
});

export type CooldownReport = z.infer<typeof CooldownReportSchema>;
