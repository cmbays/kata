import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';

/**
 * A saved execution sequence — a named list of stage categories to run.
 * Stored in `.kata/katas/{name}.json`.
 */
export const SavedKataSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, 'Name must contain only alphanumeric characters, hyphens, and underscores'),
  description: z.string().optional(),
  stages: z.array(StageCategorySchema).min(1),
});

export type SavedKata = z.infer<typeof SavedKataSchema>;
