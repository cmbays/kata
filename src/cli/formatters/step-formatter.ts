import type { Step } from '@domain/types/step.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, green, yellow, dim } from '@shared/lib/ansi.js';

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

  lines.push(`${bold(cap(lex.step))}: ${cyan(step.type)}${step.flavor ? dim(` (${step.flavor})`) : ''}`);
  if (step.description) {
    lines.push(`${dim('Description:')} ${step.description}`);
  }
  lines.push('');

  // Entry gate
  if (step.entryGate) {
    lines.push(bold(`${cap(lex.entryGate)}:`));
    lines.push(`  Required: ${step.entryGate.required ? green('yes') : yellow('no')}`);
    for (const cond of step.entryGate.conditions) {
      lines.push(`  ${dim('-')} ${dim(`[${cond.type}]`)} ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Exit gate
  if (step.exitGate) {
    lines.push(bold(`${cap(lex.exitGate)}:`));
    lines.push(`  Required: ${step.exitGate.required ? green('yes') : yellow('no')}`);
    for (const cond of step.exitGate.conditions) {
      lines.push(`  ${dim('-')} ${dim(`[${cond.type}]`)} ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Artifacts
  if (step.artifacts.length > 0) {
    lines.push(bold('Artifacts:'));
    for (const artifact of step.artifacts) {
      const req = artifact.required ? green(' (required)') : dim(' (optional)');
      lines.push(`  ${dim('-')} ${cyan(artifact.name)}${req}${artifact.extension ? dim(` [${artifact.extension}]`) : ''}`);
      if (artifact.description) {
        lines.push(`    ${artifact.description}`);
      }
    }
    lines.push('');
  }

  // Prompt template
  if (step.promptTemplate) {
    lines.push(`${bold('Prompt Template:')} ${step.promptTemplate}`);
    lines.push('');
  }

  // Learning hooks
  if (step.learningHooks.length > 0) {
    lines.push(`${bold('Learning Hooks:')} ${step.learningHooks.join(', ')}`);
    lines.push('');
  }

  // Resources
  if (step.resources) {
    const { tools, agents, skills } = step.resources;
    const hasResources = tools.length > 0 || agents.length > 0 || skills.length > 0;
    if (hasResources) {
      lines.push(bold('Resources:'));
      if (tools.length > 0) {
        lines.push('  Tools:');
        for (const tool of tools) {
          const cmd = tool.command ? ` (${tool.command})` : '';
          lines.push(`    - ${tool.name}: ${tool.purpose}${cmd}`);
        }
      }
      if (agents.length > 0) {
        lines.push('  Agents:');
        for (const agent of agents) {
          const when = agent.when ? ` — ${agent.when}` : '';
          lines.push(`    - ${agent.name}${when}`);
        }
      }
      if (skills.length > 0) {
        lines.push('  Skills:');
        for (const skill of skills) {
          const when = skill.when ? ` — ${skill.when}` : '';
          lines.push(`    - ${skill.name}${when}`);
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').trimEnd();
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
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}

