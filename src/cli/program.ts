import { Command } from 'commander';
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

  // Wire Wave 2 command modules
  registerInitCommand(program);
  registerStageCommands(program);
  registerPipelineCommands(program);
  registerCycleCommands(program);
  registerKnowledgeCommands(program);

  // kata focus — Execution management (stub — Wave 3+)
  const focus = program
    .command('focus')
    .description('Manage focused execution sessions');

  focus
    .command('run <stage>')
    .description('Run a focused execution of a stage')
    .option('-p, --pipeline <id>', 'Pipeline context')
    .action((stage: string) => {
      console.log(`kata focus run ${stage} — not yet implemented`);
    });

  focus
    .command('status')
    .description('Show current focus session status')
    .action(() => {
      console.log('kata focus status — not yet implemented');
    });

  return program;
}
