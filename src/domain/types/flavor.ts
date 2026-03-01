import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';
import { StepResourcesSchema } from './step.js';

/**
 * A reference to a Step within a Flavor's ordered step list.
 * Steps are looked up at runtime via (stepType, stepName).
 */
export const FlavorStepRefSchema = z.object({
  /** Identifier for this step within the flavor — used as override key. */
  stepName: z.string().min(1),
  /** The step type to look up in the StepRegistry. */
  stepType: z.string().min(1),
});

export type FlavorStepRef = z.infer<typeof FlavorStepRefSchema>;

/**
 * Scoped property overrides that a Flavor may apply to a Step.
 * Only a safe subset of Step properties can be overridden — gate conditions,
 * artifact requirements, and resource definitions are structural contracts
 * of the step and are NOT overridable here.
 */
export const StepOverrideSchema = z.object({
  /** Override whether human approval is required for this step in this flavor. */
  humanApproval: z.boolean().optional(),
  /** Override the minimum confidence level before the step proceeds without human review. */
  confidenceThreshold: z.number().min(0).max(1).optional(),
  /** Override the step execution timeout in milliseconds. */
  timeout: z.number().positive().optional(),
});

export type StepOverride = z.infer<typeof StepOverrideSchema>;

/**
 * Whether a flavor requires git worktree isolation (code-modifying)
 * or can run in the shared repo (read-only / .kata/-only writes).
 */
export const FlavorIsolationSchema = z.enum(['worktree', 'shared']);
export type FlavorIsolation = z.infer<typeof FlavorIsolationSchema>;

/**
 * A Flavor is a named, ordered composition of Steps within a Stage category.
 * It is the second tier of the three-tier hierarchy: Stage → Flavor → Step.
 *
 * Flavors compose reusable Steps into a specific workflow for a mode of work.
 * Steps can be reused across multiple flavors (many-to-many).
 * The final step must produce the declared synthesisArtifact, which the Stage
 * orchestrator collects for synthesis after all flavors complete.
 */
export const FlavorSchema = z.object({
  /** Unique name for this flavor within its stage category. */
  name: z.string().min(1),
  description: z.string().optional(),
  /** Which Stage category this flavor belongs to. */
  stageCategory: StageCategorySchema,
  /**
   * Ordered list of step references. Must contain at least one step.
   * stepName values must be unique within the flavor — they serve as override keys.
   */
  steps: z.array(FlavorStepRefSchema).min(1).superRefine((steps, ctx) => {
    const seen = new Set<string>();
    for (const step of steps) {
      if (seen.has(step.stepName)) {
        ctx.addIssue({ code: 'custom', message: `Duplicate stepName: "${step.stepName}"` });
      }
      seen.add(step.stepName);
    }
  }),
  /**
   * Per-step property overrides, keyed by stepName.
   * Only humanApproval, confidenceThreshold, and timeout may be overridden.
   */
  overrides: z.record(z.string(), StepOverrideSchema).optional(),
  /**
   * Flavor-level resource additions — tools, agents, and skills available across
   * all steps of this flavor, beyond what individual steps already declare.
   * These are merged with step-level resources in ManifestBuilder (step wins on name conflicts).
   * Gate conditions and artifact requirements remain non-overridable by design.
   */
  resources: StepResourcesSchema.optional(),
  /**
   * The artifact name this flavor produces for Stage synthesis.
   * Must be produced by one of the steps in this flavor.
   */
  synthesisArtifact: z.string().min(1),
  /**
   * ID of the kataka (agent) responsible for executing this flavor.
   * When set, `kata kiai` will record this kataka on the run so observations
   * are automatically attributed to it. (Wave G)
   */
  kataka: z.string().uuid().optional(),
  /**
   * Isolation mode for team execution.
   * - `worktree`: This flavor modifies source code — spawn agent in a git worktree
   * - `shared`: This flavor only reads code or writes to `.kata/` — no isolation needed
   * Defaults to `shared`.
   */
  isolation: FlavorIsolationSchema.default('shared'),
});

export type Flavor = z.infer<typeof FlavorSchema>;
