import type { Command } from 'commander';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { DecisionRegistry } from '@infra/registries/decision-registry.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import {
  formatStageCategoryTable,
  formatStageCategoryDetail,
  formatStageCategoryJson,
} from '@cli/formatters/stage-formatter.js';

/**
 * Register the `kata stage` / `kata gyo` commands.
 *
 * Stages are the 4 fixed macro-level work modes (research, plan, build, review).
 * Each stage has an orchestrator config, available flavors, and rules.
 * For atomic step CRUD, see `kata step` / `kata waza`.
 */
export function registerStageCommands(parent: Command): void {
  const stage = parent
    .command('stage')
    .alias('gyo')
    .description('Manage stages — the 4 fixed work modes: research, plan, build, review (alias: gyo)');

  // ---- list ----
  stage
    .command('list')
    .description('List all stage categories with flavor counts')
    .action(withCommandContext((ctx) => {
      const categories = StageCategorySchema.options;
      const flavorRegistry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));

      const entries = categories.map((cat) => {
        const flavors = flavorRegistry.list(cat);
        const rules = ruleRegistry.loadRules(cat);
        return { category: cat, flavorCount: flavors.length, ruleCount: rules.length };
      });

      if (ctx.globalOpts.json) {
        console.log(formatStageCategoryJson(entries));
      } else {
        console.log(formatStageCategoryTable(entries));
      }
    }));

  // ---- inspect <category> ----
  stage
    .command('inspect <category>')
    .description('Show stage details: flavors, rules, recent decisions')
    .action(withCommandContext((ctx, category: string) => {
      const parseResult = StageCategorySchema.safeParse(category);
      if (!parseResult.success) {
        const valid = StageCategorySchema.options.join(', ');
        console.error(`Invalid stage category: "${category}". Valid categories: ${valid}`);
        process.exitCode = 1;
        return;
      }
      const stageCategory: StageCategory = parseResult.data;
      const flavorRegistry = new FlavorRegistry(kataDirPath(ctx.kataDir, 'flavors'));
      const ruleRegistry = new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'));
      const decisionRegistry = new DecisionRegistry(kataDirPath(ctx.kataDir, 'history'));

      const flavors = flavorRegistry.list(stageCategory);
      const rules = ruleRegistry.loadRules(stageCategory);
      const decisions = decisionRegistry.list({ stageCategory });
      const recentDecisions = decisions.slice(-5);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify({
          category: stageCategory,
          flavorCount: flavors.length,
          flavors: flavors.map((f) => f.name),
          ruleCount: rules.length,
          rules: rules.map((r) => ({ name: r.name, effect: r.effect, magnitude: r.magnitude })),
          recentDecisions: recentDecisions.length,
        }, null, 2));
      } else {
        console.log(formatStageCategoryDetail({
          category: stageCategory,
          flavors,
          rules,
          recentDecisions,
        }));
      }
    }));
}
