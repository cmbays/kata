import type { StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { StageRule } from '@domain/types/rule.js';
import type { Decision } from '@domain/types/decision.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, dim, magenta, visiblePadEnd } from '@shared/lib/ansi.js';

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

  const headerCols = [cap(lex.stage), pl(cap(lex.flavor), plain), 'Rules'];
  const header = bold(padColumns(headerCols));
  const separator = dim('-'.repeat(padColumns(headerCols).length));
  const rows = entries.map((e) =>
    padColumns([cyan(e.category), String(e.flavorCount), String(e.ruleCount ?? 0)]),
  );

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a stage category detail view including orchestrator info, flavors, rules, decisions.
 */
export function formatStageCategoryDetail(data: StageInspectData, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  // Card header
  lines.push(bold(`╭─ ${cyan(cap(lex.stage))}: ${cyan(data.category)} ─`));

  // Flavors
  if (data.flavors.length > 0) {
    lines.push(`├─ ${bold(pl(cap(lex.flavor), plain))}  ${dim(`(${data.flavors.length})`)}`);
    for (const f of data.flavors) {
      const stepCount = f.steps.length;
      const count = dim(`${stepCount} ${pl(lex.step, plain, stepCount)}`);
      const desc = f.description ? `  ${dim(f.description)}` : '';
      lines.push(`│  ● ${magenta(f.name)}  ${count}${desc}`);
    }
  } else {
    lines.push(`│  ${dim(`${pl(cap(lex.flavor), plain)}: (none registered)`)}`);
  }

  // Rules
  if (data.rules.length > 0) {
    lines.push(`├─ ${bold('Rules')}  ${dim(`(${data.rules.length})`)}`);
    for (const r of data.rules) {
      lines.push(`│  ● ${r.effect} ${dim(`"${r.name}"`)}  magnitude=${r.magnitude.toFixed(2)}, confidence=${(r.confidence * 100).toFixed(0)}%`);
    }
  } else {
    lines.push(`│  ${dim('Rules: (none active)')}`);
  }

  // Recent decisions
  if (data.recentDecisions.length > 0) {
    lines.push(`├─ ${bold(`Recent ${pl(lex.decision, plain)}`)}  ${dim(`(${data.recentDecisions.length})`)}`);
    for (const d of data.recentDecisions) {
      const conf = `${(d.confidence * 100).toFixed(0)}%`;
      const outcome = d.outcome?.artifactQuality ?? 'pending';
      lines.push(`│  ● ${d.decisionType}: ${d.selection}  ${dim(`confidence: ${conf}, outcome: ${outcome}`)}`);
    }
  } else {
    lines.push(`│  ${dim(`${pl(cap(lex.decision), plain)}: (no recent ${pl(lex.decision, plain)})`)}`);
  }

  lines.push(bold('╰─'));
  return lines.join('\n');
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
  return values.map((v, i) => visiblePadEnd(v, widths[i] ?? 20)).join('  ');
}

