import { Command } from 'commander';
import { setLoggerOptions } from '@shared/lib/logger.js';
import { registerInitCommand } from './commands/init.js';
import { registerStageCommands } from './commands/stage.js';
import { registerStepCommands } from './commands/step.js';
import { registerFlavorCommands } from './commands/flavor.js';
import { registerCycleCommands } from './commands/cycle.js';
import { registerKnowledgeCommands } from './commands/knowledge.js';
import { registerExecuteCommands } from './commands/execute.js';
import { registerStatusCommands } from './commands/status.js';

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
  registerStepCommands(program);
  registerFlavorCommands(program);
  registerCycleCommands(program);
  registerKnowledgeCommands(program);
  registerExecuteCommands(program);
  registerStatusCommands(program);

  return program;
}
