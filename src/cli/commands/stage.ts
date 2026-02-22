import { join } from 'node:path';
import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { resolveKataDir, getGlobalOptions } from '@cli/utils.js';
import { formatStageTable, formatStageDetail, formatStageJson } from '@cli/formatters/stage-formatter.js';

/**
 * Register the `kata form` subcommands.
 */
export function registerStageCommands(parent: Command): void {
  const form = parent
    .command('form')
    .description('Manage forms (stages) — reusable methodology steps');

  form
    .command('list')
    .description('List available forms')
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
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  form
    .command('inspect <type>')
    .description('Show details of a specific form')
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
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
