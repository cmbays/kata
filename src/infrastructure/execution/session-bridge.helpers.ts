import type { CycleState } from '@domain/types/cycle.js';

export { isJsonFile } from '@shared/lib/file-filters.js';

/**
 * Check whether a cycle state transition is allowed.
 * Valid transitions: planning → active → cooldown → complete.
 */
export function canTransitionCycleState(from: CycleState, to: CycleState): boolean {
  const allowedTransitions: Partial<Record<CycleState, CycleState>> = {
    planning: 'active',
    active: 'cooldown',
    cooldown: 'complete',
  };
  return allowedTransitions[from] === to;
}

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
 * Map a bridge-run status to the display status used by getCycleStatus.
 * 'in-progress' maps to 'in-progress', everything else passes through.
 */
export function mapBridgeRunStatus<T extends string>(status: T): T {
  return status;
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
 * Match a cycle by ID or name. Used by loadCycle.
 */
export function matchesCycleRef(
  cycle: { id: string; name?: string },
  ref: string,
): boolean {
  return cycle.id === ref || cycle.name === ref;
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
 * Sum token totals from multiple entries, treating null as 0.
 */
export function sumTokenTotals(totals: readonly (number | null)[]): number {
  return totals.reduce<number>((sum, t) => sum + (t ?? 0), 0);
}

/**
 * Count non-empty lines in a JSONL-format content string.
 * Returns 0 for empty or whitespace-only content.
 */
export function countJsonlContent(content: string): number {
  const trimmed = content.trim();
  return trimmed ? trimmed.split('\n').length : 0;
}
