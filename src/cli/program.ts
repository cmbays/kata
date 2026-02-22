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

  // Wire command modules
  registerInitCommand(program);
  registerStageCommands(program);
  registerPipelineCommands(program);
  registerCycleCommands(program);
  registerKnowledgeCommands(program);

  // kata kiai — Execution management (stub — Wave 3+)
  const kiai = program
    .command('kiai')
    .description('Manage execution sessions — the spirit shout of agent action');

  kiai
    .command('run <stage>')
    .description('Run a focused execution of a form')
    .option('-p, --flow <id>', 'Flow context')
    .action((stage: string) => {
      console.log(`kata kiai run ${stage} — not yet implemented`);
    });

  kiai
    .command('status')
    .description('Show current kiai session status')
    .action(() => {
      console.log('kata kiai status — not yet implemented');
    });

  return program;
}
