import {
  extractIssueNumbers,
  checkBetsForIssueRefs,
  formatStalenessWarnings,
} from './staleness-check.js';
import type { Bet } from '@domain/types/bet.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBet(description: string, overrides: Partial<Bet> = {}): Bet {
  return {
    id: crypto.randomUUID(),
    description,
    appetite: 20,
    issueRefs: [],
    outcome: 'pending',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// extractIssueNumbers
// ---------------------------------------------------------------------------

describe('extractIssueNumbers', () => {
  it('returns empty array when no issue refs present', () => {
    expect(extractIssueNumbers('Implement auth module')).toEqual([]);
  });

  it('extracts a single issue number', () => {
    expect(extractIssueNumbers('Fix bug described in #311')).toEqual([311]);
  });

  it('extracts multiple issue numbers', () => {
    expect(extractIssueNumbers('Covers #311 and #312')).toEqual([311, 312]);
  });

  it('deduplicates repeated issue refs', () => {
    expect(extractIssueNumbers('#311 relates to #311')).toEqual([311]);
  });

  it('handles issue ref at start of string', () => {
    expect(extractIssueNumbers('#42 is done')).toEqual([42]);
  });

  it('handles issue ref at end of string', () => {
    expect(extractIssueNumbers('Resolves #99')).toEqual([99]);
  });

  it('extracts from mixed text', () => {
    expect(
      extractIssueNumbers('Add staleness detection (#323) — follow-up from #316'),
    ).toEqual([323, 316]);
  });

  it('does not extract non-numeric hash sequences', () => {
    expect(extractIssueNumbers('color: #ff0000')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkBetsForIssueRefs
// ---------------------------------------------------------------------------

describe('checkBetsForIssueRefs', () => {
  it('returns empty warnings when no bets have issue refs', () => {
    const bets = [
      makeBet('Build auth module'),
      makeBet('Refactor pipeline'),
    ];
    const result = checkBetsForIssueRefs(bets);
    expect(result.warnings).toHaveLength(0);
    expect(result.allBetsHaveIssueRefs).toBe(false);
  });

  it('returns a warning for a bet with an issue ref', () => {
    const bet = makeBet('Fix regression in #311');
    const result = checkBetsForIssueRefs([bet]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.betId).toBe(bet.id);
    expect(result.warnings[0]!.issueNumbers).toEqual([311]);
  });

  it('returns warnings only for bets that have issue refs', () => {
    const betWithRef = makeBet('Implements #200');
    const betWithout = makeBet('Add logging');
    const result = checkBetsForIssueRefs([betWithRef, betWithout]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.betId).toBe(betWithRef.id);
    expect(result.allBetsHaveIssueRefs).toBe(false);
  });

  it('sets allBetsHaveIssueRefs true when every bet has a ref', () => {
    const bets = [
      makeBet('Covers #100'),
      makeBet('Fixes #200 and #201'),
    ];
    const result = checkBetsForIssueRefs(bets);
    expect(result.allBetsHaveIssueRefs).toBe(true);
  });

  it('sets allBetsHaveIssueRefs false for empty bet list', () => {
    const result = checkBetsForIssueRefs([]);
    expect(result.allBetsHaveIssueRefs).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('captures multiple issue numbers per bet', () => {
    const bet = makeBet('Consolidates #10 and #11 work');
    const result = checkBetsForIssueRefs([bet]);
    expect(result.warnings[0]!.issueNumbers).toEqual([10, 11]);
  });
});

// ---------------------------------------------------------------------------
// formatStalenessWarnings
// ---------------------------------------------------------------------------

describe('formatStalenessWarnings', () => {
  it('returns empty array when there are no warnings', () => {
    const result = checkBetsForIssueRefs([makeBet('No refs here')]);
    expect(formatStalenessWarnings(result)).toEqual([]);
  });

  it('includes the warning header', () => {
    const result = checkBetsForIssueRefs([makeBet('Fix #311')]);
    const lines = formatStalenessWarnings(result);
    expect(lines[0]).toContain('Warning');
    expect(lines[0]).toContain('closed');
  });

  it('includes the bet description in output', () => {
    const result = checkBetsForIssueRefs([makeBet('Add staleness detection (#323)')]);
    const output = formatStalenessWarnings(result).join('\n');
    expect(output).toContain('Add staleness detection (#323)');
  });

  it('includes the issue number with # prefix', () => {
    const result = checkBetsForIssueRefs([makeBet('Refs #42')]);
    const output = formatStalenessWarnings(result).join('\n');
    expect(output).toContain('#42');
  });

  it('shows a note about verifying open issues when all bets have issue refs', () => {
    const bets = [makeBet('Only bet #99')];
    const result = checkBetsForIssueRefs(bets);
    const output = formatStalenessWarnings(result).join('\n');
    expect(output).toContain('Verify they are still open');
  });

  it('does NOT show --force hint for plain tracking refs (not likelyStale)', () => {
    const bets = [makeBet('Has ref #99'), makeBet('No ref here')];
    const result = checkBetsForIssueRefs(bets);
    const output = formatStalenessWarnings(result).join('\n');
    expect(output).not.toContain('--force');
  });

  it('shows --force hint when a bet has explicit done language (likelyStale)', () => {
    const result = checkBetsForIssueRefs([makeBet('closes #311 — auth work done')]);
    const output = formatStalenessWarnings(result).join('\n');
    expect(output).toContain('--force');
    expect(output).toContain('closes/fixes/resolves');
  });
});

// ---------------------------------------------------------------------------
// likelyStale detection
// ---------------------------------------------------------------------------

describe('checkBetsForIssueRefs — likelyStale', () => {
  it('is false when no issue refs present', () => {
    const result = checkBetsForIssueRefs([makeBet('Build auth module')]);
    expect(result.likelyStale).toBe(false);
  });

  it('is false for plain tracking refs without done language', () => {
    const result = checkBetsForIssueRefs([makeBet('Implements #200')]);
    expect(result.likelyStale).toBe(false);
  });

  it('is true for "closes #N" language', () => {
    const result = checkBetsForIssueRefs([makeBet('closes #311')]);
    expect(result.likelyStale).toBe(true);
  });

  it('is true for "fixes #N" language', () => {
    const result = checkBetsForIssueRefs([makeBet('fixes #100')]);
    expect(result.likelyStale).toBe(true);
  });

  it('is true for "resolves #N" language', () => {
    const result = checkBetsForIssueRefs([makeBet('resolves #42')]);
    expect(result.likelyStale).toBe(true);
  });

  it('is true for past-tense "fixed #N" language', () => {
    const result = checkBetsForIssueRefs([makeBet('fixed #77')]);
    expect(result.likelyStale).toBe(true);
  });

  it('is true for "(done)" in description alongside issue ref', () => {
    const result = checkBetsForIssueRefs([makeBet('Auth work #50 (done)')]);
    expect(result.likelyStale).toBe(true);
  });

  it('is false when done language exists but no issue ref', () => {
    // likelyStale is only set on bets that also have issue refs
    const result = checkBetsForIssueRefs([makeBet('closes the loop (done)')]);
    expect(result.likelyStale).toBe(false);
  });
});
