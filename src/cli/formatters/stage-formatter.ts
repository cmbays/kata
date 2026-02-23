import type { Stage } from '@domain/types/stage.js';

/**
 * Format a list of stages as an aligned text table.
 */
export function formatStageTable(stages: Stage[]): string {
  if (stages.length === 0) {
    return 'No stages found.';
  }

  const header = padColumns(['Type', 'Flavor', 'Gates', 'Artifacts']);
  const separator = '-'.repeat(header.length);
  const rows = stages.map((s) => {
    const gates = buildGatesSummary(s);
    const artifacts = s.artifacts.map((a) => a.name).join(', ') || '-';
    return padColumns([s.type, s.flavor ?? '-', gates, artifacts]);
  });

  return [header, separator, ...rows].join('\n');
}

/**
 * Format a single stage with full detail.
 */
export function formatStageDetail(stage: Stage): string {
  const lines: string[] = [];

  lines.push(`Stage: ${stage.type}${stage.flavor ? ` (${stage.flavor})` : ''}`);
  if (stage.description) {
    lines.push(`Description: ${stage.description}`);
  }
  lines.push('');

  // Entry gate
  if (stage.entryGate) {
    lines.push('Entry Gate:');
    lines.push(`  Required: ${stage.entryGate.required}`);
    for (const cond of stage.entryGate.conditions) {
      lines.push(`  - [${cond.type}] ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Exit gate
  if (stage.exitGate) {
    lines.push('Exit Gate:');
    lines.push(`  Required: ${stage.exitGate.required}`);
    for (const cond of stage.exitGate.conditions) {
      lines.push(`  - [${cond.type}] ${cond.description ?? cond.artifactName ?? cond.predecessorType ?? ''}`);
    }
    lines.push('');
  }

  // Artifacts
  if (stage.artifacts.length > 0) {
    lines.push('Artifacts:');
    for (const artifact of stage.artifacts) {
      const req = artifact.required ? ' (required)' : ' (optional)';
      lines.push(`  - ${artifact.name}${req}${artifact.extension ? ` [${artifact.extension}]` : ''}`);
      if (artifact.description) {
        lines.push(`    ${artifact.description}`);
      }
    }
    lines.push('');
  }

  // Prompt template
  if (stage.promptTemplate) {
    lines.push(`Prompt Template: ${stage.promptTemplate}`);
    lines.push('');
  }

  // Learning hooks
  if (stage.learningHooks.length > 0) {
    lines.push(`Learning Hooks: ${stage.learningHooks.join(', ')}`);
    lines.push('');
  }

  // Resources
  if (stage.resources) {
    const { tools, agents, skills } = stage.resources;
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
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format stages as JSON string.
 */
export function formatStageJson(stages: Stage[]): string {
  return JSON.stringify(stages, null, 2);
}

// ---- Helpers ----

function buildGatesSummary(stage: Stage): string {
  const parts: string[] = [];
  if (stage.entryGate) {
    const req = stage.entryGate.required ? 'req' : 'opt';
    parts.push(`entry(${stage.entryGate.conditions.length},${req})`);
  }
  if (stage.exitGate) {
    const req = stage.exitGate.required ? 'req' : 'opt';
    parts.push(`exit(${stage.exitGate.conditions.length},${req})`);
  }
  return parts.join(', ') || '-';
}

function padColumns(values: string[]): string {
  const widths = [16, 12, 24, 30];
  return values.map((v, i) => v.padEnd(widths[i] ?? 20)).join('  ');
}
