import { join } from 'node:path';
import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { CooldownSession, type BetOutcomeRecord } from '@features/cycle-management/cooldown-session.js';
import type { SuggestionReviewRecord } from '@features/cycle-management/types.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  formatCycleStatus,
  formatCycleStatusJson,
  formatCooldownSessionResult,
  formatBetOutcomePrompt,
  formatBetList,
} from '@cli/formatters/cycle-formatter.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import type { KataAssignment } from '@domain/types/bet.js';
import { DomainArea, WorkType, WorkNovelty, DomainTagsSchema } from '@domain/types/domain-tags.js';
import type { DomainTags } from '@domain/types/domain-tags.js';
import { detectTags } from '@features/domain-confidence/domain-tagger.js';
import { createRunTree, runPaths } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';
import { BeltCalculator, ProjectStateUpdater } from '@features/belt/belt-calculator.js';
import { KatakaConfidenceCalculator } from '@features/kataka/kataka-confidence-calculator.js';
import { KATA_DIRS } from '@shared/constants/paths.js';

/**
 * Register the `kata cycle` and `kata cooldown` subcommands.
 */
export function registerCycleCommands(parent: Command): void {
  const cycle = parent
    .command('cycle')
    .alias('keiko')
    .description('Manage cycles — time-boxed work periods with budgets (alias: keiko)');

  // kata cycle new — interactive wizard
  cycle
    .command('new')
    .description('Create a new cycle')
    .option('-b, --budget <tokens>', 'Token budget', parseInt)
    .option('-t, --time <duration>', 'Time budget (e.g., "2 weeks")')
    .option('-n, --name <name>', 'Cycle name')
    .option('--skip-prompts', 'Skip interactive prompts')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      let tokenBudget: number | undefined = localOpts.budget;
      let timeBudget: string | undefined = localOpts.time;
      let cycleName: string | undefined = localOpts.name;

      // Interactive mode: prompt for budget details and bets
      if (!localOpts.skipPrompts) {
        const { input, confirm } = await import('@inquirer/prompts');

        if (!cycleName) {
          cycleName = await input({ message: 'Cycle name (optional):', default: '' }) || undefined;
        }
        if (tokenBudget === undefined) {
          const budgetStr = await input({ message: 'Token budget (press Enter to skip):', default: '' });
          if (budgetStr) {
            const parsed = parseInt(budgetStr, 10);
            if (Number.isNaN(parsed) || parsed < 0) {
              throw new Error(`Invalid token budget: "${budgetStr}". Must be a non-negative integer.`);
            }
            tokenBudget = parsed;
          }
        }
        if (!timeBudget) {
          timeBudget = await input({ message: 'Time budget (e.g., "2 weeks", press Enter to skip):', default: '' }) || undefined;
        }

        const cycle = manager.create(
          { tokenBudget, timeBudget },
          cycleName,
        );

        // Loop: add bets
        let addMore = await confirm({ message: 'Add a bet?', default: true });
        while (addMore) {
          const description = await input({ message: 'Bet description:' });
          const appetiteStr = await input({ message: 'Appetite (% of budget):', default: '20' });
          const appetite = parseInt(appetiteStr, 10);
          if (Number.isNaN(appetite) || appetite < 0 || appetite > 100) {
            console.error(`  Warning: Invalid appetite "${appetiteStr}". Must be 0-100.`);
            continue;
          }

          // Auto-detect tags from description
          const autoTags = detectTags(description);

          // Optionally prompt user for domain tags
          const wantsTags = await confirm({
            message: 'Add domain tags to this bet? (helps with confidence scoring)',
            default: false,
          });

          let domainTags: DomainTags | undefined;

          if (wantsTags) {
            const { select } = await import('@inquirer/prompts');

            const domainChoice = await select({
              message: 'Domain area:',
              choices: [
                ...DomainArea.options.map((v) => ({ name: v, value: v })),
                { name: '(skip)', value: '' as never },
              ],
              default: autoTags.domain ?? ('' as never),
            });

            const workTypeChoice = await select({
              message: 'Work type:',
              choices: [
                ...WorkType.options.map((v) => ({ name: v, value: v })),
                { name: '(skip)', value: '' as never },
              ],
              default: autoTags.workType ?? ('' as never),
            });

            const noveltyChoice = await select({
              message: 'Novelty:',
              choices: WorkNovelty.options.map((v) => ({ name: v, value: v })),
              default: autoTags.novelty ?? 'familiar',
            });

            domainTags = DomainTagsSchema.parse({
              ...autoTags,
              ...(domainChoice ? { domain: domainChoice } : {}),
              ...(workTypeChoice ? { workType: workTypeChoice } : {}),
              novelty: noveltyChoice,
              source: 'user',
            });
          }

          try {
            manager.addBet(cycle.id, {
              description,
              appetite,
              outcome: 'pending',
              issueRefs: [],
              ...(domainTags ? { domainTags } : {}),
            });
          } catch (error) {
            console.error(`  Warning: ${error instanceof Error ? error.message : String(error)}`);
          }

          addMore = await confirm({ message: 'Add another bet?', default: false });
        }

        const updatedCycle = manager.get(cycle.id);
        const status = manager.getBudgetStatus(cycle.id);

        if (ctx.globalOpts.json) {
          console.log(formatCycleStatusJson(status, updatedCycle));
        } else {
          console.log('Cycle created!');
          console.log('');
          console.log(formatCycleStatus(status, updatedCycle, ctx.globalOpts.plain));
        }
      } else {
        // Non-interactive: create cycle with provided options
        const cycle = manager.create(
          { tokenBudget, timeBudget },
          cycleName,
        );
        const status = manager.getBudgetStatus(cycle.id);

        if (ctx.globalOpts.json) {
          console.log(formatCycleStatusJson(status, cycle));
        } else {
          console.log('Cycle created!');
          console.log('');
          console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
        }
      }
    }));

  // kata cycle status [id]
  cycle
    .command('status')
    .description('Show cycle status and budget')
    .argument('[id]', 'Cycle ID (shows all if omitted)')
    .action(withCommandContext((ctx, id: string | undefined) => {
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      if (id) {
        const cycle = manager.get(id);
        const status = manager.getBudgetStatus(id);

        if (ctx.globalOpts.json) {
          console.log(formatCycleStatusJson(status, cycle));
        } else {
          console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
        }
      } else {
        const cycles = manager.list();
        if (cycles.length === 0) {
          console.log('No cycles found. Run "kata cycle new" to create one.');
          return;
        }

        if (ctx.globalOpts.json) {
          const results = cycles.map((cycle) => {
            const status = manager.getBudgetStatus(cycle.id);
            return JSON.parse(formatCycleStatusJson(status, cycle));
          });
          console.log(JSON.stringify(results, null, 2));
        } else {
          for (const cycle of cycles) {
            const status = manager.getBudgetStatus(cycle.id);
            console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
            console.log('');
          }
        }
      }
    }));

  // kata cycle add-bet <cycle-id> <description>
  cycle
    .command('add-bet <cycle-id> <description>')
    .description('Add a bet to a cycle with an optional kata assignment')
    .option('--kata <name>', 'Named kata pattern (e.g. "full-feature")')
    .option('--gyo <stages>', 'Ad-hoc stage list (comma-separated, e.g. "research,build")')
    .option('-a, --appetite <pct>', 'Appetite percentage (default: 20)', parseInt)
    .option('--domain <area>', 'Domain area tag (e.g. web-frontend, web-backend, security)')
    .option('--work-type <type>', 'Work type tag (e.g. bug-fix, feature-addition, refactor)')
    .option('--novelty <level>', 'Novelty level (familiar, novel, experimental)')
    .action(withCommandContext(async (ctx, cycleId: string, description: string) => {
      const localOpts = ctx.cmd.opts();
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      if (localOpts.kata && localOpts.gyo) {
        throw new Error('--kata and --gyo are mutually exclusive');
      }

      let kata: KataAssignment | undefined;
      if (localOpts.kata) {
        kata = { type: 'named', pattern: localOpts.kata as string };
      } else if (localOpts.gyo) {
        const stages = (localOpts.gyo as string).split(',').map((s) => s.trim()).filter(Boolean);
        if (stages.length === 0) {
          throw new Error('--gyo requires at least one stage');
        }
        kata = { type: 'ad-hoc', stages: stages as ['research' | 'plan' | 'build' | 'review', ...('research' | 'plan' | 'build' | 'review')[]] };
      }

      const appetite: number = localOpts.appetite ?? 20;

      // Build domainTags from CLI flags if any are provided
      let domainTags: DomainTags | undefined;
      if (localOpts.domain || localOpts.workType || localOpts.novelty) {
        const rawTags: Record<string, string> = { source: 'user' };
        if (localOpts.domain) rawTags['domain'] = localOpts.domain as string;
        if (localOpts.workType) rawTags['workType'] = localOpts.workType as string;
        if (localOpts.novelty) rawTags['novelty'] = localOpts.novelty as string;
        domainTags = DomainTagsSchema.parse(rawTags);
      }

      const cycle = manager.addBet(cycleId, {
        description,
        appetite,
        outcome: 'pending',
        issueRefs: [],
        ...(kata ? { kata } : {}),
        ...(domainTags ? { domainTags } : {}),
      });

      const status = manager.getBudgetStatus(cycleId);

      if (ctx.globalOpts.json) {
        console.log(formatCycleStatusJson(status, cycle));
      } else {
        console.log('Bet added!');
        console.log('');
        console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
      }
    }));

  // kata cycle update-bet <bet-id>
  cycle
    .command('update-bet <bet-id>')
    .description('Update the kata assignment for an existing bet')
    .option('--kata <name>', 'Named kata pattern (e.g. "full-feature")')
    .option('--gyo <stages>', 'Ad-hoc stage list (comma-separated, e.g. "research,build")')
    .action(withCommandContext(async (ctx, betId: string) => {
      const localOpts = ctx.cmd.opts();
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      if (localOpts.kata && localOpts.gyo) {
        throw new Error('--kata and --gyo are mutually exclusive');
      }

      let kata: KataAssignment;
      if (localOpts.kata) {
        kata = { type: 'named', pattern: localOpts.kata as string };
      } else if (localOpts.gyo) {
        const stages = (localOpts.gyo as string).split(',').map((s) => s.trim()).filter(Boolean);
        if (stages.length === 0) {
          throw new Error('--gyo requires at least one stage');
        }
        kata = { type: 'ad-hoc', stages: stages as ['research' | 'plan' | 'build' | 'review', ...('research' | 'plan' | 'build' | 'review')[]] };
      } else {
        throw new Error('Either --kata or --gyo is required');
      }

      const found = manager.findBetCycle(betId);
      if (!found) {
        throw new Error(`Bet "${betId}" not found in any cycle`);
      }

      const cycle = manager.updateBet(found.cycle.id, betId, { kata });
      const status = manager.getBudgetStatus(found.cycle.id);

      if (ctx.globalOpts.json) {
        console.log(formatCycleStatusJson(status, cycle));
      } else {
        console.log('Bet updated!');
        console.log('');
        console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
      }
    }));

  // kata cycle start <cycle-id>
  cycle
    .command('start <cycle-id>')
    .description('Start a cycle — validates kata assignments and creates run trees for each bet')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);
      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const katasDir = kataDirPath(ctx.kataDir, 'katas');

      // Pre-flight: read cycle and resolve all kata stages before any state mutations.
      // This ensures that missing kata files are detected before the cycle transitions to 'active'.
      const draftCycle = manager.get(cycleId);

      if (draftCycle.state === 'active' || draftCycle.state === 'cooldown' || draftCycle.state === 'complete') {
        throw new Error(
          `Cannot start cycle "${cycleId}": already in state "${draftCycle.state}". Only planning cycles can be started.`,
        );
      }

      const betsWithoutKata = draftCycle.bets
        .filter((b) => !b.kata)
        .map((b) => b.description);

      if (betsWithoutKata.length > 0) {
        const list = betsWithoutKata.map((d) => `  - "${d}"`).join('\n');
        throw new Error(
          `Cannot start cycle: the following bets have no kata assignment.\n${list}\n\nUse "kata cycle update-bet <bet-id> --kata <pattern>" to assign a kata.`,
        );
      }

      // Pre-flight: load all named kata files so missing patterns fail before any mutations.
      const stageSequences = new Map<string, Array<'research' | 'plan' | 'build' | 'review'>>();
      for (const bet of draftCycle.bets) {
        const kata = bet.kata!;
        if (kata.type === 'named') {
          const kataPath = join(katasDir, `${kata.pattern}.json`);
          const savedKata = JsonStore.read(kataPath, SavedKataSchema);
          stageSequences.set(bet.id, savedKata.stages as Array<'research' | 'plan' | 'build' | 'review'>);
        } else {
          stageSequences.set(bet.id, kata.stages as Array<'research' | 'plan' | 'build' | 'review'>);
        }
      }

      // All validation passed — now transition cycle state and create run trees.
      const { cycle } = manager.startCycle(cycleId);

      const runs: Array<{
        runId: string;
        betId: string;
        betPrompt: string;
        kataPattern: string;
        stageSequence: string[];
        runDir: string;
      }> = [];

      for (const bet of cycle.bets) {
        const kata = bet.kata!;
        const stageSequence = stageSequences.get(bet.id)!;

        const runId = crypto.randomUUID();
        const run: Run = {
          id: runId,
          cycleId,
          betId: bet.id,
          betPrompt: bet.description,
          kataPattern: kata.type === 'named' ? kata.pattern : undefined,
          stageSequence,
          currentStage: null,
          status: 'pending',
          startedAt: new Date().toISOString(),
        };

        createRunTree(runsDir, run);
        manager.setRunId(cycleId, bet.id, runId);

        runs.push({
          runId,
          betId: bet.id,
          betPrompt: bet.description,
          kataPattern: kata.type === 'named' ? kata.pattern : kata.stages.join(','),
          stageSequence,
          runDir: runPaths(runsDir, runId).runDir,
        });
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({ cycleId, status: 'active', runs }, null, 2));
      } else {
        console.log(`Cycle started! ${runs.length} run(s) created.`);
        for (const r of runs) {
          console.log(`\n  Run:      ${r.runId}`);
          console.log(`  Bet:      ${r.betPrompt}`);
          console.log(`  Pattern:  ${r.kataPattern}`);
          console.log(`  Sequence: ${r.stageSequence.join(' → ')}`);
        }
      }
    }));

  // kata cycle focus <cycle-id> — add a bet interactively
  cycle
    .command('focus')
    .description('Add a focus (bet) to a cycle (use add-bet for new workflows)')
    .argument('<cycle-id>', 'Cycle ID')
    .option('-d, --description <desc>', 'Bet description')
    .option('-a, --appetite <pct>', 'Appetite percentage', parseInt)
    .option('--skip-prompts', 'Skip interactive prompts')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const localOpts = ctx.cmd.opts();
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      let description: string = localOpts.description;
      let appetite: number = localOpts.appetite;

      if (!localOpts.skipPrompts && (!description || appetite === undefined)) {
        const { input } = await import('@inquirer/prompts');
        if (!description) {
          description = await input({ message: 'Bet description:' });
        }
        if (appetite === undefined) {
          const appetiteStr = await input({ message: 'Appetite (% of budget):', default: '20' });
          appetite = parseInt(appetiteStr, 10);
        }
      }

      const cycle = manager.addBet(cycleId, {
        description,
        appetite,
        outcome: 'pending',
        issueRefs: [],
      });

      const status = manager.getBudgetStatus(cycleId);

      if (ctx.globalOpts.json) {
        console.log(formatCycleStatusJson(status, cycle));
      } else {
        console.log('Focus added!');
        console.log('');
        console.log(formatCycleStatus(status, cycle, ctx.globalOpts.plain));
      }
    }));

  // ---------------------------------------------------------------------------
  // kata cycle bet (alias: kadai) — bet management subcommand group
  // Issues #188 (alias wire), #190 (bet list)
  // ---------------------------------------------------------------------------
  const bet = cycle
    .command('bet')
    .alias('kadai')
    .description('Manage bets (kadai — challenges) within a cycle (alias: kadai)');

  // kata cycle bet list — list bets in the active (or most recent) cycle
  bet
    .command('list')
    .description('List bets in the active (or most recent) cycle')
    .option('--cycle-id <id>', 'Cycle ID (defaults to active cycle)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const manager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);

      let targetCycle;
      if (localOpts.cycleId) {
        targetCycle = manager.get(localOpts.cycleId as string);
      } else {
        const cycles = manager.list();
        if (cycles.length === 0) {
          console.log('No cycles found. Run "kata cycle new" to create one.');
          return;
        }
        // Prefer active cycle; fall back to most recently updated
        targetCycle = cycles.find((c) => c.state === 'active')
          ?? cycles.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
      }

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          cycleId: targetCycle.id,
          cycleName: targetCycle.name,
          state: targetCycle.state,
          bets: targetCycle.bets,
        }, null, 2));
      } else {
        console.log(formatBetList(targetCycle, ctx.globalOpts.plain));
      }
    }));

  // ---------------------------------------------------------------------------
  // kata cooldown — main command (alias: ma)
  // Subcommands: complete
  // Options: --prepare, --yolo, --skip-prompts, --auto-accept-suggestions
  // ---------------------------------------------------------------------------
  const cooldown = parent
    .command('cooldown')
    .alias('ma')
    .description('Run cooldown reflection on a completed cycle (alias: ma)');

  // kata cooldown complete <cycle-id> — finalize after LLM synthesis
  cooldown
    .command('complete <cycle-id>')
    .description('Finalize cooldown after LLM synthesis (called after --prepare + sensei review)')
    .option('--synthesis-input <id>', 'ID of the pending synthesis input file')
    .option('--accepted <ids>', 'Comma-separated list of proposal IDs to apply')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const localOpts = ctx.cmd.opts();
      const cyclesDir = kataDirPath(ctx.kataDir, 'cycles');
      const manager = new CycleManager(cyclesDir, JsonStore);
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      const synthesisDir = join(ctx.kataDir, 'synthesis');

      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const katakaDir = join(ctx.kataDir, KATA_DIRS.kataka);
      const completeSession = new CooldownSession({
        cycleManager: manager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir: kataDirPath(ctx.kataDir, 'pipelines'),
        historyDir: kataDirPath(ctx.kataDir, 'history'),
        runsDir,
        ruleRegistry,
        dojoDir: kataDirPath(ctx.kataDir, 'dojo'),
        synthesisDir,
        beltCalculator: new BeltCalculator({
          cyclesDir: kataDirPath(ctx.kataDir, 'cycles'),
          knowledgeDir: kataDirPath(ctx.kataDir, 'knowledge'),
          runsDir,
          flavorsDir: kataDirPath(ctx.kataDir, 'flavors'),
          savedKataDir: kataDirPath(ctx.kataDir, 'katas'),
          synthesisDir,
          dojoSessionsDir: join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions'),
        }),
        projectStateFile: join(ctx.kataDir, 'project-state.json'),
        katakaConfidenceCalculator: new KatakaConfidenceCalculator({
          runsDir,
          knowledgeDir: kataDirPath(ctx.kataDir, 'knowledge'),
          katakaDir,
        }),
        katakaDir,
      });

      const synthesisInputId: string | undefined = localOpts.synthesisInput;
      const acceptedIds: string[] | undefined = localOpts.accepted
        ? (localOpts.accepted as string).split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

      const completeResult = await completeSession.complete(cycleId, synthesisInputId, acceptedIds);

      // Fire-and-forget belt discovery hook
      ProjectStateUpdater.markDiscovery(join(ctx.kataDir, 'project-state.json'), 'completedFirstCycleCooldown');

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          report: completeResult.report,
          proposals: completeResult.proposals,
          synthesisProposals: completeResult.synthesisProposals,
        }, null, 2));
      } else {
        console.log(`Cooldown complete for cycle ${cycleId}.`);
        if (completeResult.synthesisProposals && completeResult.synthesisProposals.length > 0) {
          console.log(`Applied ${completeResult.synthesisProposals.length} synthesis proposal(s).`);
        }
        console.log(formatCooldownSessionResult(completeResult, undefined, ctx.globalOpts.plain));
      }
    }));

  // kata cooldown <cycle-id> — default action with --prepare / --yolo / standard mode
  cooldown
    .argument('<cycle-id>', 'Cycle ID')
    .option('--skip-prompts', 'Skip interactive prompts')
    .option('--auto-accept-suggestions', 'Accept all pending rule suggestions without prompts')
    .option('--prepare', 'Write synthesis input file and exit without completing (use with kata-sensei)')
    .option('--yolo', 'Prepare synthesis input, invoke claude --print for synthesis, apply high-confidence proposals, then complete')
    .option('--depth <level>', 'Synthesis depth: quick | standard | thorough', 'standard')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const localOpts = ctx.cmd.opts();
      const cyclesDir = kataDirPath(ctx.kataDir, 'cycles');
      const manager = new CycleManager(cyclesDir, JsonStore);
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      const synthesisDir = join(ctx.kataDir, 'synthesis');

      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const katakaDir = join(ctx.kataDir, KATA_DIRS.kataka);
      const session = new CooldownSession({
        cycleManager: manager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir: kataDirPath(ctx.kataDir, 'pipelines'),
        historyDir: kataDirPath(ctx.kataDir, 'history'),
        runsDir,
        ruleRegistry,
        dojoDir: kataDirPath(ctx.kataDir, 'dojo'),
        synthesisDir,
        beltCalculator: new BeltCalculator({
          cyclesDir,
          knowledgeDir: kataDirPath(ctx.kataDir, 'knowledge'),
          runsDir,
          flavorsDir: kataDirPath(ctx.kataDir, 'flavors'),
          savedKataDir: kataDirPath(ctx.kataDir, 'katas'),
          synthesisDir,
          dojoSessionsDir: join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions'),
        }),
        projectStateFile: join(ctx.kataDir, 'project-state.json'),
        katakaConfidenceCalculator: new KatakaConfidenceCalculator({
          runsDir,
          knowledgeDir: kataDirPath(ctx.kataDir, 'knowledge'),
          katakaDir,
        }),
        katakaDir,
      });

      // --- --prepare mode: write synthesis input file and exit without completing ---
      if (localOpts.prepare) {
        const prepareResult = await session.prepare(cycleId, [], localOpts.depth);

        if (ctx.globalOpts.json) {
          console.log(JSON.stringify({
            synthesisInputId: prepareResult.synthesisInputId,
            synthesisInputPath: prepareResult.synthesisInputPath,
            report: prepareResult.report,
            proposals: prepareResult.proposals,
          }, null, 2));
        } else {
          console.log(`Synthesis input prepared.`);
          console.log(`  ID:   ${prepareResult.synthesisInputId}`);
          console.log(`  File: ${prepareResult.synthesisInputPath}`);
          console.log('');
          console.log('Next step: ask kata-sensei to review the synthesis input and generate proposals.');
          console.log(`  Then run: kata cooldown complete ${cycleId} --synthesis-input ${prepareResult.synthesisInputId}`);
        }
        return;
      }

      // --- --yolo mode: prepare + claude for synthesis + apply high-confidence proposals ---
      if (localOpts.yolo) {
        const prepareResult = await session.prepare(cycleId, [], localOpts.depth);

        if (!ctx.globalOpts.json) {
          console.log(`Synthesis input prepared: ${prepareResult.synthesisInputPath}`);
          console.log('Invoking claude --print for synthesis...');
        }

        let synthesisProposals: import('@domain/types/synthesis.js').SynthesisProposal[] = [];
        const synthesisInputId: string = prepareResult.synthesisInputId;

        try {
          const { execFileSync } = await import('node:child_process');
          const { readFileSync: rfs } = await import('node:fs');

          const inputContent = rfs(prepareResult.synthesisInputPath, 'utf-8');
          const prompt = [
            'You are kata-sensei performing LLM synthesis during cooldown.',
            'Read the following SynthesisInput and generate a JSON array of SynthesisProposal objects.',
            'Each proposal must include: id (UUID), type (one of: new-learning, update-learning, promote, archive, methodology-recommendation),',
            'confidence (0-1), citations (array of 2+ UUIDs from the input), reasoning, createdAt (ISO datetime), and type-specific fields.',
            'Only output a JSON array, no other text.',
            '',
            'SYNTHESIS INPUT:',
            inputContent,
          ].join('\n');

          // Pipe prompt via stdin to avoid ARG_MAX limits on large synthesis inputs
          const output = execFileSync('claude', ['--print'], {
            input: prompt,
            encoding: 'utf-8',
            timeout: 120000,
          });

          // Parse the JSON proposals from claude output
          const jsonMatch = output.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const { SynthesisProposalSchema, SynthesisResultSchema } = await import('@domain/types/synthesis.js');
            const rawProposals = JSON.parse(jsonMatch[0]);
            if (Array.isArray(rawProposals)) {
              const validProposals: import('@domain/types/synthesis.js').SynthesisProposal[] = [];
              for (const p of rawProposals) {
                const parsed = SynthesisProposalSchema.safeParse(p);
                if (parsed.success) {
                  validProposals.push(parsed.data);
                }
              }
              synthesisProposals = validProposals;

              // Write result file so complete() can pick it up
              const resultPath = join(synthesisDir, `result-${synthesisInputId}.json`);
              JsonStore.write(resultPath, { inputId: synthesisInputId, proposals: synthesisProposals }, SynthesisResultSchema);
            }
          }
        } catch (err) {
          if (!ctx.globalOpts.json) {
            console.warn(`Warning: claude synthesis failed (${err instanceof Error ? err.message : String(err)}). Completing without proposals.`);
          }
        }

        // Apply only high-confidence proposals (confidence > 0.8)
        const highConfidenceIds = synthesisProposals
          .filter((p) => p.confidence > 0.8)
          .map((p) => p.id);

        const yoloResult = await session.complete(cycleId, synthesisInputId, highConfidenceIds);

        // Fire-and-forget belt discovery hook
        ProjectStateUpdater.markDiscovery(join(ctx.kataDir, 'project-state.json'), 'completedFirstCycleCooldown');

        if (ctx.globalOpts.json) {
          console.log(JSON.stringify({
            report: yoloResult.report,
            proposals: yoloResult.proposals,
            synthesisProposals: yoloResult.synthesisProposals,
          }, null, 2));
        } else {
          if (yoloResult.synthesisProposals && yoloResult.synthesisProposals.length > 0) {
            console.log(`Applied ${yoloResult.synthesisProposals.length} high-confidence synthesis proposal(s).`);
          }
          console.log(formatCooldownSessionResult(yoloResult, undefined, ctx.globalOpts.plain));
        }
        return;
      }

      // --- Default mode: full run (prepare + complete without synthesis step) ---
      const betOutcomes: BetOutcomeRecord[] = [];

      // Interactive mode: prompt for bet outcomes
      if (!localOpts.skipPrompts) {
        const report = manager.generateCooldown(cycleId);

        if (report.bets.length > 0) {
          const { select, input } = await import('@inquirer/prompts');

          console.log('Review each bet and record its outcome:');
          console.log('');

          for (const bet of report.bets) {
            console.log(formatBetOutcomePrompt(bet));
            console.log('');

            const outcome = await select({
              message: `Outcome for "${bet.description}":`,
              choices: [
                { name: 'Complete', value: 'complete' as const },
                { name: 'Partial', value: 'partial' as const },
                { name: 'Abandoned', value: 'abandoned' as const },
              ],
            });

            let notes: string | undefined;
            if (outcome !== 'complete') {
              notes = await input({
                message: 'Notes (optional):',
                default: '',
              }) || undefined;
            }

            betOutcomes.push({ betId: bet.betId, outcome, notes });
          }
          console.log('');
        }
      }

      const result = await session.run(cycleId, betOutcomes);

      // Fire-and-forget belt discovery hook
      ProjectStateUpdater.markDiscovery(join(ctx.kataDir, 'project-state.json'), 'completedFirstCycleCooldown');

      // Rule suggestion review — after session.run() so suggestions are loaded
      const suggestionReviewRecords: SuggestionReviewRecord[] = [];
      const suggestions = result.ruleSuggestions ?? [];

      if (suggestions.length > 0) {
        if (localOpts.autoAcceptSuggestions) {
          // Headless: accept all suggestions without prompts
          for (const suggestion of suggestions) {
            ruleRegistry.acceptSuggestion(suggestion.id);
            suggestionReviewRecords.push({ id: suggestion.id, decision: 'accepted' });
          }
          if (!ctx.globalOpts.json) {
            console.log(`Auto-accepted ${suggestions.length} rule suggestion(s).`);
          }
        } else if (!localOpts.skipPrompts) {
          const { select, input } = await import('@inquirer/prompts');

          console.log('');
          console.log('--- Rule Suggestions ---');
          console.log('Review pending rule suggestions:');
          console.log('');

          for (const suggestion of suggestions) {
            const { suggestedRule, observationCount } = suggestion;
            console.log(
              `  [${suggestedRule.effect}] flavor "${suggestedRule.name}" — ${suggestedRule.condition} (${observationCount} observation${observationCount === 1 ? '' : 's'})`,
            );

            const decision = await select({
              message: 'Decision:',
              choices: [
                { name: 'Accept', value: 'accepted' as const },
                { name: 'Reject', value: 'rejected' as const },
                { name: 'Defer', value: 'deferred' as const },
              ],
            });

            if (decision === 'accepted') {
              ruleRegistry.acceptSuggestion(suggestion.id);
              suggestionReviewRecords.push({ id: suggestion.id, decision: 'accepted' });
            } else if (decision === 'rejected') {
              const reason = await input({
                message: 'Rejection reason (optional):',
                default: '',
              }) || 'No reason provided';
              ruleRegistry.rejectSuggestion(suggestion.id, reason);
              suggestionReviewRecords.push({ id: suggestion.id, decision: 'rejected', rejectionReason: reason });
            } else {
              suggestionReviewRecords.push({ id: suggestion.id, decision: 'deferred' });
            }
          }
        }
      }

      // Only surface a review summary when some action was taken (accept/reject/defer recorded).
      // If --skip-prompts suppressed the loop with suggestions present, leave it undefined so
      // the formatter shows "N pending suggestion(s) (run interactively to review)" instead.
      const suggestionReview = suggestionReviewRecords.length > 0 ? {
        accepted: suggestionReviewRecords.filter((r) => r.decision === 'accepted').length,
        rejected: suggestionReviewRecords.filter((r) => r.decision === 'rejected').length,
        deferred: suggestionReviewRecords.filter((r) => r.decision === 'deferred').length,
      } : undefined;

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          report: result.report,
          betOutcomes: result.betOutcomes,
          proposals: result.proposals,
          learningsCaptured: result.learningsCaptured,
          runSummaries: result.runSummaries,
          ruleSuggestions: result.ruleSuggestions,
          suggestionReview,
        }, null, 2));
      } else {
        console.log(formatCooldownSessionResult(result, suggestionReview, ctx.globalOpts.plain));
      }
    }));
}
