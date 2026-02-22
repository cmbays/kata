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
  }).default(() => ({ adapter: 'manual' as const, config: {} })),
  /** Custom stage paths to load */
  customStagePaths: z.array(z.string()).default([]),
  /** Project metadata */
  project: z.object({
    name: z.string().optional(),
    repository: z.string().optional(),
  }).default({}),
});

export type KataConfig = z.infer<typeof KataConfigSchema>;
