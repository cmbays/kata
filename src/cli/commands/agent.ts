import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { KataAgentSchema, KataAgentRoleSchema, type KataAgentRole } from '@domain/types/kata-agent.js';
import { KataAgentRegistry } from '@infra/registries/kata-agent-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { withCommandContext } from '@cli/utils.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, dim, visiblePadEnd, strip } from '@shared/lib/ansi.js';
import type { KataAgent } from '@domain/types/kata-agent.js';
import {
  KataAgentObservabilityAggregator,
  type KataAgentObservabilityStats,
} from '@features/kata-agent/kata-agent-observability-aggregator.js';
import { KataAgentConfidenceCalculator } from '@features/kata-agent/kata-agent-confidence-calculator.js';
import type { KataAgentConfidenceProfile } from '@domain/types/kata-agent-confidence.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatAgentTable(agents: KataAgent[], plain?: boolean): string {
  if (agents.length === 0) {
    return `No ${pl(getLexicon(plain).agent, plain)} registered.`;
  }
  const lex = getLexicon(plain);

  const headerCols = [cap(lex.agent), 'Role', 'Skills', 'Active'];
  const dataRows = agents.map((k) => [
    cyan(k.name),
    k.role,
    k.skills.length > 0 ? k.skills.slice(0, 3).join(', ') + (k.skills.length > 3 ? '…' : '') : dim('(none)'),
    k.active ? 'yes' : dim('no'),
  ]);

  const widths = computeWidths([headerCols, ...dataRows]);
  const header = bold(padColumns(headerCols, widths));
  const separator = dim('-'.repeat(widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * 2));
  const rows = dataRows.map((cols) => padColumns(cols, widths));

  return [header, separator, ...rows].join('\n');
}

function formatAgentDetail(agent: KataAgent, plain?: boolean, stats?: KataAgentObservabilityStats, confidenceProfile?: KataAgentConfidenceProfile | null): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`${cap(lex.agent)}: ${agent.name}`);
  lines.push(`ID:   ${agent.id}`);
  lines.push(`Role: ${agent.role}`);
  lines.push(`Active: ${agent.active ? 'yes' : 'no'}`);
  if (agent.description) lines.push(`Description: ${agent.description}`);
  if (agent.skills.length > 0) lines.push(`Skills: ${agent.skills.join(', ')}`);
  if (agent.specializations && agent.specializations.length > 0) {
    lines.push(`Specializations: ${agent.specializations.join(', ')}`);
  }
  lines.push(`Registered: ${agent.createdAt}`);

  // Runtime stats section
  lines.push('');
  lines.push('--- Runtime Stats ---');

  if (!stats || (stats.observationCount === 0 && stats.agentLearningCount === 0 && !stats.lastRunId)) {
    lines.push('No runtime data yet — run this agent in a cycle to build stats.');
  } else {
    // Observations breakdown
    const byTypeStr = Object.entries(stats.observationsByType)
      .map(([t, n]) => `${t}: ${n}`)
      .join(', ');
    const obsDetail = byTypeStr ? ` (${byTypeStr})` : '';
    lines.push(`Observations: ${stats.observationCount}${obsDetail}`);

    lines.push(`Decisions:    ${stats.decisionCount}`);
    lines.push(`Agent learnings: ${stats.agentLearningCount}`);

    if (stats.lastRunId) {
      lines.push(
        `Last active:  run ${stats.lastRunId} in cycle ${stats.lastRunCycleId ?? 'unknown'} at ${stats.lastActiveAt ?? 'unknown'}`,
      );
    }
  }

  // Confidence profile section
  lines.push('');
  lines.push('--- Confidence Profile ---');
  if (confidenceProfile) {
    lines.push(`  Overall: ${(confidenceProfile.overallConfidence * 100).toFixed(0)}%`);
    lines.push(`  Observations attributed: ${confidenceProfile.observationCount}`);
    lines.push(`  Agent learnings: ${confidenceProfile.learningCount}`);
    if (Object.keys(confidenceProfile.domainScores).length > 0) {
      lines.push('  Domain scores:');
      for (const [domain, score] of Object.entries(confidenceProfile.domainScores)) {
        lines.push(`    ${domain}: ${(score.composite * 100).toFixed(0)}%`);
      }
    }
  } else {
    lines.push('  Not yet computed (run kata cooldown to generate)');
  }

  return lines.join('\n');
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

function agentRegistryPath(kataDir: string): string {
  return join(kataDir, KATA_DIRS.kataka);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register the `kata agent` command group (alias: `kata kataka`).
 *
 * Subcommands:
 *   kata agent list             — list all registered agents
 *   kata agent inspect <id>     — show full details for one agent
 *   kata agent register         — register a new agent
 */
export function registerAgentCommands(parent: Command): void {
  const agent = parent
    .command('agent')
    .alias('kataka')
    .description('Manage agents — registered Kata agent personas (alias: kataka)');

  // ---------------------------------------------------------------------------
  // kata agent list
  // ---------------------------------------------------------------------------
  agent
    .command('list')
    .description('List all registered agents')
    .option('--active', 'Show only active agents')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const registryPath = agentRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KataAgentRegistry(registryPath);

      const agents = localOpts.active ? registry.getActive() : registry.list();

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(agents, null, 2));
        return;
      }

      console.log(formatAgentTable(agents, ctx.globalOpts.plain));
    }));

  // ---------------------------------------------------------------------------
  // kata agent inspect <id>
  // ---------------------------------------------------------------------------
  agent
    .command('inspect <id>')
    .description('Show full details for an agent')
    .action(withCommandContext((ctx, id: string) => {
      const registryPath = agentRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KataAgentRegistry(registryPath);

      let agentRecord: KataAgent;
      try {
        agentRecord = registry.get(id);
      } catch {
        console.error(`Error: agent "${id}" not found. Use "kata agent list" to see registered agents.`);
        process.exitCode = 1;
        return;
      }

      // Compute runtime stats
      const runsDir = join(ctx.kataDir, KATA_DIRS.runs);
      const knowledgeDir = join(ctx.kataDir, KATA_DIRS.knowledge);
      const aggregator = new KataAgentObservabilityAggregator(runsDir, knowledgeDir);
      let stats: KataAgentObservabilityStats | undefined;
      try {
        stats = aggregator.computeStats(agentRecord.id, agentRecord.name);
      } catch {
        // Stats unavailable — continue without them
      }

      // Load confidence profile
      const calculator = new KataAgentConfidenceCalculator({
        runsDir,
        knowledgeDir,
        agentDir: agentRegistryPath(ctx.kataDir),
      });
      const confidenceProfile = calculator.load(agentRecord.id);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ ...agentRecord, stats, confidenceProfile }, null, 2));
        return;
      }

      console.log(formatAgentDetail(agentRecord, ctx.globalOpts.plain, stats, confidenceProfile));
    }));

  // ---------------------------------------------------------------------------
  // kata agent register
  // ---------------------------------------------------------------------------
  agent
    .command('register')
    .description('Register a new agent')
    .requiredOption('--name <name>', 'Display name for the agent')
    .requiredOption('--role <role>', `Role: ${KataAgentRoleSchema.options.join(' | ')}`)
    .option('--skills <list>', 'Comma-separated skill identifiers (e.g. TypeScript,React)')
    .option('--description <text>', 'Free-text description of the agent')
    .option('--specializations <list>', 'Comma-separated specializations within the role')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const lex = getLexicon(ctx.globalOpts.plain);

      // Validate role
      const roleResult = KataAgentRoleSchema.safeParse(localOpts.role as string);
      if (!roleResult.success) {
        console.error(`Error: invalid role "${localOpts.role}". Valid: ${KataAgentRoleSchema.options.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const role: KataAgentRole = roleResult.data;

      const skills = localOpts.skills
        ? (localOpts.skills as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      const specializations = localOpts.specializations
        ? (localOpts.specializations as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const agentRecord = KataAgentSchema.parse({
        id: randomUUID(),
        name: localOpts.name as string,
        role,
        skills,
        description: localOpts.description as string | undefined,
        specializations,
        createdAt: new Date().toISOString(),
        active: true,
      });

      const registryPath = agentRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KataAgentRegistry(registryPath);
      registry.register(agentRecord);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(agentRecord, null, 2));
      } else {
        console.log(`✓ ${cap(lex.agent)} registered: ${agentRecord.name} (${agentRecord.role})`);
        console.log(`  id: ${agentRecord.id}`);
      }
    }));
}
