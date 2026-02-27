import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { listRecentArtifacts } from '@features/execute/kiai-runner.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { getLexicon, cap } from '@cli/lexicon.js';

// ---------------------------------------------------------------------------
// Core handlers (exported so `kata kiai status/stats` can delegate here)
// ---------------------------------------------------------------------------

export function handleStatus(ctx: { kataDir: string; globalOpts: { json?: boolean; plain?: boolean } }): void {
  const isJson = ctx.globalOpts.json;

  // Active cycle
  let cycles: ReturnType<CycleManager['list']> = [];
  let activeCycle: (typeof cycles)[number] | null = null;
  try {
    const cycleManager = new CycleManager(kataDirPath(ctx.kataDir, 'cycles'), JsonStore);
    cycles = cycleManager.list();
    activeCycle = cycles.find((c) => c.state === 'active') ?? null;
  } catch { /* degraded: cycles section unavailable */ }

  // Recent artifacts
  let recentArtifacts: ReturnType<typeof listRecentArtifacts> = [];
  try {
    recentArtifacts = listRecentArtifacts(ctx.kataDir).slice(0, 5);
  } catch { /* degraded: artifacts section unavailable */ }

  // Knowledge summary
  let knowledgeStats: ReturnType<KnowledgeStore['stats']> = { total: 0, averageConfidence: 0, byTier: { stage: 0, category: 0, agent: 0 }, topCategories: [] };
  try {
    const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
    knowledgeStats = knowledgeStore.stats();
  } catch { /* degraded: knowledge section unavailable */ }

  if (isJson) {
    console.log(JSON.stringify({
      activeCycle: activeCycle ? { name: activeCycle.name, state: activeCycle.state, bets: activeCycle.bets.length } : null,
      recentArtifacts,
      knowledge: knowledgeStats,
    }, null, 2));
    return;
  }

  const lex = getLexicon(ctx.globalOpts.plain);

  console.log('Kata Project Status');
  console.log('');

  // Cycle
  if (activeCycle) {
    console.log(`  Active ${lex.cycle}: ${activeCycle.name}`);
    console.log(`  Bets: ${activeCycle.bets.length}`);
  } else if (cycles.length > 0) {
    console.log(`  No active ${lex.cycle} (${cycles.length} total)`);
  } else {
    console.log(`  No ${lex.cycle} created yet`);
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
    console.log(`  ${cap(lex.knowledge)}: ${knowledgeStats.total} learnings (avg confidence: ${(knowledgeStats.averageConfidence * 100).toFixed(0)}%)`);
  } else {
    console.log(`  ${cap(lex.knowledge)}: no learnings captured yet`);
  }
}

export function handleStats(
  ctx: { kataDir: string; globalOpts: { json?: boolean; plain?: boolean } },
  categoryFilter?: StageCategory,
): void {
  const isJson = ctx.globalOpts.json;
  const lex = getLexicon(ctx.globalOpts.plain);

  // Execution analytics
  let executionStats: ReturnType<UsageAnalytics['getStats']> = {
    totalRuns: 0,
    runsByCategory: {},
    avgConfidence: 0,
    outcomeDistribution: { good: 0, partial: 0, poor: 0, unknown: 0 },
    avgDurationMs: undefined,
  };
  try {
    const analytics = new UsageAnalytics(ctx.kataDir);
    executionStats = analytics.getStats(categoryFilter);
  } catch { /* degraded: analytics section unavailable */ }

  // Knowledge stats
  let knowledgeStats: ReturnType<KnowledgeStore['stats']> = { total: 0, averageConfidence: 0, byTier: { stage: 0, category: 0, agent: 0 }, topCategories: [] };
  try {
    const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
    knowledgeStats = knowledgeStore.stats();
  } catch { /* degraded: knowledge section unavailable */ }

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
    console.log(`  No execution data. Run "kata ${lex.execute} <category>" to generate analytics.`);
  }
  console.log('');

  // Knowledge
  if (knowledgeStats.total > 0) {
    console.log(`  ${cap(lex.knowledge)}:`);
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
    console.log(`  No ${lex.knowledge} data. Learnings are captured from execution runs.`);
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
    .option('--json', 'Output as JSON')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts() as { json?: boolean };
      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      handleStatus({ kataDir: ctx.kataDir, globalOpts: { ...ctx.globalOpts, json: isJson } });
    }));

  // ---- kata stats ----
  parent
    .command('stats')
    .description('Show aggregate analytics — execution runs, outcomes, decision quality')
    .option('--json', 'Output as JSON')
    .option('--category <cat>', 'Filter stats by stage category')
    .option('--gyo <cat>', 'Filter stats by stage category (alias for --category)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts() as { json?: boolean; category?: string; gyo?: string };
      const rawCategory = (localOpts.category ?? localOpts.gyo) as string | undefined;

      const categoryFilter = parseCategoryFilter(rawCategory);
      if (categoryFilter === false) { process.exitCode = 1; return; }

      const isJson = !!(localOpts.json || ctx.globalOpts.json);
      handleStats({ kataDir: ctx.kataDir, globalOpts: { ...ctx.globalOpts, json: isJson } }, categoryFilter);
    }));
}
