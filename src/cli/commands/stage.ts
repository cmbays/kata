import type { Command } from 'commander';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
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
    .action(withCommandContext((ctx) => {
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stages = registry.list();

      if (ctx.globalOpts.json) {
        console.log(formatStageJson(stages));
      } else {
        console.log(formatStageTable(stages));
      }
    }));

  stage
    .command('inspect <type>')
    .description('Show details of a specific stage')
    .option('--flavor <flavor>', 'Stage flavor to inspect')
    .action(withCommandContext((ctx, type: string) => {
      const localOpts = ctx.cmd.opts();
      const registry = new StageRegistry(kataDirPath(ctx.kataDir, 'stages'));
      const stage = registry.get(type, localOpts.flavor);

      if (ctx.globalOpts.json) {
        console.log(formatStageJson([stage]));
      } else {
        console.log(formatStageDetail(stage));
      }
    }));
}
