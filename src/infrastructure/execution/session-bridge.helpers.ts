/**
 * Detect whether bridge-run metadata has changed vs its refreshed values.
 */
export function hasBridgeRunMetadataChanged(
  current: { betName?: string; cycleName?: string },
  refreshed: { betName?: string; cycleName?: string },
): boolean {
  return refreshed.betName !== current.betName || refreshed.cycleName !== current.cycleName;
}

/**
 * Find the earliest timestamp from a list of ISO strings.
 * Returns undefined if the array is empty.
 */
export function findEarliestTimestamp(timestamps: readonly string[]): string | undefined {
  if (timestamps.length === 0) return undefined;
  return [...timestamps].sort()[0];
}

/**
 * Resolve the agent ID from primary and legacy fields.
 */
export function resolveAgentId(
  agentId: string | undefined,
  katakaId: string | undefined,
): string | undefined {
  return agentId ?? katakaId;
}

/**
 * Compute budget percent from tokens used and budget total.
 * Returns null when no budget is configured.
 */
export function computeBudgetPercent(
  tokensUsed: number,
  tokenBudget: number | undefined,
): { percent: number; tokenEstimate: number } | null {
  if (!tokenBudget) return null;
  return {
    percent: Math.round((tokensUsed / tokenBudget) * 100),
    tokenEstimate: tokensUsed,
  };
}

/**
 * Extract token total from a raw history entry for a given cycle.
 * Returns null if the entry does not belong to the cycle.
 */
export function extractHistoryTokenTotal(
  entry: { cycleId?: string; tokenUsage?: { total?: number } },
  targetCycleId: string,
): number | null {
  if (entry.cycleId !== targetCycleId) return null;
  return entry.tokenUsage?.total ?? null;
}

/**
 * Count non-empty lines in a JSONL-format content string.
 * Returns 0 for empty or whitespace-only content.
 */
export function countJsonlContent(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split('\n').length : 0;
}
