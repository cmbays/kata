import { z } from 'zod/v4';

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  cacheCreationTokens: z.number().int().min(0).default(0),
  cacheReadTokens: z.number().int().min(0).default(0),
  total: z.number().int().min(0).default(0),
});

export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const ExecutionHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  pipelineId: z.string().uuid(),
  stageType: z.string(),
  stageFlavor: z.string().optional(),
  stageIndex: z.number().int().min(0),
  /** Which adapter was used */
  adapter: z.string(),
  /** Token usage for this stage execution */
  tokenUsage: TokenUsageSchema.optional(),
  /** Duration in milliseconds */
  durationMs: z.number().int().min(0).optional(),
  /** Artifacts produced */
  artifactNames: z.array(z.string()).default([]),
  /** Gate results */
  entryGatePassed: z.boolean().optional(),
  exitGatePassed: z.boolean().optional(),
  /** Learnings captured during this stage */
  learningIds: z.array(z.string()).default([]),
  /** Cycle/bet context if mapped */
  cycleId: z.string().uuid().optional(),
  betId: z.string().uuid().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
});

export type ExecutionHistoryEntry = z.infer<typeof ExecutionHistoryEntrySchema>;
