import type { Command } from 'commander';

/**
 * Register execute commands on the given parent Command.
 * kata execute run <stage>  — alias: kata kiai run
 * kata execute status       — alias: kata kiai status
 *
 * These commands are stubs pending Wave 5 implementation.
 */
export function registerExecuteCommands(program: Command): void {
  const execute = program
    .command('execute')
    .alias('kiai')
    .description('Manage execution sessions (alias: kiai)');

  execute
    .command('run <stage>')
    .description('Run a focused execution of a stage')
    .option('-p, --pipeline <id>', 'Pipeline context')
    .action((stage: string) => {
      console.log(`kata execute run ${stage} — not yet implemented`);
    });

  execute
    .command('status')
    .description('Show current execution session status')
    .action(() => {
      console.log('kata execute status — not yet implemented');
    });
}
