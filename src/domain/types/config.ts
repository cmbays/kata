import { z } from 'zod/v4';

export const ExecutionAdapterType = z.enum([
  'manual',
  'claude-cli',
  'composio',
]);

export type ExecutionAdapterType = z.infer<typeof ExecutionAdapterType>;

export const KataConfigSchema = z.object({
  /** Methodology framework (default: shape-up) */
  methodology: z.string().default('shape-up'),
  /** Execution adapter configuration */
  execution: z.object({
    adapter: ExecutionAdapterType.default('manual'),
    config: z.record(z.string(), z.unknown()).default({}),
    /**
     * Minimum confidence score [0, 1] before a decision triggers a gate.
     * Decisions below this threshold require human approval (or --yolo to skip).
     * Defaults to 0.7.
     */
    confidenceThreshold: z.number().min(0).max(1).default(0.7),
  }).default(() => ({ adapter: 'manual' as const, config: {}, confidenceThreshold: 0.7 })),
  /** Custom stage paths to load */
  customStagePaths: z.array(z.string()).default([]),
  /** Project metadata */
  project: z.object({
    name: z.string().optional(),
    repository: z.string().optional(),
  }).default({}),
});

export type KataConfig = z.infer<typeof KataConfigSchema>;
