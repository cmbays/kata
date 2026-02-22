import type { Learning } from '@domain/types/learning.js';
import type { KnowledgeStats } from '@infra/knowledge/knowledge-store.js';

/**
 * Format learnings as an aligned text table.
 */
export function formatLearningTable(learnings: Learning[]): string {
  if (learnings.length === 0) {
    return 'No learnings found.';
  }

  const header = padColumns(['Tier', 'Category', 'Confidence', 'Content']);
  const separator = '-'.repeat(header.length);
  const rows = learnings.map((l) => {
    const content = l.content.length > 50 ? l.content.slice(0, 47) + '...' : l.content;
    return padColumns([l.tier, l.category, l.confidence.toFixed(2), content]);
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format knowledge store summary statistics.
 */
export function formatKnowledgeStats(stats: KnowledgeStats): string {
  const lines: string[] = [];

  lines.push('=== Knowledge Store Stats ===');
  lines.push('');
  lines.push(`Total Learnings: ${stats.total}`);
  lines.push(`Average Confidence: ${stats.averageConfidence.toFixed(2)}`);
  lines.push('');

  lines.push('By Tier:');
  lines.push(`  Stage:    ${stats.byTier.stage}`);
  lines.push(`  Category: ${stats.byTier.category}`);
  lines.push(`  Agent:    ${stats.byTier.agent}`);
  lines.push('');

  if (stats.topCategories.length > 0) {
    lines.push('Top Categories:');
    for (const cat of stats.topCategories.slice(0, 10)) {
      lines.push(`  ${cat.category}: ${cat.count}`);
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format learnings as JSON.
 */
export function formatLearningJson(learnings: Learning[]): string {
  return JSON.stringify(learnings, null, 2);
}

/**
 * Format knowledge stats as JSON.
 */
export function formatKnowledgeStatsJson(stats: KnowledgeStats): string {
  return JSON.stringify(stats, null, 2);
}

// ---- Helpers ----

function padColumns(values: string[]): string {
  const widths = [12, 18, 12, 52];
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}
