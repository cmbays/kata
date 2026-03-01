import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';

/**
 * Per-stage flavor recommendations for a saved kata.
 * Guides the orchestrator's flavor selection without hardcoding choices.
 */
export const FlavorHintSchema = z.object({
  /** Recommended flavor names for this stage. Orchestrator filters to these. */
  recommended: z.array(z.string().min(1)).min(1),
  /** How to use the recommendations:
   *  - "prefer" (default): apply a score boost (+0.2) to recommended flavors; all others still scored normally
   *  - "restrict": ONLY allow recommended flavors, no fallback
   */
  strategy: z.enum(['prefer', 'restrict']).default('prefer'),
});

export type FlavorHint = z.infer<typeof FlavorHintSchema>;

/**
 * A saved execution sequence — a named list of stage categories to run.
 * Stored in `.kata/katas/{name}.json`.
 */
export const SavedKataSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only alphanumeric characters, hyphens, and underscores'),
  description: z.string().optional(),
  stages: z.array(StageCategorySchema).min(1),
  /** Per-stage flavor recommendations. Guides orchestrator selection without hardcoding. */
  flavorHints: z.record(z.string(), FlavorHintSchema).optional().superRefine((hints, ctx) => {
    if (!hints) return;
    const validCategories = StageCategorySchema.options;
    for (const key of Object.keys(hints)) {
      if (!validCategories.includes(key as typeof validCategories[number])) {
        ctx.addIssue({
          code: 'custom',
          message: `Invalid stage category key "${key}". Valid categories: ${validCategories.join(', ')}`,
          path: [key],
        });
      }
    }
  }),
});

export type SavedKata = z.infer<typeof SavedKataSchema>;
