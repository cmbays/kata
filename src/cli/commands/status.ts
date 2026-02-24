import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { listRecentArtifacts } from '@features/execute/kiai-runner.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';

// ---------------------------------------------------------------------------
// Core handlers (exported so `kata kiai status/stats` can delegate here)
// ---------------------------------------------------------------------------

export function handleStatus(ctx: { kataDir: string; globalOpts: { json?: boolean } }): void {
  const isJson = ctx.globalOpts.json;

  // Active cycle
  const cycleManager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);
  const cycles = cycleManager.list();
  const activeCycle = cycles.find((c) => c.state === 'active') ?? null;

  // Recent artifacts
  const artifacts = listRecentArtifacts(ctx.kataDir);
  const recentArtifacts = artifacts.slice(0, 5);

  // Knowledge summary
  const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
  const knowledgeStats = knowledgeStore.stats();

  if (isJson) {
    console.log(JSON.stringify({
      activeCycle: activeCycle ? { name: activeCycle.name, state: activeCycle.state, bets: activeCycle.bets.length } : null,
      recentArtifacts,
      knowledge: knowledgeStats,
    }, null, 2));
    return;
  }

  console.log('Kata Project Status');
  console.log('');

  // Cycle
  if (activeCycle) {
    console.log(`  Active cycle: ${activeCycle.name}`);
    console.log(`  Bets: ${activeCycle.bets.length}`);
  } else if (cycles.length > 0) {
    console.log(`  No active cycle (${cycles.length} total)`);
  } else {
    console.log('  No cycles created yet');
  }
  console.log('');

  // Artifacts
  if (recentArtifacts.length > 0) {
    console.log('  Recent artifacts:');
    for (const a of recentArtifacts) {
      console.log(`    ${a.name} (${a.timestamp})`);
    }
  } else {
    console.log('  No recent artifacts');
  }
  console.log('');

  // Knowledge
  if (knowledgeStats.total > 0) {
    console.log(`  Knowledge: ${knowledgeStats.total} learnings (avg confidence: ${(knowledgeStats.averageConfidence * 100).toFixed(0)}%)`);
  } else {
    console.log('  Knowledge: no learnings captured yet');
  }
}

export function handleStats(
  ctx: { kataDir: string; globalOpts: { json?: boolean } },
  categoryFilter?: StageCategory,
): void {
  const isJson = ctx.globalOpts.json;

  // Execution analytics
  const analytics = new UsageAnalytics(ctx.kataDir);
  const executionStats = analytics.getStats(categoryFilter);

  // Knowledge stats
  const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
  const knowledgeStats = knowledgeStore.stats();

  if (isJson) {
    console.log(JSON.stringify({
      execution: executionStats,
      knowledge: knowledgeStats,
    }, null, 2));
    return;
  }

  console.log(categoryFilter ? `Kata Analytics (${categoryFilter}):` : 'Kata Analytics');
  console.log('');

  // Execution
  if (executionStats.totalRuns > 0) {
    console.log('  Execution:');
    console.log(`    Total runs: ${executionStats.totalRuns}`);
    console.log(`    Avg confidence: ${(executionStats.avgConfidence * 100).toFixed(1)}%`);
    console.log('');
    console.log('    Runs by category:');
    for (const [cat, count] of Object.entries(executionStats.runsByCategory)) {
      console.log(`      ${cat}: ${count}`);
    }
    console.log('');
    console.log('    Outcomes:');
    console.log(`      good: ${executionStats.outcomeDistribution.good}`);
    console.log(`      partial: ${executionStats.outcomeDistribution.partial}`);
    console.log(`      poor: ${executionStats.outcomeDistribution.poor}`);
    console.log(`      unknown: ${executionStats.outcomeDistribution.unknown}`);
    if (executionStats.avgDurationMs !== undefined) {
      console.log(`    Avg duration: ${executionStats.avgDurationMs.toFixed(0)}ms`);
    }
  } else {
    console.log('  No execution data. Run "kata kiai <category>" to generate analytics.');
  }
  console.log('');

  // Knowledge
  if (knowledgeStats.total > 0) {
    console.log('  Knowledge:');
    console.log(`    Total learnings: ${knowledgeStats.total}`);
    console.log(`    By tier: stage=${knowledgeStats.byTier.stage}, category=${knowledgeStats.byTier.category}, agent=${knowledgeStats.byTier.agent}`);
    console.log(`    Avg confidence: ${(knowledgeStats.averageConfidence * 100).toFixed(0)}%`);
    if (knowledgeStats.topCategories.length > 0) {
      console.log('    Top categories:');
      for (const tc of knowledgeStats.topCategories.slice(0, 5)) {
        console.log(`      ${tc.category}: ${tc.count}`);
      }
    }
  } else {
    console.log('  No knowledge data. Learnings are captured from execution runs.');
  }
}

// ---------------------------------------------------------------------------
// Shared category filter parser (used by both top-level and kiai stats)
// ---------------------------------------------------------------------------

export function parseCategoryFilter(raw: string | undefined): StageCategory | undefined | false {
  if (!raw) return undefined;
  const parseResult = StageCategorySchema.safeParse(raw);
  if (!parseResult.success) {
    const valid = StageCategorySchema.options.join(', ');
    console.error(`Invalid category: "${raw}". Valid categories: ${valid}`);
    return false;
  }
  return parseResult.data;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

/**
 * Register top-level `kata status` and `kata stats` commands.
 */
export function registerStatusCommands(parent: Command): void {
  // ---- kata status ----
  parent
    .command('status')
    .description('Show project overview — active cycle, recent artifacts, knowledge summary')
    .action(withCommandContext((ctx) => {
      handleStatus(ctx);
    }));

  // ---- kata stats ----
  parent
    .command('stats')
    .description('Show aggregate analytics — execution runs, outcomes, decision quality')
    .option('--category <cat>', 'Filter stats by stage category')
    .option('--gyo <cat>', 'Filter stats by stage category (alias for --category)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const rawCategory = (localOpts.category ?? localOpts.gyo) as string | undefined;

      const categoryFilter = parseCategoryFilter(rawCategory);
      if (categoryFilter === false) { process.exitCode = 1; return; }

      handleStats(ctx, categoryFilter);
    }));
}
