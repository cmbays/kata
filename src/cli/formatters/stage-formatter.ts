import type { StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { StageRule } from '@domain/types/rule.js';
import type { Decision } from '@domain/types/decision.js';
import { getLexicon, cap } from '@cli/lexicon.js';

export interface StageCategoryEntry {
  category: StageCategory;
  flavorCount: number;
  ruleCount: number;
}

export interface StageInspectData {
  category: StageCategory;
  flavors: Flavor[];
  rules: StageRule[];
  recentDecisions: Decision[];
}

/**
 * Format stage categories as an aligned text table.
 */
export function formatStageCategoryTable(entries: StageCategoryEntry[], plain?: boolean): string {
  if (entries.length === 0) {
    return 'No stage categories found.';
  }
  const lex = getLexicon(plain);

  const header = padColumns([cap(lex.stage), cap(lex.flavor) + 's', 'Rules']);
  const separator = '-'.repeat(header.length);
  const rows = entries.map((e) =>
    padColumns([e.category, String(e.flavorCount), String(e.ruleCount ?? 0)]),
  );

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a stage category detail view including orchestrator info, flavors, rules, decisions.
 */
export function formatStageCategoryDetail(data: StageInspectData, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`${cap(lex.stage)}: ${data.category}`);
  lines.push('');

  // Flavors
  if (data.flavors.length > 0) {
    lines.push(`${cap(lex.flavor)}s (${data.flavors.length}):`);
    for (const f of data.flavors) {
      const stepCount = f.steps.length;
      const desc = f.description ? ` — ${f.description}` : '';
      lines.push(`  - ${f.name} (${stepCount} ${lex.step}${stepCount !== 1 ? 's' : ''})${desc}`);
    }
  } else {
    lines.push(`${cap(lex.flavor)}s: (none registered)`);
  }
  lines.push('');

  // Rules
  if (data.rules.length > 0) {
    lines.push(`Rules (${data.rules.length}):`);
    for (const r of data.rules) {
      lines.push(`  - ${r.effect} "${r.name}": magnitude=${r.magnitude.toFixed(2)}, confidence=${(r.confidence * 100).toFixed(0)}%`);
    }
  } else {
    lines.push('Rules: (none active)');
  }
  lines.push('');

  // Recent decisions
  if (data.recentDecisions.length > 0) {
    lines.push(`Recent ${lex.decision}s (${data.recentDecisions.length}):`);
    for (const d of data.recentDecisions) {
      const conf = `${(d.confidence * 100).toFixed(0)}%`;
      const outcome = d.outcome?.artifactQuality ?? 'pending';
      lines.push(`  - ${d.decisionType}: ${d.selection} (confidence: ${conf}, outcome: ${outcome})`);
    }
  } else {
    lines.push(`${cap(lex.decision)}s: (no recent ${lex.decision}s)`);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format stage categories as JSON.
 */
export function formatStageCategoryJson(entries: StageCategoryEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

// ---- Helpers ----

function padColumns(values: string[]): string {
  const widths = [16, 10, 8];
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}

