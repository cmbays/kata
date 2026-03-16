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
import { KataAgentRegistry } from '@infra/registries/kata-agent-registry.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepFlavorExecutor } from '@features/execute/step-flavor-executor.js';
import { WorkflowRunner } from '@features/execute/workflow-runner.js';
import { GapBridger } from '@features/execute/gap-bridger.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { ProjectStateUpdater } from '@features/belt/belt-calculator.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { SessionExecutionBridge } from '@infra/execution/session-bridge.js';
import {
  assertValidKataName,
  buildPreparedCycleOutputLines,
  buildPreparedRunOutputLines,
  formatDurationMs,
  formatAgentLoadError,
  formatExplain,
  mergePinnedFlavors,
  parseBetOption,
  parseCompletedRunArtifacts,
  parseCompletedRunTokenUsage,
  parseHintFlags,
} from '@cli/commands/execute.helpers.js';
import { resolveRef } from '@cli/resolve-ref.js';
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

  // ---- cycle <id> --prepare/--status/--complete (session bridge) ----
  execute
    .command('cycle <cycle-ref>')
    .description('Session bridge — prepare, monitor, or complete a cycle for in-session agent execution')
    .option('--prepare', 'Prepare all pending bets in the cycle for agent dispatch')
    .option('--status', 'Get aggregated status of all runs in the cycle')
    .option('--complete', 'Complete all in-progress runs in the cycle')
    .option('--agent <id>', 'Agent ID to attribute all prepared runs to (only used with --prepare)')
    .option('--kataka <id>', 'Alias for --agent <id>')
    .option('--json', 'Output as JSON')
    .action(withCommandContext(async (ctx, cycleRef: string) => {
      const localOpts = ctx.cmd.optsWithGlobals() as {
        prepare?: boolean;
        status?: boolean;
        complete?: boolean;
        agent?: string;
        kataka?: string;
        json?: boolean;
      };
      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      const bridge = new SessionExecutionBridge(ctx.kataDir);
      const agentId = localOpts.agent ?? localOpts.kataka;

      // Resolve cycle ref to ID
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);
      const cycleId = resolveRef(cycleRef, manager.list(), 'cycle').id;

      if (localOpts.prepare) {
        // Validate --agent/--kataka if provided
        if (agentId) {
          try {
            const agentRegistry = new KataAgentRegistry(join(ctx.kataDir, KATA_DIRS.kataka));
            agentRegistry.get(agentId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(formatAgentLoadError(agentId, msg));
            process.exitCode = 1;
            return;
          }
        }

        const result = bridge.prepareCycle(cycleId, agentId);
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          for (const line of buildPreparedCycleOutputLines(result)) {
            console.log(line);
          }
        }
      } else if (localOpts.status) {
        const result = bridge.getCycleStatus(cycleId);
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Cycle "${result.cycleName}" — ${result.elapsed} elapsed`);
          if (result.budgetUsed) {
            console.log(`  Budget: ${result.budgetUsed.percent}% used (~${result.budgetUsed.tokenEstimate} tokens)`);
          }
          console.log('');
          for (const bet of result.bets) {
            const status = bet.status === 'in-progress' ? '⟳' : bet.status === 'complete' ? '✓' : bet.status === 'failed' ? '✗' : '·';
            console.log(`  ${status} ${bet.betName} [${bet.status}]`);
            if (bet.runId) {
              console.log(`    kansatsu: ${bet.kansatsuCount}, maki: ${bet.artifactCount}, kime: ${bet.decisionCount}`);
            }
          }
        }
      } else if (localOpts.complete) {
        const result = bridge.completeCycle(cycleId, {});
        if (isJson) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`Cycle "${result.cycleName}" completed.`);
          console.log(`  Bets: ${result.completedBets}/${result.totalBets} completed`);
          console.log(`  Duration: ${formatDurationMs(result.totalDurationMs)}`);
          if (result.tokenUsage) {
            console.log(`  Tokens: ${result.tokenUsage.total} total (${result.tokenUsage.inputTokens} in, ${result.tokenUsage.outputTokens} out)`);
          }
        }
      } else {
        console.error('Specify one of: --prepare, --status, --complete');
        process.exitCode = 1;
      }
    }));

  // ---- complete <run-id> (complete a single bridge run) ----
  execute
    .command('complete <run-id>')
    .description('Complete a single bridge run after agent finishes')
    .option('--success', 'Mark run as successful (default)')
    .option('--failed', 'Mark run as failed')
    .option('--artifacts <json>', 'JSON array of artifacts: [{"name":"...","path":"..."}]')
    .option('--notes <text>', 'Free-form notes from the agent')
    .option('--input-tokens <n>', 'Input token count consumed by the agent (enables cooldown utilization)', parseInt)
    .option('--output-tokens <n>', 'Output token count produced by the agent (enables cooldown utilization)', parseInt)
    .option('--json', 'Output as JSON')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts() as {
        success?: boolean;
        failed?: boolean;
        artifacts?: string;
        notes?: string;
        inputTokens?: number;
        outputTokens?: number;
        json?: boolean;
      };
      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      const bridge = new SessionExecutionBridge(ctx.kataDir);

      const parsedArtifacts = parseCompletedRunArtifacts(localOpts.artifacts);
      if (!parsedArtifacts.ok) {
        console.error(parsedArtifacts.error);
        process.exitCode = 1;
        return;
      }
      const artifacts = parsedArtifacts.value as Array<{ name: string; path?: string }> | undefined;

      const parsedTokenUsage = parseCompletedRunTokenUsage(localOpts.inputTokens, localOpts.outputTokens);
      if (!parsedTokenUsage.ok) {
        console.error(parsedTokenUsage.error);
        process.exitCode = 1;
        return;
      }
      const { hasTokens, totalTokens, tokenUsage } = parsedTokenUsage.value as {
        hasTokens: boolean;
        totalTokens?: number;
        tokenUsage?: {
          inputTokens?: number;
          outputTokens?: number;
          total: number;
        };
      };

      bridge.complete(runId, {
        success: !localOpts.failed,
        artifacts,
        notes: localOpts.notes,
        ...(tokenUsage ? { tokenUsage } : {}),
      });

      if (isJson) {
        console.log(JSON.stringify({
          runId,
          status: localOpts.failed ? 'failed' : 'complete',
          ...(tokenUsage ? { tokenUsage } : {}),
        }));
      } else {
        const tokenLine = hasTokens
          ? ` (tokens: ${totalTokens ?? 0} total, ${tokenUsage?.inputTokens ?? 0} in, ${tokenUsage?.outputTokens ?? 0} out)`
          : '';
        console.log(`Run ${runId} marked as ${localOpts.failed ? 'failed' : 'complete'}.${tokenLine}`);
      }
    }));

  // ---- context <run-id> (generate fresh agent context at dispatch time) ----
  execute
    .command('context <run-id>')
    .alias('ma-context')
    .description('Generate a fresh agent context block for an already-prepared run (late-bind dispatch)')
    .option('--json', 'Wrap output in a JSON object with a "agentContext" key')
    .action(withCommandContext(async (ctx, runId: string) => {
      const localOpts = ctx.cmd.opts() as { json?: boolean };
      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      const bridge = new SessionExecutionBridge(ctx.kataDir);

      const agentContext = bridge.getAgentContext(runId);

      if (isJson) {
        console.log(JSON.stringify({ runId, agentContext }, null, 2));
      } else {
        console.log(agentContext);
      }
    }));

  // ---- prepare --bet <bet-id> (prepare a single bet) ----
  execute
    .command('prepare')
    .description('Prepare a single bet for agent execution (session bridge)')
    .requiredOption('--bet <bet-id>', 'Bet ID to prepare')
    .option('--agent <id>', 'Agent ID to attribute this run to — written to run.json so observations auto-populate agent attribution')
    .option('--kataka <id>', 'Alias for --agent <id>')
    .option('--json', 'Output as JSON')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts() as { bet: string; agent?: string; kataka?: string; json?: boolean };
      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      const bridge = new SessionExecutionBridge(ctx.kataDir);
      const agentId = localOpts.agent ?? localOpts.kataka;

      // Validate --agent/--kataka if provided
      if (agentId) {
        try {
          const agentRegistry = new KataAgentRegistry(join(ctx.kataDir, KATA_DIRS.kataka));
          agentRegistry.get(agentId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(formatAgentLoadError(agentId, msg));
          process.exitCode = 1;
          return;
        }
      }

      const result = bridge.prepare(localOpts.bet, agentId);
      if (isJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        let agentContextBlock: string;
        try {
          agentContextBlock = bridge.getAgentContext(result.runId);
        } catch (err) {
          agentContextBlock = `(context unavailable: ${err instanceof Error ? err.message : String(err)})`;
        }
        for (const line of buildPreparedRunOutputLines(result, agentContextBlock)) {
          console.log(line);
        }
      }
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
        pin: mergePinnedFlavors(localOpts.pin ?? [], localOpts.ryu ?? []),
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
    .option('--agent <id>', 'Agent ID driving this run — stored in artifact metadata and attributed to observations')
    .option('--kataka <id>', 'Alias for --agent <id>')
    .option('--yolo', 'Skip confidence gate checks — all decisions proceed without human approval')
    .option('--bridge-gaps', 'Capture identified gaps as step-tier learnings; block on high-severity gaps')
    .option('--hint <spec>', 'Per-stage flavor hint: stage:flavor1,flavor2[:strategy] — guides orchestrator selection (can be repeated)', collect, [])
    .option('--explain', 'Print per-flavor scoring breakdown showing why each flavor was scored and which was selected')
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

      const pin = mergePinnedFlavors(localOpts.ryu ?? [], localOpts.pin ?? []);

      // Parse --hint flags into flavorHints map (merges with loaded kata hints)
      const cliHints = parseHintFlags(localOpts.hint as string[] | undefined);
      if (!cliHints.ok) {
        console.error(cliHints.error);
        process.exitCode = 1;
        return;
      }
      const mergedHints = cliHints.value
        ? { ...(resolvedHints ?? {}), ...cliHints.value }
        : resolvedHints;

      await runCategories(ctx, resolvedCategories, {
        bet: betFromNext ?? (localOpts.bet as string | undefined),
        pin,
        dryRun: localOpts.dryRun,
        saveKata: localOpts.saveKata,
        agentId: (localOpts.agent ?? localOpts.kataka) as string | undefined,
        yolo: localOpts.yolo as boolean | undefined,
        bridgeGaps: localOpts.bridgeGaps as boolean | undefined,
        flavorHints: mergedHints,
        explain: localOpts.explain as boolean | undefined,
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
  /** ID of the agent driving this run. Validated against KataAgentRegistry before execution. */
  agentId?: string;
  /** Compatibility alias for older kataka-named execution state. */
  katakaId?: string;
  /** Skip confidence gate checks — all decisions proceed without human approval. */
  yolo?: boolean;
  /** Capture identified gaps as step-tier learnings; block on high-severity gaps. */
  bridgeGaps?: boolean;
  /** Parsed flavor hints (from saved kata or --hint flags). */
  flavorHints?: Record<string, FlavorHint>;
  /** Print flavor scoring breakdown before results. */
  explain?: boolean;
}

async function runCategories(
  ctx: { kataDir: string; globalOpts: { json?: boolean }; cmd: { opts(): Record<string, unknown> } },
  rawCategories: string[],
  opts: RunOptions,
): Promise<void> {
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
  const parsedBet = parseBetOption(opts.bet);
  if (!parsedBet.ok) {
    console.error(parsedBet.error);
    process.exitCode = 1;
    return;
  }
  const bet = parsedBet.value;
  const agentId = opts.agentId ?? opts.katakaId;
  const projectStateFile = join(ctx.kataDir, 'project-state.json');
  ProjectStateUpdater.markDiscovery(projectStateFile, 'ranFirstExecution');
  if (opts.yolo) ProjectStateUpdater.markRanWithYolo(projectStateFile);

  if (agentId) {
    try {
      const agentRegistry = new KataAgentRegistry(join(ctx.kataDir, KATA_DIRS.kataka));
      agentRegistry.get(agentId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(formatAgentLoadError(agentId, msg));
      process.exitCode = 1;
      return;
    }
  }

  const isJson = Boolean(ctx.globalOpts.json || opts.json);

  if (categories.length === 1) {
    const shouldContinue = await runSingleCategoryMode({
      ctx,
      runner,
      category: categories[0]!,
      bet,
      agentId,
      isJson,
      opts,
      projectStateFile,
    });
    if (!shouldContinue) return;
  } else {
    const shouldContinue = await runPipelineMode({
      ctx,
      runner,
      categories,
      bet,
      agentId,
      isJson,
      opts,
      projectStateFile,
    });
    if (!shouldContinue) return;
  }

  if (opts.saveKata && !opts.dryRun) {
    saveSavedKata(ctx.kataDir, opts.saveKata, categories, opts.flavorHints);
    ProjectStateUpdater.markDiscovery(projectStateFile, 'savedKataSequence');
    if (!isJson) console.log(`\nKata "${opts.saveKata}" saved.`);
  }
}

type RunContext = { kataDir: string; globalOpts: { json?: boolean }; cmd: { opts(): Record<string, unknown> } };
type StageRunResult = Awaited<ReturnType<WorkflowRunner['runStage']>>;
type PipelineRunResult = Awaited<ReturnType<WorkflowRunner['runPipeline']>>;

async function runSingleCategoryMode(input: {
  ctx: RunContext;
  runner: WorkflowRunner;
  category: StageCategory;
  bet: Record<string, unknown> | undefined;
  agentId?: string;
  isJson: boolean;
  opts: RunOptions;
  projectStateFile: string;
}): Promise<boolean> {
  const result = await input.runner.runStage(input.category, {
    bet: input.bet,
    pin: input.opts.pin,
    dryRun: input.opts.dryRun,
    agentId: input.agentId,
    katakaId: input.agentId,
    yolo: input.opts.yolo,
    flavorHints: input.opts.flavorHints,
  });

  const shouldContinue = bridgeExecutionGaps({
    kataDir: input.ctx.kataDir,
    projectStateFile: input.projectStateFile,
    gaps: input.opts.bridgeGaps ? result.gaps : undefined,
  });
  if (!shouldContinue) return false;

  printSingleCategoryResult(result, input.isJson, input.opts);
  return true;
}

async function runPipelineMode(input: {
  ctx: RunContext;
  runner: WorkflowRunner;
  categories: StageCategory[];
  bet: Record<string, unknown> | undefined;
  agentId?: string;
  isJson: boolean;
  opts: RunOptions;
  projectStateFile: string;
}): Promise<boolean> {
  const result = await input.runner.runPipeline(input.categories, {
    bet: input.bet,
    dryRun: input.opts.dryRun,
    agentId: input.agentId,
    katakaId: input.agentId,
    yolo: input.opts.yolo,
    flavorHints: input.opts.flavorHints,
  });

  const shouldContinue = bridgeExecutionGaps({
    kataDir: input.ctx.kataDir,
    projectStateFile: input.projectStateFile,
    gaps: input.opts.bridgeGaps
      ? result.stageResults.flatMap((stageResult) => stageResult.gaps ?? [])
      : undefined,
  });
  if (!shouldContinue) return false;

  printPipelineResult(result, input.categories, input.isJson, input.opts);
  return true;
}

function bridgeExecutionGaps(input: {
  kataDir: string;
  projectStateFile: string;
  gaps?: Array<{
    description: string;
    severity: 'low' | 'medium' | 'high';
    suggestedFlavors: string[];
  }>;
}): boolean {
  if (!input.gaps || input.gaps.length === 0) return true;

  const store = new KnowledgeStore(kataDirPath(input.kataDir, 'knowledge'));
  const bridger = new GapBridger({ knowledgeStore: store });
  const { blocked, bridged } = bridger.bridge(input.gaps);

  if (blocked.length > 0) {
    console.error(`[kata] Blocked by ${blocked.length} high-severity gap(s):`);
    for (const gap of blocked) console.error(`  • ${gap.description}`);
    process.exitCode = 1;
    return false;
  }

  if (bridged.length > 0) {
    console.log(`[kata] Captured ${bridged.length} gap(s) as step-tier learnings.`);
    ProjectStateUpdater.incrementGapsClosed(input.projectStateFile, bridged.length);
  }

  return true;
}

function printSingleCategoryResult(result: StageRunResult, isJson: boolean, opts: RunOptions): void {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (opts.explain) {
    console.log(formatExplain(result.stageCategory, result.selectedFlavors, result.matchReports));
    console.log('');
  }

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

function printPipelineResult(
  result: PipelineRunResult,
  categories: StageCategory[],
  isJson: boolean,
  opts: RunOptions,
): void {
  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (opts.explain) {
    for (const stageResult of result.stageResults) {
      console.log(formatExplain(stageResult.stageCategory, stageResult.selectedFlavors, stageResult.matchReports));
      console.log('');
    }
  }

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

// ---------------------------------------------------------------------------
// Runner builder + helpers
// ---------------------------------------------------------------------------

function buildRunner(kataDir: string): WorkflowRunner {
  const configPath = kataDirPath(kataDir, 'config');
  const config = JsonStore.exists(configPath)
    ? JsonStore.read(configPath, KataConfigSchema)
    : undefined;

  const stepRegistry = new StepRegistry(kataDirPath(kataDir, 'stages'));
  const flavorRegistry = new FlavorRegistry(kataDirPath(kataDir, 'flavors'));
  const decisionRegistry = new DecisionRegistry(kataDirPath(kataDir, 'history'));

  const defaultConfig = KataConfigSchema.parse({
    methodology: 'shape-up',
    execution: { adapter: 'manual', config: {} },
    customStagePaths: [],
    project: {},
  });

  const effectiveConfig = config ?? defaultConfig;

  const executor = new StepFlavorExecutor({
    stepRegistry,
    adapterResolver: AdapterResolver,
    config: effectiveConfig,
  });

  const analytics = new UsageAnalytics(kataDir);
  return new WorkflowRunner({
    flavorRegistry,
    decisionRegistry,
    executor,
    kataDir,
    analytics,
    adapterName: effectiveConfig.execution.adapter,
  });
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
