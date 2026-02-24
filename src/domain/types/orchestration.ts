import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';
import { DecisionOutcomeSchema } from './decision.js';

/**
 * A snapshot of the current execution context used by the orchestrator
 * to select and score flavors. Captures everything the orchestrator
 * needs to make an informed decision.
 */
export const CapabilityProfileSchema = z.object({
  /** Optional bet context providing domain-specific information. */
  betContext: z.record(z.string(), z.unknown()).optional(),
  /** Artifacts available from prior stages or flavors. */
  availableArtifacts: z.array(z.string()),
  /** IDs of active stage rules that influence flavor selection. */
  activeRules: z.array(z.string()),
  /** Relevant learnings loaded for this stage. */
  learnings: z.array(z.string()),
  /** Which stage category is being orchestrated. */
  stageCategory: StageCategorySchema,
});

export type CapabilityProfile = z.infer<typeof CapabilityProfileSchema>;

/**
 * How well a specific flavor matched the current execution context.
 * Produced by the scoring algorithm during flavor selection.
 */
export const MatchReportSchema = z.object({
  /** Name of the flavor being scored. */
  flavorName: z.string().min(1),
  /** Final score in [0, 1]. */
  score: z.number().min(0).max(1),
  /** Number of keyword matches that contributed to the score. */
  keywordHits: z.number().int().nonnegative(),
  /** Adjustments applied by active stage rules (positive or negative). */
  ruleAdjustments: z.number(),
  /** Additive boost from relevant learnings. */
  learningBoost: z.number().nonnegative(),
  /** Explanation of why this flavor received this score. */
  reasoning: z.string(),
});

export type MatchReport = z.infer<typeof MatchReportSchema>;

/**
 * Severity levels for coverage gaps.
 */
export const GapSeveritySchema = z.enum(['low', 'medium', 'high']);

/**
 * A gap identified in the current flavor selection — something
 * that the selected flavors don't adequately cover.
 */
export const GapReportSchema = z.object({
  /** What's missing from the current selection. */
  description: z.string().min(1),
  /** How important this gap is. */
  severity: GapSeveritySchema,
  /** Flavors that could fill this gap. */
  suggestedFlavors: z.array(z.string()),
});

export type GapReport = z.infer<typeof GapReportSchema>;

/**
 * The orchestrator's execution plan: which flavors to run and how.
 */
export const ExecutionPlanSchema = z.object({
  /** The flavors selected for execution. */
  selectedFlavors: z.array(z.string()).min(1),
  /** Whether to run flavors sequentially or in parallel. */
  executionMode: z.enum(['sequential', 'parallel']),
  /** Why these flavors were selected in this mode. */
  reasoning: z.string().min(1),
  /** Coverage gaps identified during planning. */
  gaps: z.array(GapReportSchema),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

/**
 * Quality levels for overall reflection assessment.
 */
export const ReflectionQualitySchema = z.enum(['good', 'partial', 'poor']);

/**
 * Results from the reflection phase after stage execution.
 * Captures what was learned and what should change.
 */
export const ReflectionResultSchema = z.object({
  /** Outcome assessments for each decision made during the stage. */
  decisionOutcomes: z.array(
    z.object({
      decisionId: z.string().uuid(),
      outcome: DecisionOutcomeSchema,
    }),
  ),
  /** Learnings extracted from this execution. */
  learnings: z.array(z.string()),
  /** IDs of rule suggestions generated from this reflection. */
  ruleSuggestions: z.array(z.string().uuid()),
  /** Overall quality assessment of the stage execution. */
  overallQuality: ReflectionQualitySchema,
});

export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;
