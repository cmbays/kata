import { z } from 'zod/v4';
import { GateConditionSchema } from './gate.js';

/**
 * Fixed enum of work modes that form the macro structure of a pipeline.
 * Categories are modes of work, not specializations (specializations are Flavors).
 * This is a closed enum — users cannot create new stage categories.
 */
export const StageCategorySchema = z.enum([
  'research', // Context gathering, requirements, exploration
  'plan', // Shaping, design, implementation planning
  'build', // Code production, TDD, implementation
  'review', // Quality validation, security, architecture review
]);

export type StageCategory = z.infer<typeof StageCategorySchema>;

/**
 * Configuration for the LLM-driven orchestrator that selects and runs Flavors
 * within a Stage. The orchestrator is the intelligence layer that makes
 * non-deterministic judgments about flavor selection and execution order.
 */
export const OrchestratorConfigSchema = z.object({
  /** Selects the built-in orchestrator prompt — must match the Stage's category. */
  type: StageCategorySchema,
  /** Optional path to a custom orchestrator prompt template. */
  promptTemplate: z.string().optional(),
  /** Minimum confidence level before a decision proceeds without human review. */
  confidenceThreshold: z.number().min(0).max(1).default(0.7),
  /** Maximum number of Flavors the orchestrator may run in parallel. */
  maxParallelFlavors: z.number().int().positive().default(5),
});

export type OrchestratorConfig = z.infer<typeof OrchestratorConfigSchema>;

/**
 * The macro-level execution unit in the three-tier hierarchy:
 *   Stage → Flavor → Step
 *
 * A Stage represents a mode of work (research, plan, build, review).
 * Its orchestrator selects and runs Flavors, then produces a synthesis artifact
 * as a handoff to the next Stage.
 */
export const StageSchema = z.object({
  /** Which work mode this stage represents. */
  category: StageCategorySchema,
  /** Orchestrator configuration — governs how Flavors are selected and run. */
  orchestrator: OrchestratorConfigSchema,
  /** Gate conditions that must pass before this Stage may begin. */
  entryGate: z.array(GateConditionSchema).optional(),
  /** Gate conditions that must pass before this Stage is considered complete. */
  exitGate: z.array(GateConditionSchema).optional(),
  /** References to Flavor definitions available for this Stage. */
  availableFlavors: z.array(z.string()),
  /** Flavors that always run, regardless of orchestrator decisions. */
  pinnedFlavors: z.array(z.string()).optional(),
  /** Flavors that are never run for this Stage in this project. */
  excludedFlavors: z.array(z.string()).optional(),
});

export type Stage = z.infer<typeof StageSchema>;
