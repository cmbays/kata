import { join } from 'node:path';
import type { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { listRecentArtifacts } from '@features/execute/kiai-runner.js';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import {
  BELT_KANJI,
  BELT_HEADLINE,
  BELT_COLOR,
  ANSI_RESET,
  BeltLevel,
  type ProjectState,
} from '@domain/types/belt.js';
import { loadProjectState } from '@features/belt/belt-calculator.js';
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
  let knowledgeStats: ReturnType<KnowledgeStore['stats']> = { total: 0, averageConfidence: 0, byTier: { step: 0, flavor: 0, stage: 0, category: 0, agent: 0 }, topCategories: [] };
  try {
    const knowledgeStore = new KnowledgeStore(kataDirPath(ctx.kataDir, 'knowledge'));
    knowledgeStats = knowledgeStore.stats();
  } catch { /* degraded: knowledge section unavailable */ }

  // Belt / project state
  let projectState: ProjectState | null = null;
  try {
    const stateFile = join(ctx.kataDir, 'project-state.json');
    if (JsonStore.exists(stateFile)) {
      projectState = loadProjectState(stateFile);
    }
  } catch { /* degraded: belt section unavailable */ }

  if (isJson) {
    const beltJson = projectState ? {
      level: projectState.currentBelt,
      earnedAt: projectState.earnedAt ?? null,
      headline: BELT_HEADLINE[projectState.currentBelt],
      nextLevel: getNextBeltLevel(projectState.currentBelt),
    } : null;
    console.log(JSON.stringify({
      activeCycle: activeCycle ? { name: activeCycle.name, state: activeCycle.state, bets: activeCycle.bets.length } : null,
      recentArtifacts,
      knowledge: knowledgeStats,
      belt: beltJson,
    }, null, 2));
    return;
  }

  const lex = getLexicon(ctx.globalOpts.plain);
  const isPlain = !!ctx.globalOpts.plain;

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

  // Belt
  if (projectState) {
    console.log('');
    const belt = projectState.currentBelt;
    const kanji = BELT_KANJI[belt];
    const headline = BELT_HEADLINE[belt];
    if (isPlain) {
      console.log(`  Belt: ${belt} (${kanji}) — ${headline}`);
    } else {
      console.log(`  ${BELT_COLOR[belt]}◆${ANSI_RESET} ${belt} (${kanji}) — ${headline}`);
    }

    const nextLevel = getNextBeltLevel(belt);
    if (nextLevel) {
      console.log('');
      console.log(`  Next: ${nextLevel} (${BELT_KANJI[nextLevel]})`);
      const checklist = getNextBeltChecklist(belt, projectState);
      for (const item of checklist) {
        const mark = item.met ? '[✓]' : '[ ]';
        const value = item.current !== undefined ? `  (${item.current})` : '';
        console.log(`    ${mark} ${item.label}${value}`);
      }
    } else {
      console.log('  You have reached the highest rank. Your practice improves itself.');
    }
  }
}

// ---------------------------------------------------------------------------
// Belt helpers
// ---------------------------------------------------------------------------

function getNextBeltLevel(current: BeltLevel): BeltLevel | null {
  const levels = BeltLevel.options;
  const idx = levels.indexOf(current);
  if (idx < levels.length - 1) return levels[idx + 1]!;
  return null;
}

interface ChecklistItem {
  label: string;
  met: boolean;
  current?: number | string;
}

function getNextBeltChecklist(current: BeltLevel, state: ProjectState): ChecklistItem[] {
  const next = getNextBeltLevel(current);
  if (!next) return [];

  const d = state.discovery;

  switch (next) {
    case 'go-kyu':
      return [
        { label: 'Run first execution', met: d.ranFirstExecution },
        { label: 'Complete first cycle cooldown', met: d.completedFirstCycleCooldown },
        { label: 'Create a custom step or flavor', met: d.createdCustomStepOrFlavor },
        { label: 'Save a kata sequence', met: d.savedKataSequence },
      ];
    case 'yon-kyu':
      return [
        { label: '3+ cycles completed', met: false },
        { label: '6+ bets completed', met: false },
        { label: '10+ learnings captured', met: false },
        { label: '1+ constitutional learning', met: false },
        { label: 'Run with --yolo', met: state.ranWithYolo },
        { label: '5+ decision-outcome pairs', met: false },
        { label: '2+ flavors created', met: false },
        { label: '1+ dojo session generated', met: false },
      ];
    case 'san-kyu':
      return [
        { label: '6+ cycles completed', met: false },
        { label: '12+ bets completed', met: false },
        { label: '15+ learnings captured', met: false },
        { label: '1+ strategic learning', met: false },
        { label: '5+ prediction-outcome pairs', met: false },
        { label: '3+ gaps identified', met: false },
        { label: '1+ synthesis applied', met: state.synthesisAppliedCount >= 1 },
        { label: '1+ kata saved', met: false },
        { label: '3+ dojo sessions generated', met: false },
      ];
    case 'ni-kyu':
      return [
        { label: '10+ cycles completed', met: false },
        { label: '20+ bets completed', met: false },
        { label: '20+ learnings captured', met: false },
        { label: '3+ strategic learnings', met: false },
        { label: '5+ friction observations', met: false },
        { label: '60%+ friction resolution rate', met: false },
        { label: 'Cross-cycle patterns active', met: false },
        { label: '2+ avg citations per strategic', met: false },
        { label: '5+ dojo sessions generated', met: false },
      ];
    case 'ik-kyu':
      return [
        { label: '15+ cycles completed', met: false },
        { label: '30+ bets completed', met: false },
        { label: '30+ learnings captured', met: false },
        { label: '5+ strategic learnings', met: false },
        { label: '1+ user-created constitutional', met: false },
        { label: '2+ domain categories', met: false },
        { label: '2+ methodology recommendations applied', met: false },
        { label: '10+ learning versions', met: false },
        { label: '3+ avg citations per strategic', met: false },
      ];
    case 'shodan':
      return [
        { label: '25+ cycles completed', met: false },
        { label: '50+ bets completed', met: false },
        { label: '40+ learnings captured', met: false },
        { label: '8+ strategic learnings', met: false },
        { label: '80%+ calibration accuracy', met: false },
        { label: '75%+ friction resolution rate', met: false },
        { label: '10+ gaps closed', met: state.gapsClosedCount >= 10 },
        { label: '5+ avg citations per strategic', met: false },
        { label: '2+ methodology recommendations applied', met: false },
        { label: '20+ learning versions', met: false },
        { label: '10+ dojo sessions generated', met: false },
      ];
    default:
      return [];
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
  let knowledgeStats: ReturnType<KnowledgeStore['stats']> = { total: 0, averageConfidence: 0, byTier: { step: 0, flavor: 0, stage: 0, category: 0, agent: 0 }, topCategories: [] };
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
