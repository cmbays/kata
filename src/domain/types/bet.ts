import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';

export const BetOutcome = z.enum(['pending', 'complete', 'partial', 'abandoned']);

export type BetOutcome = z.infer<typeof BetOutcome>;

/**
 * How a bet is assigned to a kata execution pattern.
 * named: uses a saved kata sequence by pattern name.
 * ad-hoc: explicitly specifies stage categories to run.
 */
export const KataAssignmentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('named'), pattern: z.string().min(1) }),
  z.object({ type: z.literal('ad-hoc'), stages: z.array(StageCategorySchema).min(1) }),
]);

export type KataAssignment = z.infer<typeof KataAssignmentSchema>;

export const BetSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1),
  /** Appetite as percentage of cycle budget (0-100) */
  appetite: z.number().min(0).max(100),
  /** External project reference (e.g., GitHub repo) */
  projectRef: z.string().optional(),
  /** External issue/epic references */
  issueRefs: z.array(z.string()).default([]),
  outcome: BetOutcome.default('pending'),
  outcomeNotes: z.string().optional(),
  /** Kata execution assignment for this bet. Required by `kata cycle start`. */
  kata: KataAssignmentSchema.optional(),
});

export type Bet = z.infer<typeof BetSchema>;
