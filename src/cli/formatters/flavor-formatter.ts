import type { Flavor } from '@domain/types/flavor.js';
import { getLexicon, cap } from '@cli/lexicon.js';

/**
 * Format a list of flavors as an aligned text table.
 */
export function formatFlavorTable(flavors: Flavor[], plain?: boolean): string {
  if (flavors.length === 0) {
    return 'No flavors found.';
  }
  const lex = getLexicon(plain);

  const header = padColumns(['Name', cap(lex.stage), cap(lex.step) + 's', 'Synthesis Artifact']);
  const separator = '-'.repeat(header.length);
  const rows = flavors.map((f) =>
    padColumns([
      f.name,
      f.stageCategory,
      String(f.steps.length),
      f.synthesisArtifact,
    ]),
  );

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
  lines.push('');

  // Steps
  lines.push(`${cap(lex.step)}s (${flavor.steps.length}):`);
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

function padColumns(values: string[]): string {
  const widths = [20, 12, 8, 24];
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}

