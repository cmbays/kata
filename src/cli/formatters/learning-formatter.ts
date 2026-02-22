import type { SuggestedLearning, PromptUpdate } from '@features/self-improvement/learning-extractor.js';

/**
 * Format a single suggested learning for interactive review.
 */
export function formatSuggestedLearning(suggestion: SuggestedLearning): string {
  const lines: string[] = [];

  lines.push('=== Suggested Learning ===');
  lines.push('');
  lines.push(`  Tier:       ${suggestion.tier}`);
  lines.push(`  Category:   ${suggestion.category}`);
  if (suggestion.stageType) {
    lines.push(`  Stage:      ${suggestion.stageType}`);
  }
  lines.push(`  Confidence: ${suggestion.confidence.toFixed(2)}`);
  lines.push(`  Evidence:   ${suggestion.evidenceCount} observation(s)`);
  lines.push('');
  lines.push(`  Content:`);
  lines.push(`    ${suggestion.content}`);
  lines.push('');

  // Show a sample of evidence
  const evidenceSample = suggestion.pattern.evidence.slice(0, 3);
  if (evidenceSample.length > 0) {
    lines.push('  Evidence samples:');
    for (const e of evidenceSample) {
      lines.push(`    - ${e.observation}`);
    }
    if (suggestion.pattern.evidence.length > 3) {
      lines.push(`    ... and ${suggestion.pattern.evidence.length - 3} more`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a prompt update as a readable diff.
 */
export function formatPromptUpdateDiff(update: PromptUpdate): string {
  const lines: string[] = [];

  lines.push('=== Prompt Update ===');
  lines.push('');
  lines.push(`  Stage:   ${update.stageType}`);
  lines.push(`  Section: ${update.section}`);
  if (update.currentPromptPath) {
    lines.push(`  File:    ${update.currentPromptPath}`);
  }
  lines.push('');

  // Show diff-style additions
  lines.push('  Changes:');
  for (const line of update.suggestion.split('\n')) {
    lines.push(`    + ${line}`);
  }
  lines.push('');
  lines.push(`  Rationale: ${update.rationale}`);
  lines.push(`  Based on ${update.basedOnLearnings.length} learning(s)`);

  return lines.join('\n');
}

/**
 * Format the review session summary.
 */
export function formatReviewSummary(
  accepted: number,
  rejected: number,
  promptsUpdated: number,
): string {
  const lines: string[] = [];

  lines.push('=== Bunkai Review Summary ===');
  lines.push('');
  lines.push(`  Learnings accepted:  ${accepted}`);
  lines.push(`  Learnings rejected:  ${rejected}`);
  lines.push(`  Prompts updated:     ${promptsUpdated}`);

  const total = accepted + rejected;
  if (total > 0) {
    const pct = ((accepted / total) * 100).toFixed(0);
    lines.push(`  Acceptance rate:     ${pct}%`);
  }

  return lines.join('\n');
}

/**
 * Format suggested learnings as JSON output.
 */
export function formatSuggestedLearningJson(suggestions: SuggestedLearning[]): string {
  return JSON.stringify(
    suggestions.map((s) => ({
      tier: s.tier,
      category: s.category,
      content: s.content,
      stageType: s.stageType,
      confidence: s.confidence,
      evidenceCount: s.evidenceCount,
      patternId: s.pattern.id,
    })),
    null,
    2,
  );
}
