import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { getLexicon } from '@cli/lexicon.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import { KataConfigSchema } from '@domain/types/config.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { DecisionRegistry } from '@infra/registries/decision-registry.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepFlavorExecutor } from '@features/execute/step-flavor-executor.js';
import { KiaiRunner } from '@features/execute/kiai-runner.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { handleStatus, handleStats, parseCategoryFilter } from './status.js';

/**
 * Register execute commands on the given parent Command.
 *
 * Flattened invocation:
 *   kata kiai <categories...>           — run one or more stage categories
 *   kata kiai status                    — show recent artifacts
 *   kata kiai stats [--category <cat>]  — show analytics
 *
 * Flags:
 *   --ryu <flavor>    Pin a flavor (repeatable)
 *   --kata <name>     Load a saved sequence
 *   --gyo <stages>    Inline comma-separated stage specification
 *   --save-kata <n>   Save a successful run as a named kata
 *   --list-katas      List saved katas
 *   --delete-kata <n> Delete a saved kata
 */
export function registerExecuteCommands(program: Command): void {
  const execute = program
    .command('execute')
    .alias('kiai')
    .description('Run stage orchestration — select and execute flavors (alias: kiai)');

  // ---- status (delegates to top-level kata status) ----
  execute
    .command('status')
    .description('Show project status (same as "kata status")')
    .action(withCommandContext(async (ctx) => {
      handleStatus(ctx);
    }));

  // ---- stats (delegates to top-level kata stats) ----
  execute
    .command('stats')
    .description('Show analytics (same as "kata stats")')
    .option('--category <cat>', 'Filter stats by stage category')
    .option('--gyo <cat>', 'Filter stats by stage category (alias)')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const rawCategory = (localOpts.category ?? localOpts.gyo) as string | undefined;

      const categoryFilter = parseCategoryFilter(rawCategory);
      if (categoryFilter === false) { process.exitCode = 1; return; }

      handleStats(ctx, categoryFilter);
    }));

  // ---- run (hidden backward compat) ----
  execute
    .command('run <stage-category>', { hidden: true })
    .description('(deprecated: use "kata kiai <category>" instead)')
    .option('--bet <json>', 'Inline JSON for bet context')
    .option('--pin <flavor>', 'Pin a specific flavor (can be repeated)', collect, [])
    .option('--ryu <flavor>', 'Pin a specific flavor (can be repeated)', collect, [])
    .option('--dry-run', 'Print selected flavors without executing')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx, category: string) => {
      const localOpts = ctx.cmd.opts();
      await runCategories(ctx, [category], {
        bet: localOpts.bet,
        pin: [...(localOpts.pin ?? []), ...(localOpts.ryu ?? [])],
        dryRun: localOpts.dryRun,
        json: localOpts.json,
      });
    }));

  // ---- pipeline (hidden backward compat) ----
  execute
    .command('pipeline <categories...>', { hidden: true })
    .description('(deprecated: use "kata kiai <cat1> <cat2> ..." instead)')
    .option('--bet <json>', 'Inline JSON for bet context')
    .option('--dry-run', 'Print results without persisting artifacts')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx, cats: string[]) => {
      const localOpts = ctx.cmd.opts();
      await runCategories(ctx, cats, {
        bet: localOpts.bet,
        dryRun: localOpts.dryRun,
        json: localOpts.json,
      });
    }));

  // ---- Default handler: kata kiai <categories...> ----
  execute
    .argument('[categories...]', 'Stage categories to run (research, plan, build, review)')
    .option('--bet <json>', 'Inline JSON for bet context')
    .option('--ryu <flavor>', 'Pin a specific flavor (can be repeated)', collect, [])
    .option('--pin <flavor>', 'Pin a specific flavor (hidden backward compat)', collect, [])
    .option('--dry-run', 'Print selected flavors without executing')
    .option('--kata <name>', 'Load a saved kata sequence')
    .option('--gyo <stages>', 'Inline comma-separated stage categories')
    .option('--save-kata <name>', 'Save this run as a named kata after success')
    .option('--list-katas', 'List saved katas and exit')
    .option('--delete-kata <name>', 'Delete a saved kata and exit')
    .action(withCommandContext(async (ctx, categories: string[]) => {
      const localOpts = ctx.cmd.opts();

      // --list-katas: show and exit
      if (localOpts.listKatas) {
        const katas = listSavedKatas(ctx.kataDir);
        if (ctx.globalOpts.json) {
          console.log(JSON.stringify(katas, null, 2));
        } else if (katas.length === 0) {
          console.log('No saved katas. Use --save-kata <name> after a successful run.');
        } else {
          console.log('Saved katas:');
          for (const k of katas) {
            const desc = k.description ? ` — ${k.description}` : '';
            console.log(`  ${k.name}: ${k.stages.join(' -> ')}${desc}`);
          }
        }
        return;
      }

      // --delete-kata: delete and exit
      if (localOpts.deleteKata) {
        deleteSavedKata(ctx.kataDir, localOpts.deleteKata);
        console.log(`Kata "${localOpts.deleteKata}" deleted.`);
        return;
      }

      // Resolve categories from: positional args OR --kata OR --gyo
      let resolvedCategories: string[] = categories;

      if (localOpts.kata) {
        const kata = loadSavedKata(ctx.kataDir, localOpts.kata);
        resolvedCategories = kata.stages;
      } else if (localOpts.gyo) {
        resolvedCategories = (localOpts.gyo as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      }

      if (resolvedCategories.length === 0) {
        const lex = getLexicon(ctx.globalOpts.plain);
        const valid = StageCategorySchema.options.join(', ');
        console.error(`No categories specified. Usage: kata ${lex.execute} <category> [category...]`);
        console.error(`Valid categories: ${valid}`);
        console.error('Or use: --kata <name>, --gyo <stages>');
        process.exitCode = 1;
        return;
      }

      const pin = [...(localOpts.ryu ?? []), ...(localOpts.pin ?? [])];

      await runCategories(ctx, resolvedCategories, {
        bet: localOpts.bet,
        pin: pin.length > 0 ? pin : undefined,
        dryRun: localOpts.dryRun,
        saveKata: localOpts.saveKata,
      });
    }));
}

// ---------------------------------------------------------------------------
// Shared execution logic
// ---------------------------------------------------------------------------

interface RunOptions {
  bet?: string;
  pin?: string[];
  dryRun?: boolean;
  json?: boolean;
  saveKata?: string;
}

async function runCategories(
  ctx: { kataDir: string; globalOpts: { json?: boolean }; cmd: { opts(): Record<string, unknown> } },
  rawCategories: string[],
  opts: RunOptions,
): Promise<void> {
  // Validate all categories
  const categories: StageCategory[] = [];
  for (const cat of rawCategories) {
    const parseResult = StageCategorySchema.safeParse(cat);
    if (!parseResult.success) {
      const valid = StageCategorySchema.options.join(', ');
      console.error(`Invalid stage category: "${cat}". Valid categories: ${valid}`);
      process.exitCode = 1;
      return;
    }
    categories.push(parseResult.data);
  }

  const runner = buildRunner(ctx.kataDir);
  const bet = parseBetOption(opts.bet);
  if (bet === false) { process.exitCode = 1; return; }

  const isJson = ctx.globalOpts.json || opts.json;

  if (categories.length === 1) {
    // Single stage
    const result = await runner.runStage(categories[0]!, {
      bet,
      pin: opts.pin,
      dryRun: opts.dryRun,
    });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Stage: ${result.stageCategory}`);
      console.log(`Execution mode: ${result.executionMode}`);
      console.log(`Selected flavors: ${result.selectedFlavors.join(', ')}`);
      console.log('');
      console.log('Decisions:');
      for (const decision of result.decisions) {
        console.log(`  ${decision.decisionType}: ${decision.selection} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`);
      }
      console.log('');
      console.log(`Stage artifact: ${result.stageArtifact.name}`);
      if (opts.dryRun) {
        console.log('');
        console.log('(dry-run — no artifacts persisted)');
      }
    }
  } else {
    // Multi-stage pipeline
    const result = await runner.runPipeline(categories, { bet, dryRun: opts.dryRun });

    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Pipeline: ${categories.join(' -> ')}`);
      console.log(`Stages completed: ${result.stageResults.length}`);
      console.log(`Overall quality: ${result.pipelineReflection.overallQuality}`);
      console.log('');
      for (const stageResult of result.stageResults) {
        console.log(`  ${stageResult.stageCategory}:`);
        console.log(`    Flavors: ${stageResult.selectedFlavors.join(', ')}`);
        console.log(`    Mode: ${stageResult.executionMode}`);
        console.log(`    Artifact: ${stageResult.stageArtifact.name}`);
      }
      if (result.pipelineReflection.learnings.length > 0) {
        console.log('');
        console.log('Learnings:');
        for (const learning of result.pipelineReflection.learnings) {
          console.log(`  - ${learning}`);
        }
      }
      if (opts.dryRun) {
        console.log('');
        console.log('(dry-run — no artifacts persisted)');
      }
    }
  }

  // Save kata if requested
  if (opts.saveKata && !opts.dryRun) {
    saveSavedKata(ctx.kataDir, opts.saveKata, categories);
    if (!isJson) console.log(`\nKata "${opts.saveKata}" saved.`);
  }
}

// ---------------------------------------------------------------------------
// Runner builder + helpers
// ---------------------------------------------------------------------------

function buildRunner(kataDir: string): KiaiRunner {
  const configPath = kataDirPath(kataDir, 'config');
  const config = JsonStore.exists(configPath)
    ? JsonStore.read(configPath, KataConfigSchema)
    : undefined;

  const stepRegistry = new StepRegistry(kataDirPath(kataDir, 'stages'));
  const flavorRegistry = new FlavorRegistry(kataDirPath(kataDir, 'flavors'));
  const decisionRegistry = new DecisionRegistry(kataDirPath(kataDir, 'history'));

  const executor = new StepFlavorExecutor({
    stepRegistry,
    adapterResolver: AdapterResolver,
    config: config ?? KataConfigSchema.parse({
      methodology: 'shape-up',
      execution: { adapter: 'manual', config: {} },
      customStagePaths: [],
      project: {},
    }),
  });

  const analytics = new UsageAnalytics(kataDir);
  return new KiaiRunner({
    flavorRegistry,
    decisionRegistry,
    executor,
    kataDir,
    analytics,
  });
}

function parseBetOption(betJson: string | undefined): Record<string, unknown> | undefined | false {
  if (!betJson) return undefined;
  try {
    const parsed = JSON.parse(betJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      console.error('Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')');
      return false;
    }
    return parsed as Record<string, unknown>;
  } catch {
    console.error('Error: --bet must be valid JSON');
    return false;
  }
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

// ---------------------------------------------------------------------------
// Saved kata helpers
// ---------------------------------------------------------------------------

function katasDir(kataDir: string): string {
  return join(kataDir, KATA_DIRS.katas);
}

function listSavedKatas(kataDir: string): Array<{ name: string; stages: StageCategory[]; description?: string }> {
  const dir = katasDir(kataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return SavedKataSchema.parse(raw);
      } catch (e) {
        if (e instanceof SyntaxError || (e instanceof Error && e.constructor.name === 'ZodError')) {
          console.error(`Warning: skipping invalid kata file "${f}": ${e.message}`);
          return null;
        }
        throw e;
      }
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);
}

function loadSavedKata(kataDir: string, name: string): { stages: StageCategory[] } {
  const filePath = join(katasDir(kataDir), `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Kata "${name}" not found. Use --list-katas to see available katas.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new Error(
      `Kata "${name}" has invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  try {
    return SavedKataSchema.parse(raw);
  } catch (e) {
    throw new Error(
      `Kata "${name}" has invalid structure. Ensure it has "name" (string) and "stages" (array of categories).`,
      { cause: e },
    );
  }
}

function saveSavedKata(kataDir: string, name: string, stages: StageCategory[]): void {
  const dir = katasDir(kataDir);
  mkdirSync(dir, { recursive: true });
  const kata = SavedKataSchema.parse({ name, stages });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(kata, null, 2), 'utf-8');
}

function deleteSavedKata(kataDir: string, name: string): void {
  const filePath = join(katasDir(kataDir), `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Kata "${name}" not found. Use --list-katas to see available katas.`);
  }
  try {
    unlinkSync(filePath);
  } catch (e) {
    throw new Error(
      `Could not delete kata "${name}": ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
