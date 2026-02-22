import { z } from 'zod/v4';
import { BetSchema } from './bet.js';

export const CycleState = z.enum(['planning', 'active', 'cooldown', 'complete']);

export type CycleState = z.infer<typeof CycleState>;

export const BudgetSchema = z.object({
  /** Token budget (total tokens across all bets) */
  tokenBudget: z.number().int().positive().optional(),
  /** Time budget as ISO 8601 duration or human-readable (e.g., "2 weeks") */
  timeBudget: z.string().optional(),
});

export type Budget = z.infer<typeof BudgetSchema>;

export const PipelineMappingSchema = z.object({
  pipelineId: z.string().uuid(),
  betId: z.string().uuid(),
});

export type PipelineMapping = z.infer<typeof PipelineMappingSchema>;

export const BudgetAlertLevel = z.enum(['info', 'warning', 'critical']);

export type BudgetAlertLevel = z.infer<typeof BudgetAlertLevel>;

export const BudgetStatusSchema = z.object({
  cycleId: z.string().uuid(),
  budget: BudgetSchema,
  tokensUsed: z.number().int().min(0).default(0),
  utilizationPercent: z.number().min(0).default(0),
  alertLevel: BudgetAlertLevel.optional(),
  perBet: z.array(
    z.object({
      betId: z.string().uuid(),
      allocated: z.number().int().min(0),
      used: z.number().int().min(0),
      utilizationPercent: z.number().min(0),
    })
  ).default([]),
});

export type BudgetStatus = z.infer<typeof BudgetStatusSchema>;

export const CycleSchema = z.object({
  id: z.string().uuid(),
  name: z.string().optional(),
  budget: BudgetSchema,
  bets: z.array(BetSchema).default([]),
  pipelineMappings: z.array(PipelineMappingSchema).default([]),
  state: CycleState.default('planning'),
  /** Cooldown reserve percentage (default 10%) */
  cooldownReserve: z.number().min(0).max(100).default(10),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Cycle = z.infer<typeof CycleSchema>;
