export interface PersistedBridgeRunTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface PersistedBridgeRunCompletionSnapshot {
  status: 'in-progress' | 'complete' | 'failed';
  startedAt: string;
  completedAt?: string;
  tokenUsage?: PersistedBridgeRunTokenUsage;
}

export interface CycleCompletionTotals {
  completedBets: number;
  totalDurationMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; total: number } | null;
}

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

  return new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
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
