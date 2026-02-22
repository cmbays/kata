import { join } from 'node:path';
import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { resolveKataDir, getGlobalOptions } from '@cli/utils.js';
import {
  formatCycleStatus,
  formatCooldownReport,
  formatCycleStatusJson,
  formatCooldownReportJson,
} from '@cli/formatters/cycle-formatter.js';

/**
 * Register the `kata practice` and `kata reflect` subcommands.
 */
export function registerCycleCommands(parent: Command): void {
  const practice = parent
    .command('practice')
    .description('Manage practice sessions (cycles) — time-boxed work periods');

  // kata practice new — interactive wizard
  practice
    .command('new')
    .description('Create a new practice cycle')
    .option('-b, --budget <tokens>', 'Token budget', parseInt)
    .option('-t, --time <duration>', 'Time budget (e.g., "2 weeks")')
    .option('-n, --name <name>', 'Cycle name')
    .option('--skip-prompts', 'Skip interactive prompts')
    .action(async (_opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);
      const localOpts = cmd.opts();

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const manager = new CycleManager(join(kataDir, 'cycles'));

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

          if (globalOpts.json) {
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

          if (globalOpts.json) {
            console.log(formatCycleStatusJson(status, cycle));
          } else {
            console.log('Cycle created!');
            console.log('');
            console.log(formatCycleStatus(status, cycle));
          }
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  // kata practice status [id]
  practice
    .command('status')
    .description('Show cycle status and budget')
    .argument('[id]', 'Cycle ID (shows all if omitted)')
    .action((id: string | undefined, _opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const manager = new CycleManager(join(kataDir, 'cycles'));

        if (id) {
          const cycle = manager.get(id);
          const status = manager.getBudgetStatus(id);

          if (globalOpts.json) {
            console.log(formatCycleStatusJson(status, cycle));
          } else {
            console.log(formatCycleStatus(status, cycle));
          }
        } else {
          const cycles = manager.list();
          if (cycles.length === 0) {
            console.log('No cycles found. Run "kata practice new" to create one.');
            return;
          }

          if (globalOpts.json) {
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
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  // kata practice focus <cycle-id> — add a bet interactively
  practice
    .command('focus')
    .description('Add a bet to a cycle')
    .argument('<cycle-id>', 'Cycle ID')
    .option('-d, --description <desc>', 'Bet description')
    .option('-a, --appetite <pct>', 'Appetite percentage', parseInt)
    .option('--skip-prompts', 'Skip interactive prompts')
    .action(async (cycleId: string, _opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);
      const localOpts = cmd.opts();

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const manager = new CycleManager(join(kataDir, 'cycles'));

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

        if (globalOpts.json) {
          console.log(formatCycleStatusJson(status, cycle));
        } else {
          console.log('Bet added!');
          console.log('');
          console.log(formatCycleStatus(status, cycle));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  // kata reflect <cycle-id>
  parent
    .command('reflect')
    .description('Run cool-down reflection on a completed cycle')
    .argument('<cycle-id>', 'Cycle ID')
    .action((cycleId: string, _opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const manager = new CycleManager(join(kataDir, 'cycles'));
        const report = manager.generateCooldown(cycleId);

        if (globalOpts.json) {
          console.log(formatCooldownReportJson(report));
        } else {
          console.log(formatCooldownReport(report));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
