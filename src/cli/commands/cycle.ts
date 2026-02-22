import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { CooldownSession, type BetOutcomeRecord } from '@features/cycle-management/cooldown-session.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  formatCycleStatus,
  formatCycleStatusJson,
  formatCooldownSessionResult,
  formatBetOutcomePrompt,
} from '@cli/formatters/cycle-formatter.js';

/**
 * Register the `kata cycle` and `kata cooldown` subcommands.
 */
export function registerCycleCommands(parent: Command): void {
  const cycle = parent
    .command('cycle')
    .alias('enbu')
    .description('Manage cycles — time-boxed work periods with budgets (alias: enbu)');

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
          console.log(formatCycleStatus(status, updatedCycle));
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
          console.log(formatCycleStatus(status, cycle));
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
          console.log(formatCycleStatus(status, cycle));
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
            console.log(formatCycleStatus(status, cycle));
            console.log('');
          }
        }
      }
    }));

  // kata cycle focus <cycle-id> — add a bet interactively
  cycle
    .command('focus')
    .description('Add a focus (bet) to a cycle')
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
        console.log(formatCycleStatus(status, cycle));
      }
    }));

  // kata cooldown <cycle-id>
  parent
    .command('cooldown')
    .alias('ma')
    .description('Run cooldown reflection on a completed cycle (alias: ma)')
    .argument('<cycle-id>', 'Cycle ID')
    .option('--skip-prompts', 'Skip interactive prompts')
    .action(withCommandContext(async (ctx, cycleId: string) => {
      const localOpts = ctx.cmd.opts();
      const cyclesDir = kataDirPath(ctx.kataDir, 'cycles');
      const manager = new CycleManager(cyclesDir, JsonStore);
      const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));

      const session = new CooldownSession({
        cycleManager: manager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir: kataDirPath(ctx.kataDir, 'pipelines'),
        historyDir: kataDirPath(ctx.kataDir, 'history'),
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

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          report: result.report,
          betOutcomes: result.betOutcomes,
          proposals: result.proposals,
          learningsCaptured: result.learningsCaptured,
        }, null, 2));
      } else {
        console.log(formatCooldownSessionResult(result));
      }
    }));
}
