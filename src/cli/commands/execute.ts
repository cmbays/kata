import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { getLexicon } from '@cli/lexicon.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { SavedKataSchema, type FlavorHint } from '@domain/types/saved-kata.js';
import { KataConfigSchema } from '@domain/types/config.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { DecisionRegistry } from '@infra/registries/decision-registry.js';
import { KatakaRegistry } from '@infra/registries/kataka-registry.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepFlavorExecutor } from '@features/execute/step-flavor-executor.js';
import { KiaiRunner } from '@features/execute/kiai-runner.js';
import { GapBridger } from '@features/execute/gap-bridger.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { ProjectStateUpdater } from '@features/belt/belt-calculator.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
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
    .option('--kataka <id>', 'Kataka (agent) ID driving this run — stored in artifact metadata and attributed to observations')
    .option('--yolo', 'Skip confidence gate checks — all decisions proceed without human approval')
    .option('--bridge-gaps', 'Capture identified gaps as step-tier learnings; block on high-severity gaps')
    .option('--hint <spec>', 'Per-stage flavor hint: stage:flavor1,flavor2[:strategy] — guides orchestrator selection (can be repeated)', collect, [])
    .option('--next', 'Auto-select the first pending bet from the active cycle as the run target')
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

      // --next: auto-select the first pending bet from the active cycle
      let betFromNext: string | undefined;
      let categoriesFromNext: string[] | undefined;
      let hintsFromNext: Record<string, FlavorHint> | undefined;
      if (localOpts.next) {
        const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);
        const allCycles = manager.list();
        const activeCycle = allCycles.find((c) => c.state === 'active');

        if (!activeCycle) {
          console.log('No active cycle found. Use "kata cycle start <cycle-id>" to activate one.');
          return;
        }

        const pendingBet = activeCycle.bets.find((b) => b.outcome === 'pending');
        if (!pendingBet) {
          console.log(`No pending bets in cycle "${activeCycle.name ?? activeCycle.id}". All bets are resolved.`);
          return;
        }

        if (!ctx.globalOpts.json) {
          console.log(`Auto-selected bet: "${pendingBet.description}" (cycle: ${activeCycle.name ?? activeCycle.id})`);
        }

        betFromNext = JSON.stringify({ id: pendingBet.id, description: pendingBet.description, cycleId: activeCycle.id });

        // Resolve stage categories from the bet's kata assignment when not specified explicitly
        if (pendingBet.kata && categories.length === 0 && !localOpts.kata && !localOpts.gyo) {
          if (pendingBet.kata.type === 'named') {
            try {
              const kataData = loadSavedKata(ctx.kataDir, pendingBet.kata.pattern);
              categoriesFromNext = kataData.stages;
              hintsFromNext = kataData.flavorHints;
            } catch (err) {
              const detail = err instanceof Error ? err.message : String(err);
              console.error(`Error loading kata "${pendingBet.kata.pattern}": ${detail}`);
              return;
            }
          } else {
            categoriesFromNext = [...pendingBet.kata.stages];
          }
        }
      }

      // Resolve categories from: positional args OR --kata OR --gyo OR --next bet's kata
      let resolvedCategories: string[] = categories;
      let resolvedHints: Record<string, FlavorHint> | undefined;

      if (localOpts.kata) {
        const kata = loadSavedKata(ctx.kataDir, localOpts.kata);
        resolvedCategories = kata.stages;
        resolvedHints = kata.flavorHints;
      } else if (localOpts.gyo) {
        resolvedCategories = (localOpts.gyo as string).split(',').map((s: string) => s.trim()).filter(Boolean);
      } else if (categoriesFromNext) {
        resolvedCategories = categoriesFromNext;
        resolvedHints = hintsFromNext;
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

      // Parse --hint flags into flavorHints map (merges with loaded kata hints)
      const cliHints = parseHintFlags(localOpts.hint as string[]);
      if (cliHints === false) { process.exitCode = 1; return; }
      const mergedHints = cliHints
        ? { ...(resolvedHints ?? {}), ...cliHints }
        : resolvedHints;

      await runCategories(ctx, resolvedCategories, {
        bet: betFromNext ?? (localOpts.bet as string | undefined),
        pin: pin.length > 0 ? pin : undefined,
        dryRun: localOpts.dryRun,
        saveKata: localOpts.saveKata,
        katakaId: localOpts.kataka as string | undefined,
        yolo: localOpts.yolo as boolean | undefined,
        bridgeGaps: localOpts.bridgeGaps as boolean | undefined,
        flavorHints: mergedHints,
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
  /** ID of the kataka driving this run. Validated against KatakaRegistry before execution. */
  katakaId?: string;
  /** Skip confidence gate checks — all decisions proceed without human approval. */
  yolo?: boolean;
  /** Capture identified gaps as step-tier learnings; block on high-severity gaps. */
  bridgeGaps?: boolean;
  /** Parsed flavor hints (from saved kata or --hint flags). */
  flavorHints?: Record<string, FlavorHint>;
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

  // Fire-and-forget belt discovery hooks
  const projectStateFile = join(ctx.kataDir, 'project-state.json');
  ProjectStateUpdater.markDiscovery(projectStateFile, 'ranFirstExecution');
  if (opts.yolo) ProjectStateUpdater.markRanWithYolo(projectStateFile);

  // Validate --kataka ID if provided
  if (opts.katakaId) {
    try {
      const katakaRegistry = new KatakaRegistry(join(ctx.kataDir, KATA_DIRS.kataka));
      katakaRegistry.get(opts.katakaId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found/i.test(msg)) {
        console.error(`Error: kataka "${opts.katakaId}" not found. Use "kata agent list" to see registered kataka.`);
      } else {
        console.error(`Error: Failed to load kataka "${opts.katakaId}": ${msg}`);
      }
      process.exitCode = 1;
      return;
    }
  }

  const isJson = ctx.globalOpts.json || opts.json;

  if (categories.length === 1) {
    // Single stage
    const result = await runner.runStage(categories[0]!, {
      bet,
      pin: opts.pin,
      dryRun: opts.dryRun,
      katakaId: opts.katakaId,
      yolo: opts.yolo,
      flavorHints: opts.flavorHints,
    });

    // --bridge-gaps: evaluate identified gaps
    if (opts.bridgeGaps && result.gaps && result.gaps.length > 0) {
      const store = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const bridger = new GapBridger({ knowledgeStore: store });
      const { blocked, bridged } = bridger.bridge(result.gaps);
      if (blocked.length > 0) {
        console.error(`[kata] Blocked by ${blocked.length} high-severity gap(s):`);
        for (const g of blocked) console.error(`  • ${g.description}`);
        process.exitCode = 1;
        return;
      }
      if (bridged.length > 0) {
        console.log(`[kata] Captured ${bridged.length} gap(s) as step-tier learnings.`);
        ProjectStateUpdater.incrementGapsClosed(projectStateFile, bridged.length);
      }
    }

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
    const result = await runner.runPipeline(categories, { bet, dryRun: opts.dryRun, katakaId: opts.katakaId, yolo: opts.yolo, flavorHints: opts.flavorHints });

    // --bridge-gaps: evaluate identified gaps across all stages
    if (opts.bridgeGaps) {
      const allGaps = result.stageResults.flatMap((sr) => sr.gaps ?? []);
      if (allGaps.length > 0) {
        const store = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
        const bridger = new GapBridger({ knowledgeStore: store });
        const { blocked, bridged } = bridger.bridge(allGaps);
        if (blocked.length > 0) {
          console.error(`[kata] Blocked by ${blocked.length} high-severity gap(s):`);
          for (const g of blocked) console.error(`  • ${g.description}`);
          process.exitCode = 1;
          return;
        }
        if (bridged.length > 0) {
          console.log(`[kata] Captured ${bridged.length} gap(s) as step-tier learnings.`);
          ProjectStateUpdater.incrementGapsClosed(projectStateFile, bridged.length);
        }
      }
    }

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
    saveSavedKata(ctx.kataDir, opts.saveKata, categories, opts.flavorHints);
    ProjectStateUpdater.markDiscovery(projectStateFile, 'savedKataSequence');
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

/** Prevent path traversal via kata names. Only alphanumeric, hyphens, and underscores allowed. */
function assertValidKataName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid kata name "${name}": names must contain only letters, digits, hyphens, and underscores.`,
    );
  }
}

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

function loadSavedKata(kataDir: string, name: string): { stages: StageCategory[]; flavorHints?: Record<string, FlavorHint> } {
  assertValidKataName(name);
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

function saveSavedKata(kataDir: string, name: string, stages: StageCategory[], flavorHints?: Record<string, FlavorHint>): void {
  assertValidKataName(name);
  const dir = katasDir(kataDir);
  mkdirSync(dir, { recursive: true });
  const kata = SavedKataSchema.parse({ name, stages, flavorHints });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(kata, null, 2), 'utf-8');
}

/**
 * Parse --hint flag values into a flavorHints map.
 * Format: stage:flavor1,flavor2[:strategy]
 * Returns undefined if no hints, false on parse error.
 */
function parseHintFlags(hints: string[]): Record<string, FlavorHint> | undefined | false {
  if (!hints || hints.length === 0) return undefined;
  const result: Record<string, FlavorHint> = {};
  const validCategories = StageCategorySchema.options;

  for (const spec of hints) {
    const parts = spec.split(':');
    if (parts.length < 2 || parts.length > 3) {
      console.error(`Error: invalid --hint format "${spec}". Expected: stage:flavor1,flavor2[:strategy]`);
      return false;
    }

    const stage = parts[0]!;
    if (!validCategories.includes(stage as typeof validCategories[number])) {
      console.error(`Error: invalid stage category "${stage}" in --hint. Valid: ${validCategories.join(', ')}`);
      return false;
    }

    const flavors = parts[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    if (flavors.length === 0) {
      console.error(`Error: --hint "${spec}" has no flavor names.`);
      return false;
    }

    const strategy = parts[2] as 'prefer' | 'restrict' | undefined;
    if (strategy && strategy !== 'prefer' && strategy !== 'restrict') {
      console.error(`Error: invalid strategy "${strategy}" in --hint. Valid: prefer, restrict`);
      return false;
    }

    result[stage] = { recommended: flavors, strategy: strategy ?? 'prefer' };
  }

  return result;
}

function deleteSavedKata(kataDir: string, name: string): void {
  assertValidKataName(name);
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
