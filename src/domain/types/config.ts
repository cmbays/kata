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
  /**
   * CLI output vocabulary mode.
   * - 'thematic' (default): Japanese karate-inspired terms (gyo, waza, ryu, …)
   * - 'plain': Standard English equivalents (stage, step, flavor, …)
   * Can be overridden per-command with --plain or KATA_PLAIN=1.
   */
  outputMode: z.enum(['thematic', 'plain']).default('thematic'),
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
  /** User profile — captured during init and used to tune output depth */
  user: z.object({
    /**
     * Self-reported experience level with Kata and development methodology.
     * - 'beginner': First time using Kata — more guidance, simpler output
     * - 'intermediate': Familiar with the concepts — standard output
     * - 'experienced': Power user — terse output, full graph context
     */
    experienceLevel: z.enum(['beginner', 'intermediate', 'experienced']).default('intermediate'),
  }).default(() => ({ experienceLevel: 'intermediate' as const })),
  /** Cooldown session settings */
  cooldown: z.object({
    /**
     * How deeply to run the LLM synthesis pipeline during cooldown.
     * - 'quick': Filter + basic pattern detection only (fast)
     * - 'standard': Full 3-step pipeline (default)
     * - 'thorough': Multiple passes + cross-cycle analysis (major milestones)
     */
    synthesisDepth: z.enum(['quick', 'standard', 'thorough']).default('standard'),
  }).default(() => ({ synthesisDepth: 'standard' as const })),
});

export type KataConfig = z.infer<typeof KataConfigSchema>;
