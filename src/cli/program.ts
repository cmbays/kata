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
import { registerArtifactCommands } from './commands/artifact.js';
import { registerDecisionCommands } from './commands/decision.js';
import { registerRunCommands } from './commands/run.js';
import { registerApproveCommand } from './commands/approve.js';
import { registerGateCommands } from './commands/gate.js';
import { registerRuleCommands } from './commands/rules.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerConfigCommand } from './commands/config.js';
import { registerDojoCommand } from './commands/dojo.js';
import { registerObserveCommands } from './commands/observe.js';
import { registerAgentCommands } from './commands/agent.js';
import { registerLexiconCommand } from './commands/lexicon.js';

const VERSION = '0.1.0';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('kata')
    .description('Development Methodology Engine — encode, compose, and improve development workflows')
    .version(VERSION)
    .option('--json', 'Output in JSON format')
    .option('--verbose', 'Enable verbose logging')
    .option('--plain', 'Use plain English output instead of thematic vocabulary (also: KATA_PLAIN=1)')
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
  registerArtifactCommands(program);
  registerDecisionCommands(program);
  registerRunCommands(program);
  registerApproveCommand(program);
  registerGateCommands(program);
  registerRuleCommands(program);
  registerWatchCommand(program);
  registerConfigCommand(program);
  registerDojoCommand(program);
  registerObserveCommands(program);
  registerAgentCommands(program);
  registerLexiconCommand(program);

  program.addHelpText('after', `
Vocabulary (kotoba):
  Domain terms use English as primary CLI names with Japanese karate aliases.
  Run "kata lexicon" (or "kata kotoba") for the full vocabulary table.`);

  return program;
}
