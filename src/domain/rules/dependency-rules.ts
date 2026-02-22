import type { Bet } from '@domain/types/bet.js';

export interface DependencyWarning {
  betIds: [string, string];
  reason: string;
  suggestion: string;
}

/**
 * Detect cross-bet dependencies within a cycle.
 * Cross-bet dependencies are a methodology smell (D5).
 * Returns warnings, NOT blockers -- the user can acknowledge and proceed.
 */
export function detectCrossBetDependencies(bets: Bet[]): DependencyWarning[] {
  const warnings: DependencyWarning[] = [];

  for (let i = 0; i < bets.length; i++) {
    for (let j = i + 1; j < bets.length; j++) {
      const betA = bets[i]!;
      const betB = bets[j]!;

      // Check for shared project references
      if (betA.projectRef && betB.projectRef && betA.projectRef === betB.projectRef) {
        warnings.push({
          betIds: [betA.id, betB.id],
          reason: `Both bets reference the same project: "${betA.projectRef}"`,
          suggestion:
            'Consider combining into a single bet, sequencing across cycles, or decoupling the work.',
        });
      }

      // Check for overlapping issue references
      const overlappingIssues = betA.issueRefs.filter((ref) =>
        betB.issueRefs.includes(ref),
      );
      if (overlappingIssues.length > 0) {
        warnings.push({
          betIds: [betA.id, betB.id],
          reason: `Bets share issue references: ${overlappingIssues.join(', ')}`,
          suggestion:
            'Shared issues suggest coupling. Combine the bets, sequence them across cycles, or split the shared issues into their own bet.',
        });
      }
    }
  }

  return warnings;
}
