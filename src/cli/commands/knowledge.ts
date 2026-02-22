import { join } from 'node:path';
import type { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { LearningFilter } from '@domain/types/learning.js';
import { resolveKataDir, getGlobalOptions } from '@cli/utils.js';
import {
  formatLearningTable,
  formatKnowledgeStats,
  formatLearningJson,
  formatKnowledgeStatsJson,
} from '@cli/formatters/knowledge-formatter.js';
import { registerLearningReviewCommand } from './learning-review.js';

/**
 * Register the `kata bunkai` subcommands — the breakdown and analysis.
 */
export function registerKnowledgeCommands(parent: Command): void {
  const bunkai = parent
    .command('bunkai')
    .description('Manage bunkai (breakdowns) — patterns extracted from practice');

  // kata bunkai query
  bunkai
    .command('query')
    .description('Query learnings by filters')
    .option('--stage <type>', 'Filter by stage type')
    .option('--tier <tier>', 'Filter by tier (stage, category, agent)')
    .option('--category <cat>', 'Filter by category')
    .option('--min-confidence <n>', 'Minimum confidence score', parseFloat)
    .action((_opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);
      const localOpts = cmd.opts();

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const store = new KnowledgeStore(join(kataDir, 'knowledge'));

        const filter: LearningFilter = {};
        if (localOpts.stage) filter.stageType = localOpts.stage;
        if (localOpts.tier) filter.tier = localOpts.tier;
        if (localOpts.category) filter.category = localOpts.category;
        if (localOpts.minConfidence !== undefined) filter.minConfidence = localOpts.minConfidence;

        const learnings = store.query(filter);

        if (globalOpts.json) {
          console.log(formatLearningJson(learnings));
        } else {
          console.log(formatLearningTable(learnings));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  // kata bunkai stats
  bunkai
    .command('stats')
    .description('Show knowledge store statistics')
    .action((_opts, cmd) => {
      const globalOpts = getGlobalOptions(cmd);

      try {
        const kataDir = resolveKataDir(globalOpts.cwd);
        const store = new KnowledgeStore(join(kataDir, 'knowledge'));
        const stats = store.stats();

        if (globalOpts.json) {
          console.log(formatKnowledgeStatsJson(stats));
        } else {
          console.log(formatKnowledgeStats(stats));
        }
      } catch (error) {
        console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    });

  // kata bunkai review — interactive learning review session
  registerLearningReviewCommand(bunkai);
}
