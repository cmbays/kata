import { Command } from 'commander';
import { setLoggerOptions } from '@shared/lib/logger.js';
import { registerInitCommand } from './commands/init.js';
import { registerStageCommands } from './commands/stage.js';
import { registerPipelineCommands } from './commands/pipeline.js';
import { registerCycleCommands } from './commands/cycle.js';
import { registerKnowledgeCommands } from './commands/knowledge.js';

const VERSION = '0.1.0';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('kata')
    .description('Development Methodology Engine — encode, compose, and improve development workflows')
    .version(VERSION)
    .option('--json', 'Output in JSON format')
    .option('--verbose', 'Enable verbose logging')
    .option('--cwd <path>', 'Set working directory');

  // Wire --verbose to logger before any command runs
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const opts = actionCommand.optsWithGlobals();
    if (opts.verbose) {
      setLoggerOptions({ level: 'debug' });
    }
  });

  // Wire command modules
  registerInitCommand(program);
  registerStageCommands(program);
  registerPipelineCommands(program);
  registerCycleCommands(program);
  registerKnowledgeCommands(program);

  // kata execute — Execution management (stub — Wave 3+)
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

  return program;
}
