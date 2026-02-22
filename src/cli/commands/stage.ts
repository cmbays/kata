import { join } from 'node:path';
import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { resolveKataDir, getGlobalOptions, handleCommandError } from '@cli/utils.js';
import { formatStageTable, formatStageDetail, formatStageJson } from '@cli/formatters/stage-formatter.js';

/**
 * Register the `kata stage` subcommands.
 */
export function registerStageCommands(parent: Command): void {
  const stage = parent
    .command('stage')
    .alias('form')
    .description('Manage stages — reusable methodology steps (alias: form)');

  stage
    .command('list')
    .description('List available stages')
    .action((_opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const registry = new StageRegistry(join(kataDir, 'stages'));
        const stages = registry.list();

        if (globalOpts.json) {
          console.log(formatStageJson(stages));
        } else {
          console.log(formatStageTable(stages));
        }
      } catch (error) {
        handleCommandError(error, globalOpts.verbose);
      }
    });

  stage
    .command('inspect <type>')
    .description('Show details of a specific stage')
    .option('--flavor <flavor>', 'Stage flavor to inspect')
    .action((type: string, _opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);
      const localOpts = cmd.opts();

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const registry = new StageRegistry(join(kataDir, 'stages'));
        const stage = registry.get(type, localOpts.flavor);

        if (globalOpts.json) {
          console.log(formatStageJson([stage]));
        } else {
          console.log(formatStageDetail(stage));
        }
      } catch (error) {
        handleCommandError(error, globalOpts.verbose);
      }
    });
}
