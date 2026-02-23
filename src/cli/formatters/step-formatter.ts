import type { Step } from '@domain/types/step.js';

/**
 * Format a list of steps as an aligned text table.
 */
export function formatStepTable(steps: Step[]): string {
  if (steps.length === 0) {
    return 'No steps found.';
  }

  const header = padColumns(['Type', 'Flavor', 'Gates', 'Artifacts']);
  const separator = '-'.repeat(header.length);
  const rows = steps.map((s) => {
    const gates = buildGatesSummary(s);
    const artifacts = s.artifacts.map((a) => a.name).join(', ') || '-';
    return padColumns([s.type, s.flavor ?? '-', gates, artifacts]);
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single step with full detail.
 */
export function formatStepDetail(step: Step): string {
  const lines: string[] = [];

  lines.push(`Step: ${step.type}${step.flavor ? ` (${step.flavor})` : ''}`);
  if (step.description) {
    lines.push(`Description: ${step.description}`);
  }
  lines.push('');

  // Entry gate
  if (step.entryGate) {
    lines.push('Entry Gate:');
    lines.push(`  Required: ${step.entryGate.required}`);
    for (const cond of step.entryGate.conditions) {
      lines.push(`  - [${cond.type}] ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Exit gate
  if (step.exitGate) {
    lines.push('Exit Gate:');
    lines.push(`  Required: ${step.exitGate.required}`);
    for (const cond of step.exitGate.conditions) {
      lines.push(`  - [${cond.type}] ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Artifacts
  if (step.artifacts.length > 0) {
    lines.push('Artifacts:');
    for (const artifact of step.artifacts) {
      const req = artifact.required ? ' (required)' : ' (optional)';
      lines.push(`  - ${artifact.name}${req}${artifact.extension ? ` [${artifact.extension}]` : ''}`);
      if (artifact.description) {
        lines.push(`    ${artifact.description}`);
      }
    }
    lines.push('');
  }

  // Prompt template
  if (step.promptTemplate) {
    lines.push(`Prompt Template: ${step.promptTemplate}`);
    lines.push('');
  }

  // Learning hooks
  if (step.learningHooks.length > 0) {
    lines.push(`Learning Hooks: ${step.learningHooks.join(', ')}`);
    lines.push('');
  }

  // Resources
  if (step.resources) {
    const { tools, agents, skills } = step.resources;
    const hasResources = tools.length > 0 || agents.length > 0 || skills.length > 0;
    if (hasResources) {
      lines.push('Resources:');
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

function buildGatesSummary(step: Step): string {
  const parts: string[] = [];
  if (step.entryGate) {
    const req = step.entryGate.required ? 'req' : 'opt';
    parts.push(`entry(${step.entryGate.conditions.length},${req})`);
  }
  if (step.exitGate) {
    const req = step.exitGate.required ? 'req' : 'opt';
    parts.push(`exit(${step.exitGate.conditions.length},${req})`);
  }
  return parts.join(', ') || '-';
}

function padColumns(values: string[]): string {
  const widths = [16, 12, 24, 30];
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}
