import type { Command } from 'commander';
import { handleInit } from '@features/init/init-handler.js';
import { getGlobalOptions } from '@cli/utils.js';

/**
 * Register the `kata begin` command.
 */
export function registerInitCommand(program: Command): void {
  program
    .command('begin')
    .description('Initialize a new kata project in the current directory')
    .option('--methodology <name>', 'Methodology framework (default: shape-up)')
    .option('--adapter <name>', 'Execution adapter: manual, claude-cli, composio')
    .option('--skip-prompts', 'Skip interactive prompts and use defaults')
    .action(async (_opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);
      const localOpts = cmd.opts();
      const cwd = globalOpts.cwd ?? process.cwd();

      try {
        const result = await handleInit({
          cwd,
          methodology: localOpts.methodology,
          adapter: localOpts.adapter,
          skipPrompts: localOpts.skipPrompts ?? false,
        });

        if (globalOpts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log('kata project initialized!');
          console.log('');
          console.log(`  Directory: ${result.kataDir}`);
          console.log(`  Methodology: ${result.config.methodology}`);
          console.log(`  Adapter: ${result.config.execution.adapter}`);
          console.log(`  Stages loaded: ${result.stagesLoaded}`);
          console.log(`  Templates loaded: ${result.templatesLoaded}`);
          if (result.config.project.name) {
            console.log(`  Project: ${result.config.project.name}`);
          }
          console.log('');
          console.log('Run "kata form list" to see available stages.');
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });
}
