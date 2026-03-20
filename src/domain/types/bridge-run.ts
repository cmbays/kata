import { z } from 'zod/v4';

/**
 * Schema for bridge-run metadata stored at .kata/bridge-runs/<runId>.json.
 *
 * Bridge runs are the metadata records created by SessionExecutionBridge
 * when preparing and completing runs for in-session agent dispatch.
 */
export const BridgeRunMetaSchema = z.object({
  runId: z.string(),
  betId: z.string(),
  betName: z.string(),
  cycleId: z.string(),
  cycleName: z.string(),
  stages: z.array(z.string()),
  isolation: z.enum(['worktree', 'shared']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(['in-progress', 'complete', 'failed']),
  /** Canonical agent attribution for this run — written to run.json on prepare. */
  agentId: z.string().uuid().optional(),
  /** Compatibility alias for older kataka-attributed metadata. */
  katakaId: z.string().uuid().optional(),
  /**
   * Token usage for this run — populated by complete() when the agent
   * reports token counts via AgentCompletionResult.tokenUsage.
   */
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }).optional(),
});

export type BridgeRunMeta = z.infer<typeof BridgeRunMetaSchema>;
