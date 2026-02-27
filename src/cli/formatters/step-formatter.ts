import type { Step } from '@domain/types/step.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, green, yellow, dim, visiblePadEnd } from '@shared/lib/ansi.js';

/**
 * Format a list of steps as an aligned text table.
 */
export function formatStepTable(steps: Step[], plain?: boolean): string {
  if (steps.length === 0) {
    return 'No steps found.';
  }
  const lex = getLexicon(plain);

  const headerCols = [cap(lex.step), cap(lex.flavor), pl(cap(lex.gate), plain), 'Artifacts'];
  const header = bold(padColumns(headerCols));
  const separator = dim('-'.repeat(padColumns(headerCols).length));
  const rows = steps.map((s) => {
    const gates = buildGatesSummary(s, plain);
    const artifacts = s.artifacts.map((a) => a.name).join(', ') || dim('-');
    return padColumns([cyan(s.type), s.flavor ?? dim('-'), gates, artifacts]);
  });

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

function padColumns(values: string[]): string {
  const widths = [16, 12, 32, 30];
  return values.map((v, i) => visiblePadEnd(v, widths[i] ?? 20)).join('  ');
}

