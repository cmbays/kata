import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';

/**
 * A boost rule that increases a flavor's score when certain artifact patterns
 * are detected in the available artifacts list.
 */
export const BoostRuleSchema = z.object({
  /** Substring to match against available artifact names. */
  artifactPattern: z.string().min(1),
  /** Score boost to apply when the pattern matches (additive, clamped to [0, 1]). */
  magnitude: z.number().min(0).max(1),
});

export type BoostRule = z.infer<typeof BoostRuleSchema>;

/**
 * Domain vocabulary configuration for a stage category.
 *
 * Replaces the keyword lists and scoring heuristics that were previously
 * hard-coded in category-specific orchestrator subclasses. Each category
 * has a vocabulary JSON that drives flavor scoring and synthesis decisions.
 */
export const StageVocabularySchema = z.object({
  /** Which stage category this vocabulary applies to. */
  category: StageCategorySchema,
  /** Keywords used for scoring flavor relevance via name/description/bet matching. */
  keywords: z.array(z.string().min(1)).min(1),
  /** Artifact pattern → score boost rules. Applied additively during scoring. */
  boostRules: z.array(BoostRuleSchema).default([]),
  /**
   * Preferred synthesis approach for this category.
   * - merge-all: combine all flavor outputs into a keyed record (default)
   * - cascade: each successive flavor sees prior results (used by review)
   * - first-wins: use only the top-scored flavor's output
   */
  synthesisPreference: z.enum(['merge-all', 'cascade', 'first-wins']).default('merge-all'),
  /** Alternative synthesis approaches available for this category. */
  synthesisAlternatives: z
    .array(z.enum(['merge-all', 'cascade', 'first-wins']))
    .default(['merge-all', 'first-wins', 'cascade']),
  /** Template for generating reasoning strings in synthesis decisions. */
  reasoningTemplate: z.string().optional(),
});

export type StageVocabulary = z.infer<typeof StageVocabularySchema>;
