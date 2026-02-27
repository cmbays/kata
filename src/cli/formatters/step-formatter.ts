import type { Step } from '@domain/types/step.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, green, yellow, dim, visiblePadEnd, strip } from '@shared/lib/ansi.js';

/**
 * Format a list of steps as an aligned text table.
 * @param flavorUsage - map of step name → number of flavors that reference it
 */
export function formatStepTable(steps: Step[], plain?: boolean, flavorUsage?: Map<string, number>): string {
  if (steps.length === 0) {
    return 'No steps found.';
  }
  const lex = getLexicon(plain);

  const headerCols = [cap(lex.step), pl(cap(lex.gate), plain), 'Artifacts', cap(lex.flavor)];
  const dataRows = steps.map((s) => {
    const gates = buildGatesSummary(s, plain);
    const artifacts = s.artifacts.map((a) => a.name).join(', ') || '-';
    const usedIn = flavorUsage?.get(s.type) ?? 0;
    const flavorCol = usedIn > 0 ? String(usedIn) : dim('-');
    return [cyan(s.type), gates, artifacts, flavorCol];
  });

  const widths = computeWidths([headerCols, ...dataRows]);
  const header = bold(padColumns(headerCols, widths));
  const separator = dim('-'.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2));
  const rows = dataRows.map((cols) => padColumns(cols, widths));

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single step with full detail.
 */
export function formatStepDetail(step: Step, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  // Card header
  const title = `${cap(lex.step)}: ${step.type}${step.flavor ? ` (${step.flavor})` : ''}`;
  lines.push(bold(`╭─ ${cyan(title)} ─`));
  if (step.description) {
    lines.push(`│  ${dim(step.description)}`);
  }

  // Entry gate
  if (step.entryGate) {
    lines.push(`├─ ${bold(cap(lex.entryGate))}  ${dim('Required:')} ${step.entryGate.required ? green('yes') : yellow('no')}`);
    for (const cond of step.entryGate.conditions) {
      lines.push(`│  ● ${dim(`[${cond.type}]`)} ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
  }

  // Exit gate
  if (step.exitGate) {
    lines.push(`├─ ${bold(cap(lex.exitGate))}  ${dim('Required:')} ${step.exitGate.required ? green('yes') : yellow('no')}`);
    for (const cond of step.exitGate.conditions) {
      lines.push(`│  ● ${dim(`[${cond.type}]`)} ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
  }

  // Artifacts
  if (step.artifacts.length > 0) {
    lines.push(`├─ ${bold('Artifacts')}`);
    for (const artifact of step.artifacts) {
      const req = artifact.required ? green('required') : dim('optional');
      const ext = artifact.extension ? dim(` [${artifact.extension}]`) : '';
      lines.push(`│  ● ${cyan(artifact.name)}  ${req}${ext}`);
      if (artifact.description) {
        lines.push(`│    ${dim(artifact.description)}`);
      }
    }
  }

  // Resources
  if (step.resources) {
    const { tools, agents, skills } = step.resources;
    const hasResources = tools.length > 0 || agents.length > 0 || skills.length > 0;
    if (hasResources) {
      lines.push(`├─ ${bold('Resources')}`);
      for (const tool of tools) {
        const cmd = tool.command ? dim(` (${tool.command})`) : '';
        lines.push(`│  ● ${cyan(tool.name)}: ${tool.purpose}${cmd}`);
      }
      for (const agent of agents) {
        const when = agent.when ? dim(` — ${agent.when}`) : '';
        lines.push(`│  ● ${agent.name}${when}`);
      }
      for (const skill of skills) {
        const when = skill.when ? dim(` — ${skill.when}`) : '';
        lines.push(`│  ● ${skill.name}${when}`);
      }
    }
  }

  // Footer meta
  const meta: string[] = [];
  if (step.promptTemplate) meta.push(`${dim('template:')} ${step.promptTemplate}`);
  if (step.learningHooks.length > 0) meta.push(`${dim('hooks:')} ${step.learningHooks.join(', ')}`);
  if (meta.length > 0) {
    lines.push(`├─ ${meta.join('  ')}`);
  }

  lines.push(bold('╰─'));
  return lines.join('\n');
}

/**
 * Format steps as JSON string.
 */
export function formatStepJson(steps: Step[]): string {
  return JSON.stringify(steps, null, 2);
}

// ---- Helpers ----

function buildGatesSummary(step: Step, plain?: boolean): string {
  const lex = getLexicon(plain);
  const parts: string[] = [];
  if (step.entryGate) {
    const req = step.entryGate.required ? green('req') : yellow('opt');
    parts.push(`${lex.entryGate}(${step.entryGate.conditions.length},${req})`);
  }
  if (step.exitGate) {
    const req = step.exitGate.required ? green('req') : yellow('opt');
    parts.push(`${lex.exitGate}(${step.exitGate.conditions.length},${req})`);
  }
  return parts.join(', ') || dim('-');
}

function computeWidths(rows: string[][]): number[] {
  const colCount = rows[0]?.length ?? 0;
  return Array.from({ length: colCount }, (_, i) =>
    Math.max(...rows.map((r) => strip(r[i] ?? '').length)),
  );
}

function padColumns(values: string[], widths: number[]): string {
  return values.map((v, i) => visiblePadEnd(v, widths[i] ?? 20)).join('  ');
}

