import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { KataConfigSchema } from '@domain/types/config.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { FlavorRegistry } from '@infra/registries/flavor-registry.js';
import { DecisionRegistry } from '@infra/registries/decision-registry.js';
import { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepFlavorExecutor } from '@features/execute/step-flavor-executor.js';
import { KiaiRunner, listRecentArtifacts } from '@features/execute/kiai-runner.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';

/**
 * Register execute commands on the given parent Command.
 * kata execute run <stage-category>  — alias: kata kiai run
 * kata execute status                — alias: kata kiai status
 */
export function registerExecuteCommands(program: Command): void {
  const execute = program
    .command('execute')
    .alias('kiai')
    .description('Run stage orchestration — select and execute flavors (alias: kiai)');

  execute
    .command('run <stage-category>')
    .description('Run a stage orchestration for the given category (research, plan, build, review)')
    .option('--bet <json>', 'Inline JSON for bet context')
    .option('--pin <flavor>', 'Pin a specific flavor (can be repeated)', collect, [])
    .option('--dry-run', 'Print selected flavors without executing')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx, category: string) => {
      const localOpts = ctx.cmd.opts();

      // Validate stage category
      const parseResult = StageCategorySchema.safeParse(category);
      if (!parseResult.success) {
        const valid = StageCategorySchema.options.join(', ');
        console.error(`Invalid stage category: "${category}". Valid categories: ${valid}`);
        process.exitCode = 1;
        return;
      }
      const stageCategory: StageCategory = parseResult.data;

      // Load config
      const configPath = kataDirPath(ctx.kataDir, 'config');
      const config = JsonStore.exists(configPath)
        ? JsonStore.read(configPath, KataConfigSchema)
        : undefined;

      // Initialize registries and services
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
      const stepRegistry = new StepRegistry(stagesDir);
      const flavorRegistry = new FlavorRegistry(flavorsDir);
      const decisionRegistry = new DecisionRegistry(
        kataDirPath(ctx.kataDir, 'history'),
      );

      // Create executor
      const executor = new StepFlavorExecutor({
        stepRegistry,
        adapterResolver: AdapterResolver,
        config: config ?? KataConfigSchema.parse({
          methodology: 'shape-up',
          execution: { adapter: 'manual', config: {} },
          customStagePaths: [],
          project: {},
        }),
      });

      // Create analytics and runner
      const analytics = new UsageAnalytics(ctx.kataDir);
      const runner = new KiaiRunner({
        flavorRegistry,
        decisionRegistry,
        executor,
        kataDir: ctx.kataDir,
        analytics,
      });

      // Parse bet option
      let bet: Record<string, unknown> | undefined;
      if (localOpts.bet) {
        try {
          const parsed = JSON.parse(localOpts.bet);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            console.error('Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')');
            process.exitCode = 1;
            return;
          }
          bet = parsed as Record<string, unknown>;
        } catch {
          console.error('Error: --bet must be valid JSON');
          process.exitCode = 1;
          return;
        }
      }

      // Run
      const result = await runner.runStage(stageCategory, {
        bet,
        pin: localOpts.pin?.length > 0 ? localOpts.pin : undefined,
        dryRun: localOpts.dryRun,
      });

      // Output
      if (ctx.globalOpts.json || localOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Stage: ${result.stageCategory}`);
        console.log(`Execution mode: ${result.executionMode}`);
        console.log(`Selected flavors: ${result.selectedFlavors.join(', ')}`);
        console.log('');
        console.log('Decisions:');
        for (const decision of result.decisions) {
          console.log(`  ${decision.decisionType}: ${decision.selection} (confidence: ${(decision.confidence * 100).toFixed(0)}%)`);
        }
        console.log('');
        console.log(`Stage artifact: ${result.stageArtifact.name}`);
        if (localOpts.dryRun) {
          console.log('');
          console.log('(dry-run — no artifacts persisted)');
        }
      }
    }));

  execute
    .command('status')
    .description('Show recent stage execution artifacts')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();
      const artifacts = listRecentArtifacts(ctx.kataDir);

      if (ctx.globalOpts.json || localOpts.json) {
        console.log(JSON.stringify(artifacts, null, 2));
      } else if (artifacts.length === 0) {
        console.log('No stage artifacts found. Run "kata kiai run <category>" to execute a stage.');
      } else {
        console.log('Recent stage artifacts:');
        console.log('');
        for (const artifact of artifacts) {
          console.log(`  ${artifact.name}`);
          console.log(`    Time: ${artifact.timestamp}`);
          console.log(`    File: ${artifact.file}`);
          console.log('');
        }
      }
    }));
  execute
    .command('pipeline <categories...>')
    .description('Run a multi-stage pipeline (e.g., research plan build review)')
    .option('--bet <json>', 'Inline JSON for bet context')
    .option('--dry-run', 'Print results without persisting artifacts')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx, cats: string[]) => {
      const localOpts = ctx.cmd.opts();

      // Validate all stage categories
      const categories: StageCategory[] = [];
      for (const cat of cats) {
        const parseResult = StageCategorySchema.safeParse(cat);
        if (!parseResult.success) {
          const valid = StageCategorySchema.options.join(', ');
          console.error(`Invalid stage category: "${cat}". Valid categories: ${valid}`);
          process.exitCode = 1;
          return;
        }
        categories.push(parseResult.data);
      }

      // Load config
      const configPath = kataDirPath(ctx.kataDir, 'config');
      const config = JsonStore.exists(configPath)
        ? JsonStore.read(configPath, KataConfigSchema)
        : undefined;

      // Initialize registries and services
      const stagesDir = kataDirPath(ctx.kataDir, 'stages');
      const flavorsDir = kataDirPath(ctx.kataDir, 'flavors');
      const stepRegistry = new StepRegistry(stagesDir);
      const flavorRegistry = new FlavorRegistry(flavorsDir);
      const decisionRegistry = new DecisionRegistry(
        kataDirPath(ctx.kataDir, 'history'),
      );

      const executor = new StepFlavorExecutor({
        stepRegistry,
        adapterResolver: AdapterResolver,
        config: config ?? KataConfigSchema.parse({
          methodology: 'shape-up',
          execution: { adapter: 'manual', config: {} },
          customStagePaths: [],
          project: {},
        }),
      });

      const analytics = new UsageAnalytics(ctx.kataDir);
      const runner = new KiaiRunner({
        flavorRegistry,
        decisionRegistry,
        executor,
        kataDir: ctx.kataDir,
        analytics,
      });

      // Parse bet option
      let bet: Record<string, unknown> | undefined;
      if (localOpts.bet) {
        try {
          const parsed = JSON.parse(localOpts.bet);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            console.error('Error: --bet must be a JSON object');
            process.exitCode = 1;
            return;
          }
          bet = parsed as Record<string, unknown>;
        } catch {
          console.error('Error: --bet must be valid JSON');
          process.exitCode = 1;
          return;
        }
      }

      const result = await runner.runPipeline(categories, { bet, dryRun: localOpts.dryRun });

      if (ctx.globalOpts.json || localOpts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Pipeline: ${categories.join(' -> ')}`);
        console.log(`Stages completed: ${result.stageResults.length}`);
        console.log(`Overall quality: ${result.pipelineReflection.overallQuality}`);
        console.log('');
        for (const stageResult of result.stageResults) {
          console.log(`  ${stageResult.stageCategory}:`);
          console.log(`    Flavors: ${stageResult.selectedFlavors.join(', ')}`);
          console.log(`    Mode: ${stageResult.executionMode}`);
          console.log(`    Artifact: ${stageResult.stageArtifact.name}`);
        }
        console.log('');
        console.log('Learnings:');
        for (const learning of result.pipelineReflection.learnings) {
          console.log(`  - ${learning}`);
        }
        if (localOpts.dryRun) {
          console.log('');
          console.log('(dry-run — no artifacts persisted)');
        }
      }
    }));

  execute
    .command('stats')
    .description('Show analytics for stage orchestration runs')
    .option('--category <cat>', 'Filter stats by stage category')
    .option('--json', 'Output results as JSON')
    .action(withCommandContext(async (ctx) => {
      const localOpts = ctx.cmd.opts();

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

      const analytics = new UsageAnalytics(ctx.kataDir);
      const stats = analytics.getStats(categoryFilter);

      if (ctx.globalOpts.json || localOpts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else if (stats.totalRuns === 0) {
        console.log('No analytics events recorded yet. Run "kata kiai run <category>" to generate data.');
      } else {
        console.log(categoryFilter ? `Analytics for "${categoryFilter}":` : 'Analytics overview:');
        console.log('');
        console.log(`  Total runs: ${stats.totalRuns}`);
        console.log('');
        console.log('  Runs by category:');
        for (const [cat, count] of Object.entries(stats.runsByCategory)) {
          console.log(`    ${cat}: ${count}`);
        }
        console.log('');
        console.log(`  Avg confidence: ${(stats.avgConfidence * 100).toFixed(1)}%`);
        console.log('');
        console.log('  Outcome distribution:');
        console.log(`    good: ${stats.outcomeDistribution.good}`);
        console.log(`    partial: ${stats.outcomeDistribution.partial}`);
        console.log(`    poor: ${stats.outcomeDistribution.poor}`);
        console.log(`    unknown: ${stats.outcomeDistribution.unknown}`);
        if (stats.avgDurationMs !== undefined) {
          console.log('');
          console.log(`  Avg duration: ${stats.avgDurationMs.toFixed(0)}ms`);
        }
      }
    }));
}

/**
 * Commander collect helper for repeatable --pin options.
 */
function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}
