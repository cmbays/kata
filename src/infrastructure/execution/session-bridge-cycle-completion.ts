import { z } from 'zod/v4';

export const PersistedBridgeRunTokenUsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
});

export type PersistedBridgeRunTokenUsage = z.infer<typeof PersistedBridgeRunTokenUsageSchema>;

export const PersistedBridgeRunCompletionSnapshotSchema = z.object({
  status: z.enum(['in-progress', 'complete', 'failed']),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  tokenUsage: PersistedBridgeRunTokenUsageSchema.optional(),
});

export type PersistedBridgeRunCompletionSnapshot = z.infer<typeof PersistedBridgeRunCompletionSnapshotSchema>;

export const CycleCompletionTotalsSchema = z.object({
  completedBets: z.number().int().min(0),
  totalDurationMs: z.number().min(0),
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    total: z.number().int().min(0),
  }).nullable(),
});

export type CycleCompletionTotals = z.infer<typeof CycleCompletionTotalsSchema>;

export function summarizeCycleCompletion(
  runs: PersistedBridgeRunCompletionSnapshot[],
): CycleCompletionTotals {
  const totals: CycleCompletionTotals = {
    completedBets: 0,
    totalDurationMs: 0,
    tokenUsage: null,
  };

  for (const run of runs) {
    totals.completedBets += run.status === 'complete' ? 1 : 0;
    totals.totalDurationMs += calculateRunDurationMs(run);
    totals.tokenUsage = mergeTokenUsage(totals.tokenUsage, run.tokenUsage);
  }

  return totals;
}

function calculateRunDurationMs(run: PersistedBridgeRunCompletionSnapshot): number {
  if (!run.completedAt) {
    return 0;
  }

  const startedAtMs = Date.parse(run.startedAt);
  const completedAtMs = Date.parse(run.completedAt);

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(completedAtMs)) {
    return 0;
  }

  return Math.max(0, completedAtMs - startedAtMs);
}

function mergeTokenUsage(
  existing: CycleCompletionTotals['tokenUsage'],
  tokenUsage?: PersistedBridgeRunTokenUsage,
): CycleCompletionTotals['tokenUsage'] {
  if (!tokenUsage) {
    return existing;
  }

  return {
    inputTokens: (existing?.inputTokens ?? 0) + tokenUsage.inputTokens,
    outputTokens: (existing?.outputTokens ?? 0) + tokenUsage.outputTokens,
    total: (existing?.total ?? 0) + tokenUsage.totalTokens,
  };
}
