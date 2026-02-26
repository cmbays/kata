import type { RunSummary } from './types.js';
import { analyzeFlavorFrequency, analyzeRecurringGaps } from './cross-run-analyzer.js';

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    betId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    stagesCompleted: 1,
    gapCount: 0,
    gapsBySeverity: { low: 0, medium: 0, high: 0 },
    avgConfidence: null,
    artifactPaths: [],
    stageDetails: [],
    yoloDecisionCount: 0,
    ...overrides,
  };
}

describe('analyzeFlavorFrequency', () => {
  it('returns empty map for empty input', () => {
    const result = analyzeFlavorFrequency([]);
    expect(result.size).toBe(0);
  });

  it('returns empty map when no stageDetails present', () => {
    const summaries = [makeSummary(), makeSummary()];
    const result = analyzeFlavorFrequency(summaries);
    expect(result.size).toBe(0);
  });

  it('counts each flavor once per run (not per stage)', () => {
    // Same flavor appears in 2 stages of the same run → should count as 1
    const summary = makeSummary({
      stageDetails: [
        { category: 'build', selectedFlavors: ['tdd'], gaps: [] },
        { category: 'review', selectedFlavors: ['tdd'], gaps: [] },
      ],
    });
    const result = analyzeFlavorFrequency([summary]);
    expect(result.get('tdd')).toBe(1);
  });

  it('counts flavors across multiple runs', () => {
    const s1 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: ['tdd', 'lint'], gaps: [] }],
    });
    const s2 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: ['tdd'], gaps: [] }],
    });
    const s3 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: ['lint', 'e2e'], gaps: [] }],
    });

    const result = analyzeFlavorFrequency([s1, s2, s3]);
    expect(result.get('tdd')).toBe(2);  // runs 1 and 2
    expect(result.get('lint')).toBe(2); // runs 1 and 3
    expect(result.get('e2e')).toBe(1);  // run 3 only
  });

  it('handles a single run with no flavors selected', () => {
    const summary = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [] }],
    });
    const result = analyzeFlavorFrequency([summary]);
    expect(result.size).toBe(0);
  });
});

describe('analyzeRecurringGaps', () => {
  it('returns empty array for empty input', () => {
    expect(analyzeRecurringGaps([])).toEqual([]);
  });

  it('returns empty array when no summaries have gaps', () => {
    const summaries = [makeSummary(), makeSummary()];
    expect(analyzeRecurringGaps(summaries)).toEqual([]);
  });

  it('returns empty array when gaps appear in only 1 bet', () => {
    const summary = makeSummary({
      stageDetails: [
        { category: 'build', selectedFlavors: [], gaps: [{ description: 'Missing tests', severity: 'high' }] },
      ],
    });
    expect(analyzeRecurringGaps([summary])).toEqual([]);
  });

  it('returns gap when same description appears in 2+ bets', () => {
    const s1 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [{ description: 'Missing tests', severity: 'high' }] }],
    });
    const s2 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [{ description: 'Missing tests', severity: 'high' }] }],
    });

    const result = analyzeRecurringGaps([s1, s2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.description).toBe('Missing tests');
    expect(result[0]!.betCount).toBe(2);
    expect(result[0]!.severity).toBe('high');
  });

  it('counts each gap description only once per bet even if it appears in multiple stages', () => {
    // Same gap description in 2 stages of same run → should count as 1 bet
    const s1 = makeSummary({
      stageDetails: [
        { category: 'build', selectedFlavors: [], gaps: [{ description: 'No docs', severity: 'low' }] },
        { category: 'review', selectedFlavors: [], gaps: [{ description: 'No docs', severity: 'low' }] },
      ],
    });
    const s2 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [{ description: 'No docs', severity: 'low' }] }],
    });

    const result = analyzeRecurringGaps([s1, s2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.betCount).toBe(2);
  });

  it('sorts by betCount descending', () => {
    const commonGap = 'Security review missing';
    const lessCommonGap = 'E2E tests missing';

    // commonGap in 3 bets, lessCommonGap in 2 bets
    const makeWithGaps = (gaps: Array<{ description: string; severity: 'low' | 'medium' | 'high' }>) =>
      makeSummary({ stageDetails: [{ category: 'build', selectedFlavors: [], gaps }] });

    const summaries = [
      makeWithGaps([{ description: commonGap, severity: 'high' }, { description: lessCommonGap, severity: 'medium' }]),
      makeWithGaps([{ description: commonGap, severity: 'high' }, { description: lessCommonGap, severity: 'medium' }]),
      makeWithGaps([{ description: commonGap, severity: 'high' }]),
    ];

    const result = analyzeRecurringGaps(summaries);
    expect(result).toHaveLength(2);
    expect(result[0]!.description).toBe(commonGap);
    expect(result[0]!.betCount).toBe(3);
    expect(result[1]!.description).toBe(lessCommonGap);
    expect(result[1]!.betCount).toBe(2);
  });

  it('excludes gaps that appear in only 1 bet', () => {
    const s1 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [{ description: 'Unique gap', severity: 'low' }] }],
    });
    const s2 = makeSummary({
      stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [{ description: 'Another unique', severity: 'medium' }] }],
    });
    // Neither gap appears in both bets — no recurring gaps
    expect(analyzeRecurringGaps([s1, s2])).toEqual([]);
  });
});
