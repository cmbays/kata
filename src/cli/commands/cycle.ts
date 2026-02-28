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
} from '@cli/formatters/cycle-formatter.js';
import { SavedKataSchema } from '@domain/types/saved-kata.js';
import type { KataAssignment } from '@domain/types/bet.js';
import { createRunTree, runPaths } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

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

          try {
            manager.addBet(cycle.id, {
              description,
              appetite,
              outcome: 'pending',
              issueRefs: [],
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

      const cycle = manager.addBet(cycleId, {
        description,
        appetite,
        outcome: 'pending',
        issueRefs: [],
        ...(kata ? { kata } : {}),
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

  // kata cooldown <cycle-id>
  parent
    .command('cooldown')
    .alias('ma')
    .description('Run cooldown reflection on a completed cycle (alias: ma)')
    .argument('<cycle-id>', 'Cycle ID')
    .option('--skip-prompts', 'Skip interactive prompts')
    .option('--auto-accept-suggestions', 'Accept all pending rule suggestions without prompts')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const localOpts = ctx.cmd.opts();
      const cyclesDir = kataDirPath(ctx.kataDir, 'cycles');
      const manager = new CycleManager(cyclesDir, JsonStore);
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));

      const session = new CooldownSession({
        cycleManager: manager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir: kataDirPath(ctx.kataDir, 'pipelines'),
        historyDir: kataDirPath(ctx.kataDir, 'history'),
        runsDir: kataDirPath(ctx.kataDir, 'runs'),
        ruleRegistry,
        dojoDir: kataDirPath(ctx.kataDir, 'dojo'),
      });

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
