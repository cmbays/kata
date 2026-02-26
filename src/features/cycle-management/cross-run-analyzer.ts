import type { RunSummary } from './types.js';

/**
 * Returns flavor name → count of runs that used it.
 * Counts each flavor once per run (not per stage occurrence).
 */
export function analyzeFlavorFrequency(summaries: RunSummary[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const summary of summaries) {
    const seenFlavors = new Set<string>();
    for (const stage of summary.stageDetails) {
      for (const flavor of stage.selectedFlavors) {
        if (!seenFlavors.has(flavor)) {
          seenFlavors.add(flavor);
          freq.set(flavor, (freq.get(flavor) ?? 0) + 1);
        }
      }
    }
  }
  return freq;
}

/**
 * Returns gaps that recurred in 2 or more distinct bets, sorted by betCount descending.
 * Gaps are matched by description string. Each gap is counted at most once per bet
 * (even if it appeared in multiple stages of the same run).
 */
export function analyzeRecurringGaps(
  summaries: RunSummary[],
): Array<{ description: string; severity: 'low' | 'medium' | 'high'; betCount: number }> {
  const gapMap = new Map<string, { severity: 'low' | 'medium' | 'high'; betCount: number }>();

  for (const summary of summaries) {
    const seenDescriptions = new Set<string>();
    for (const stage of summary.stageDetails) {
      for (const gap of stage.gaps) {
        if (!seenDescriptions.has(gap.description)) {
          seenDescriptions.add(gap.description);
          const existing = gapMap.get(gap.description);
          if (existing) {
            existing.betCount++;
          } else {
            gapMap.set(gap.description, { severity: gap.severity, betCount: 1 });
          }
        }
      }
    }
  }

  return Array.from(gapMap.entries())
    .filter(([, v]) => v.betCount >= 2)
    .map(([description, v]) => ({ description, severity: v.severity, betCount: v.betCount }))
    .sort((a, b) => b.betCount - a.betCount);
}
