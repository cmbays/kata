import type { Flavor } from '@domain/types/flavor.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, dim, visiblePadEnd, strip } from '@shared/lib/ansi.js';

/**
 * Format a list of flavors as an aligned text table.
 */
export function formatFlavorTable(flavors: Flavor[], plain?: boolean): string {
  if (flavors.length === 0) {
    return 'No flavors found.';
  }
  const lex = getLexicon(plain);

  const headerCols = ['Name', cap(lex.stage), pl(cap(lex.step), plain), 'Synthesis Artifact'];
  const dataRows = flavors.map((f) => [cyan(f.name), f.stageCategory, String(f.steps.length), f.synthesisArtifact]);

  const widths = computeWidths([headerCols, ...dataRows]);
  const header = bold(padColumns(headerCols, widths));
  const separator = dim('-'.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2));
  const rows = dataRows.map((cols) => padColumns(cols, widths));

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single flavor with full detail.
 */
export function formatFlavorDetail(flavor: Flavor, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`${cap(lex.flavor)}: ${flavor.name}`);
  lines.push(`${cap(lex.stage)}: ${flavor.stageCategory}`);
  if (flavor.description) {
    lines.push(`Description: ${flavor.description}`);
  }
  lines.push(`Synthesis Artifact: ${flavor.synthesisArtifact}`);
  if (flavor.kataka) {
    lines.push(`${cap(lex.agent)}: ${flavor.kataka}`);
  }
  lines.push('');

  // Steps
  lines.push(`${pl(cap(lex.step), plain, flavor.steps.length)} (${flavor.steps.length}):`);
  for (const step of flavor.steps) {
    lines.push(`  - ${step.stepName} (type: ${step.stepType})`);
  }
  lines.push('');

  // Overrides
  if (flavor.overrides && Object.keys(flavor.overrides).length > 0) {
    lines.push('Overrides:');
    for (const [stepName, override] of Object.entries(flavor.overrides)) {
      const parts: string[] = [];
      if (override.humanApproval !== undefined) parts.push(`humanApproval: ${override.humanApproval}`);
      if (override.confidenceThreshold !== undefined) parts.push(`confidence: ${override.confidenceThreshold}`);
      if (override.timeout !== undefined) parts.push(`timeout: ${override.timeout}ms`);
      lines.push(`  ${stepName}: ${parts.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format flavors as JSON string.
 */
export function formatFlavorJson(flavors: Flavor[]): string {
  return JSON.stringify(flavors, null, 2);
}

// ---- Helpers ----

function computeWidths(rows: string[][]): number[] {
  const colCount = rows[0]?.length ?? 0;
  return Array.from({ length: colCount }, (_, i) =>
    Math.max(...rows.map((r) => strip(r[i] ?? '').length)),
  );
}

function padColumns(values: string[], widths: number[]): string {
  return values.map((v, i) => visiblePadEnd(v, widths[i] ?? 20)).join('  ');
}

