import { z } from 'zod/v4';

export const GateConditionType = z.enum([
  'artifact-exists',
  'schema-valid',
  'human-approved',
  'predecessor-complete',
  'command-passes',
]);

export type GateConditionType = z.infer<typeof GateConditionType>;

export const GateConditionSchema = z.object({
  type: GateConditionType,
  description: z.string().optional(),
  /** For artifact-exists: which artifact name to check */
  artifactName: z.string().optional(),
  /**
   * For artifact-exists / schema-valid: the stage category that produces this artifact.
   * When set, the DAG validator treats this as a declared cross-stage dependency
   * (informational warning) rather than a DAG error. Use when the artifact is produced
   * by a prior stage in the kata sequence — e.g., a build step that needs a plan output.
   */
  sourceStage: z.string().optional(),
  /** For predecessor-complete: which stage must be done */
  predecessorType: z.string().optional(),
  /**
   * For command-passes: the shell command to run.
   *
   * The command string is passed directly to the system shell (shell: true).
   * Trust model: stage definitions are authored by the project owner and run
   * with their full user permissions. If using shared stage packages, only
   * load stage definitions from trusted sources.
   */
  command: z.string().optional(),
});

export type GateCondition = z.infer<typeof GateConditionSchema>;

export const GateType = z.enum(['entry', 'exit']);

export type GateType = z.infer<typeof GateType>;

export const GateSchema = z.object({
  type: GateType,
  conditions: z.array(GateConditionSchema).default([]),
  required: z.boolean().default(true),
});

export type Gate = z.infer<typeof GateSchema>;

export const GateResultSchema = z.object({
  gate: GateSchema,
  passed: z.boolean(),
  results: z.array(
    z.object({
      condition: GateConditionSchema,
      passed: z.boolean(),
      detail: z.string().optional(),
    })
  ),
  evaluatedAt: z.string().datetime(),
});

export type GateResult = z.infer<typeof GateResultSchema>;
