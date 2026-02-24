import type { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import type { LearningFilter } from '@domain/types/learning.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
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

  // kata knowledge rules — list active rules per category
  knowledge
    .command('rules')
    .description('List active stage rules')
    .option('--category <cat>', 'Filter by stage category (research, plan, build, review)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const ruleRegistry = new RuleRegistry(
        kataDirPath(ctx.kataDir, 'rules'),
      );

      // Validate category filter if provided
      let categoryFilter: StageCategory | undefined;
      if (localOpts.category) {
        const parseResult = StageCategorySchema.safeParse(localOpts.category);
        if (!parseResult.success) {
          const valid = StageCategorySchema.options.join(', ');
          console.error(`Invalid category: "${localOpts.category}". Valid categories: ${valid}`);
          process.exitCode = 1;
          return;
        }
        categoryFilter = parseResult.data;
      }

      const categories: StageCategory[] = categoryFilter
        ? [categoryFilter]
        : (['research', 'plan', 'build', 'review'] as StageCategory[]);

      const allRules = categories.flatMap((cat) => ruleRegistry.loadRules(cat));

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(allRules, null, 2));
        return;
      }

      if (allRules.length === 0) {
        console.log('No active rules found. Rules are created via "kata bunkai review" or the reflect phase.');
        return;
      }

      for (const cat of categories) {
        const catRules = allRules.filter((r) => r.category === cat);
        if (catRules.length === 0) continue;

        console.log(`${cat} (${catRules.length} rule${catRules.length > 1 ? 's' : ''}):`);
        for (const rule of catRules) {
          console.log(`  ${rule.name}`);
          console.log(`    Condition: ${rule.condition}`);
          console.log(`    Effect:    ${rule.effect} (magnitude: ${rule.magnitude.toFixed(2)})`);
          console.log(`    Confidence: ${rule.confidence.toFixed(2)}`);
          console.log(`    Source:    ${rule.source}`);
          console.log(`    ID:        ${rule.id}`);
          console.log('');
        }
      }
    }));

  // kata knowledge review — interactive learning review session
  registerLearningReviewCommand(knowledge);
}
