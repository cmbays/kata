import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Command } from 'commander';
import { KatakaSchema, KatakaRoleSchema, type KatakaRole } from '@domain/types/kataka.js';
import { KatakaRegistry } from '@infra/registries/kataka-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { withCommandContext } from '@cli/utils.js';
import { getLexicon, cap, pl } from '@cli/lexicon.js';
import { bold, cyan, dim, visiblePadEnd, strip } from '@shared/lib/ansi.js';
import type { Kataka } from '@domain/types/kataka.js';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatKatakaTable(kataka: Kataka[], plain?: boolean): string {
  if (kataka.length === 0) {
    return `No ${pl(getLexicon(plain).agent, plain)} registered.`;
  }
  const lex = getLexicon(plain);

  const headerCols = [cap(lex.agent), 'Role', 'Skills', 'Active'];
  const dataRows = kataka.map((k) => [
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

function formatKatakaDetail(k: Kataka, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`${cap(lex.agent)}: ${k.name}`);
  lines.push(`ID:   ${k.id}`);
  lines.push(`Role: ${k.role}`);
  lines.push(`Active: ${k.active ? 'yes' : 'no'}`);
  if (k.description) lines.push(`Description: ${k.description}`);
  if (k.skills.length > 0) lines.push(`Skills: ${k.skills.join(', ')}`);
  if (k.specializations && k.specializations.length > 0) {
    lines.push(`Specializations: ${k.specializations.join(', ')}`);
  }
  lines.push(`Registered: ${k.createdAt}`);

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

function katakaRegistryPath(kataDir: string): string {
  return join(kataDir, KATA_DIRS.kataka);
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register the `kata agent` command group (alias: `kata kataka`).
 *
 * Subcommands:
 *   kata agent list             — list all registered kataka
 *   kata agent inspect <id>     — show full details for one kataka
 *   kata agent register         — register a new kataka
 */
export function registerAgentCommands(parent: Command): void {
  const agent = parent
    .command('agent')
    .alias('kataka')
    .description('Manage kataka — registered agent personas (alias: kataka)');

  // ---------------------------------------------------------------------------
  // kata agent list
  // ---------------------------------------------------------------------------
  agent
    .command('list')
    .description('List all registered kataka')
    .option('--active', 'Show only active kataka')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const registryPath = katakaRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KatakaRegistry(registryPath);

      const kataka = localOpts.active ? registry.getActive() : registry.list();

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(kataka, null, 2));
        return;
      }

      console.log(formatKatakaTable(kataka, ctx.globalOpts.plain));
    }));

  // ---------------------------------------------------------------------------
  // kata agent inspect <id>
  // ---------------------------------------------------------------------------
  agent
    .command('inspect <id>')
    .description('Show full details for a kataka')
    .action(withCommandContext((ctx, id: string) => {
      const registryPath = katakaRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KatakaRegistry(registryPath);

      let kataka: Kataka;
      try {
        kataka = registry.get(id);
      } catch {
        console.error(`Error: kataka "${id}" not found. Use "kata agent list" to see registered kataka.`);
        process.exitCode = 1;
        return;
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(kataka, null, 2));
        return;
      }

      console.log(formatKatakaDetail(kataka, ctx.globalOpts.plain));
    }));

  // ---------------------------------------------------------------------------
  // kata agent register
  // ---------------------------------------------------------------------------
  agent
    .command('register')
    .description('Register a new kataka')
    .requiredOption('--name <name>', 'Display name for the kataka')
    .requiredOption('--role <role>', `Role: ${KatakaRoleSchema.options.join(' | ')}`)
    .option('--skills <list>', 'Comma-separated skill identifiers (e.g. TypeScript,React)')
    .option('--description <text>', 'Free-text description of the kataka')
    .option('--specializations <list>', 'Comma-separated specializations within the role')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const lex = getLexicon(ctx.globalOpts.plain);

      // Validate role
      const roleResult = KatakaRoleSchema.safeParse(localOpts.role as string);
      if (!roleResult.success) {
        console.error(`Error: invalid role "${localOpts.role}". Valid: ${KatakaRoleSchema.options.join(', ')}`);
        process.exitCode = 1;
        return;
      }
      const role: KatakaRole = roleResult.data;

      const skills = localOpts.skills
        ? (localOpts.skills as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : [];

      const specializations = localOpts.specializations
        ? (localOpts.specializations as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const kataka = KatakaSchema.parse({
        id: randomUUID(),
        name: localOpts.name as string,
        role,
        skills,
        description: localOpts.description as string | undefined,
        specializations,
        createdAt: new Date().toISOString(),
        active: true,
      });

      const registryPath = katakaRegistryPath(ctx.kataDir);
      JsonStore.ensureDir(registryPath);
      const registry = new KatakaRegistry(registryPath);
      registry.register(kataka);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(kataka, null, 2));
      } else {
        console.log(`✓ ${cap(lex.agent)} registered: ${kataka.name} (${kataka.role})`);
        console.log(`  id: ${kataka.id}`);
      }
    }));
}
