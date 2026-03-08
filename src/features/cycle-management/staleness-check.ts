import type { Bet } from '@domain/types/bet.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StalenessBetWarning {
  betId: string;
  betDescription: string;
  issueNumbers: number[];
}

export interface StalenessCheckResult {
  warnings: StalenessBetWarning[];
  /** True when every bet has at least one issue ref (all bets may be stale). */
  allBetsHaveIssueRefs: boolean;
  /**
   * True when at least one bet contains explicit "done" signals alongside issue
   * refs — e.g. "closes #N", "fixed #N", "(done)", etc. These are strong
   * indicators the work is already complete and launching would be a mistake.
   */
  likelyStale: boolean;
}

// ---------------------------------------------------------------------------
// Pattern
// ---------------------------------------------------------------------------

/**
 * Matches GitHub-style issue references: #N, #NN, etc.
 */
const ISSUE_REF_PATTERN = /#(\d+)/g;

/**
 * Matches explicit "done" signals that strongly suggest a bet is already
 * complete. Examples that match:
 *   closes #311   close #311   closed #311
 *   fixes #311    fix #311     fixed #311
 *   resolves #311 resolve #311 resolved #311
 *   (done)        done:        ✓ done
 */
const STALE_SIGNAL_PATTERN =
  /\b(?:closes?|closed|fixes?|fixed|resolves?|resolved)\s+#\d+|\(done\)|done[:\s]/i;

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Extract all #N issue numbers from a string.
 */
export function extractIssueNumbers(text: string): number[] {
  const matches: number[] = [];
  let match: RegExpExecArray | null;
  ISSUE_REF_PATTERN.lastIndex = 0;
  while ((match = ISSUE_REF_PATTERN.exec(text)) !== null) {
    const n = parseInt(match[1]!, 10);
    if (!matches.includes(n)) {
      matches.push(n);
    }
  }
  return matches;
}

/**
 * Scan a list of bets for #N issue references in their descriptions.
 * Returns one warning per bet that contains at least one issue ref.
 *
 * Pattern-based check only — no GitHub API is called.
 */
export function checkBetsForIssueRefs(bets: Bet[]): StalenessCheckResult {
  const warnings: StalenessBetWarning[] = [];
  let staleSignalCount = 0;

  for (const bet of bets) {
    const issueNumbers = extractIssueNumbers(bet.description);
    if (issueNumbers.length > 0) {
      warnings.push({
        betId: bet.id,
        betDescription: bet.description,
        issueNumbers,
      });
      if (STALE_SIGNAL_PATTERN.test(bet.description)) {
        staleSignalCount++;
      }
    }
  }

  const allBetsHaveIssueRefs =
    bets.length > 0 && warnings.length === bets.length;

  // likelyStale: at least one bet has explicit "done" language alongside an
  // issue ref. Pure tracking refs like "implements #N" are warn-only.
  const likelyStale = staleSignalCount > 0;

  return { warnings, allBetsHaveIssueRefs, likelyStale };
}

/**
 * Format staleness warnings as human-readable lines for CLI output.
 * Returns an empty array when there are no warnings.
 */
export function formatStalenessWarnings(result: StalenessCheckResult): string[] {
  if (result.warnings.length === 0) return [];

  const lines: string[] = [
    'Warning: the following bets reference GitHub issues that may already be closed:',
    '',
  ];

  for (const w of result.warnings) {
    const refs = w.issueNumbers.map((n) => `#${n}`).join(', ');
    lines.push(`  Bet: "${w.betDescription}"`);
    lines.push(`  References: ${refs} — verify these are still open before launching`);
    lines.push('');
  }

  if (result.likelyStale) {
    lines.push(
      'One or more bets contain "closes/fixes/resolves" language — these look like already-completed work.',
    );
    lines.push('Re-run with --force to launch anyway.');
    lines.push('');
  } else if (result.allBetsHaveIssueRefs) {
    lines.push(
      'All bets reference issues. Verify they are still open before launching.',
    );
    lines.push('');
  }

  return lines;
}
