import { z } from 'zod/v4';

export const BetOutcome = z.enum(['pending', 'complete', 'partial', 'abandoned']);

export type BetOutcome = z.infer<typeof BetOutcome>;

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
});

export type Bet = z.infer<typeof BetSchema>;
