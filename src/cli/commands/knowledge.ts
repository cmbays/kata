import type { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { LearningFilter } from '@domain/types/learning.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  formatLearningTable,
  formatKnowledgeStats,
  formatLearningJson,
  formatKnowledgeStatsJson,
} from '@cli/formatters/knowledge-formatter.js';
import { registerLearningReviewCommand } from './learning-review.js';

/**
 * Register the `kata knowledge` subcommands.
 */
export function registerKnowledgeCommands(parent: Command): void {
  const knowledge = parent
    .command('knowledge')
    .alias('bunkai')
    .description('Manage knowledge — patterns extracted from practice (alias: bunkai)');

  // kata knowledge query
  knowledge
    .command('query')
    .description('Query learnings by filters')
    .option('--stage <type>', 'Filter by stage type')
    .option('--tier <tier>', 'Filter by tier (stage, category, agent)')
    .option('--category <cat>', 'Filter by category')
    .option('--min-confidence <n>', 'Minimum confidence score', parseFloat)
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const store = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));

      const filter: LearningFilter = {};
      if (localOpts.stage) filter.stageType = localOpts.stage;
      if (localOpts.tier) filter.tier = localOpts.tier;
      if (localOpts.category) filter.category = localOpts.category;
      if (localOpts.minConfidence !== undefined) filter.minConfidence = localOpts.minConfidence;

      const learnings = store.query(filter);

      if (ctx.globalOpts.json) {
        console.log(formatLearningJson(learnings));
      } else {
        console.log(formatLearningTable(learnings));
      }
    }));

  // kata knowledge stats
  knowledge
    .command('stats')
    .description('Show knowledge store statistics')
    .action(withCommandContext((ctx) => {
      const store = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
      const stats = store.stats();

      if (ctx.globalOpts.json) {
        console.log(formatKnowledgeStatsJson(stats));
      } else {
        console.log(formatKnowledgeStats(stats));
      }
    }));

  // kata knowledge review — interactive learning review session
  registerLearningReviewCommand(knowledge);
}
