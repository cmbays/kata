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
import { BeltCalculator, type BeltSnapshot, loadProjectState } from '@features/belt/belt-calculator.js';
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
  let beltSnapshot: BeltSnapshot | null = null;
  try {
    const stateFile = join(ctx.kataDir, 'project-state.json');
    if (JsonStore.exists(stateFile)) {
      projectState = loadProjectState(stateFile);
    }
    const calc = new BeltCalculator({
      cyclesDir: kataDirPath(ctx.kataDir, 'cycles'),
      knowledgeDir: kataDirPath(ctx.kataDir, 'knowledge'),
      runsDir: kataDirPath(ctx.kataDir, 'runs'),
      flavorsDir: kataDirPath(ctx.kataDir, 'flavors'),
      savedKataDir: kataDirPath(ctx.kataDir, 'katas'),
      synthesisDir: join(ctx.kataDir, 'synthesis'),
      dojoSessionsDir: join(kataDirPath(ctx.kataDir, 'dojo'), 'sessions'),
    });
    beltSnapshot = calc.computeSnapshot();
    if (projectState && beltSnapshot) {
      // Overlay persistent counters onto live snapshot
      beltSnapshot.gapsClosed = projectState.gapsClosedCount;
      beltSnapshot.ranWithYolo = projectState.ranWithYolo;
      beltSnapshot.discovery = projectState.discovery;
      beltSnapshot.synthesisApplied = Math.max(beltSnapshot.synthesisApplied, projectState.synthesisAppliedCount);
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
      const checklist = getNextBeltChecklist(belt, projectState, beltSnapshot);
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

function getNextBeltChecklist(current: BeltLevel, state: ProjectState, snap: BeltSnapshot | null): ChecklistItem[] {
  const next = getNextBeltLevel(current);
  if (!next) return [];

  const d = state.discovery;
  const s = snap;

  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

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
        { label: '3+ cycles completed', met: (s?.cyclesCompleted ?? 0) >= 3, current: s?.cyclesCompleted },
        { label: '6+ bets completed', met: (s?.betsCompleted ?? 0) >= 6, current: s?.betsCompleted },
        { label: '10+ learnings captured', met: (s?.learningsTotal ?? 0) >= 10, current: s?.learningsTotal },
        { label: '1+ constitutional learning', met: (s?.constitutionalLearnings ?? 0) >= 1, current: s?.constitutionalLearnings },
        { label: 'Run with --yolo', met: state.ranWithYolo },
        { label: '5+ decision-outcome pairs', met: (s?.decisionOutcomePairs ?? 0) >= 5, current: s?.decisionOutcomePairs },
        { label: '2+ flavors created', met: (s?.flavorsTotal ?? 0) >= 2, current: s?.flavorsTotal },
        { label: '1+ dojo session generated', met: (s?.dojoSessionsGenerated ?? 0) >= 1, current: s?.dojoSessionsGenerated },
      ];
    case 'san-kyu':
      return [
        { label: '6+ cycles completed', met: (s?.cyclesCompleted ?? 0) >= 6, current: s?.cyclesCompleted },
        { label: '12+ bets completed', met: (s?.betsCompleted ?? 0) >= 12, current: s?.betsCompleted },
        { label: '15+ learnings captured', met: (s?.learningsTotal ?? 0) >= 15, current: s?.learningsTotal },
        { label: '1+ strategic learning', met: (s?.strategicLearnings ?? 0) >= 1, current: s?.strategicLearnings },
        { label: '5+ prediction-outcome pairs', met: (s?.predictionOutcomePairs ?? 0) >= 5, current: s?.predictionOutcomePairs },
        { label: '3+ gaps identified', met: (s?.gapsIdentified ?? 0) >= 3, current: s?.gapsIdentified },
        { label: '1+ synthesis applied', met: (s?.synthesisApplied ?? state.synthesisAppliedCount) >= 1 },
        { label: '1+ kata saved', met: (s?.katasSaved ?? 0) >= 1, current: s?.katasSaved },
        { label: '3+ dojo sessions generated', met: (s?.dojoSessionsGenerated ?? 0) >= 3, current: s?.dojoSessionsGenerated },
      ];
    case 'ni-kyu':
      return [
        { label: '10+ cycles completed', met: (s?.cyclesCompleted ?? 0) >= 10, current: s?.cyclesCompleted },
        { label: '20+ bets completed', met: (s?.betsCompleted ?? 0) >= 20, current: s?.betsCompleted },
        { label: '20+ learnings captured', met: (s?.learningsTotal ?? 0) >= 20, current: s?.learningsTotal },
        { label: '3+ strategic learnings', met: (s?.strategicLearnings ?? 0) >= 3, current: s?.strategicLearnings },
        { label: '5+ friction observations', met: (s?.frictionObservations ?? 0) >= 5, current: s?.frictionObservations },
        { label: '60%+ friction resolution rate', met: (s?.frictionResolutionRate ?? 0) >= 0.6, current: s ? pct(s.frictionResolutionRate) : undefined },
        { label: 'Cross-cycle patterns active', met: s?.crossCyclePatternsActive ?? false },
        { label: '2+ avg citations per strategic', met: (s?.avgCitationsPerStrategic ?? 0) >= 2, current: s ? s.avgCitationsPerStrategic.toFixed(1) : undefined },
        { label: '5+ dojo sessions generated', met: (s?.dojoSessionsGenerated ?? 0) >= 5, current: s?.dojoSessionsGenerated },
      ];
    case 'ik-kyu':
      return [
        { label: '15+ cycles completed', met: (s?.cyclesCompleted ?? 0) >= 15, current: s?.cyclesCompleted },
        { label: '30+ bets completed', met: (s?.betsCompleted ?? 0) >= 30, current: s?.betsCompleted },
        { label: '30+ learnings captured', met: (s?.learningsTotal ?? 0) >= 30, current: s?.learningsTotal },
        { label: '5+ strategic learnings', met: (s?.strategicLearnings ?? 0) >= 5, current: s?.strategicLearnings },
        { label: '1+ user-created constitutional', met: (s?.userCreatedConstitutional ?? 0) >= 1, current: s?.userCreatedConstitutional },
        { label: '2+ domain categories', met: (s?.domainCategoryCount ?? 0) >= 2, current: s?.domainCategoryCount },
        { label: '2+ methodology recommendations applied', met: (s?.methodologyRecommendationsApplied ?? 0) >= 2, current: s?.methodologyRecommendationsApplied },
        { label: '10+ learning versions', met: (s?.learningVersionCount ?? 0) >= 10, current: s?.learningVersionCount },
        { label: '3+ avg citations per strategic', met: (s?.avgCitationsPerStrategic ?? 0) >= 3, current: s ? s.avgCitationsPerStrategic.toFixed(1) : undefined },
      ];
    case 'shodan':
      return [
        { label: '25+ cycles completed', met: (s?.cyclesCompleted ?? 0) >= 25, current: s?.cyclesCompleted },
        { label: '50+ bets completed', met: (s?.betsCompleted ?? 0) >= 50, current: s?.betsCompleted },
        { label: '40+ learnings captured', met: (s?.learningsTotal ?? 0) >= 40, current: s?.learningsTotal },
        { label: '8+ strategic learnings', met: (s?.strategicLearnings ?? 0) >= 8, current: s?.strategicLearnings },
        { label: '80%+ calibration accuracy', met: (s?.calibrationAccuracy ?? 0) >= 0.8, current: s ? pct(s.calibrationAccuracy) : undefined },
        { label: '75%+ friction resolution rate', met: (s?.frictionResolutionRate ?? 0) >= 0.75, current: s ? pct(s.frictionResolutionRate) : undefined },
        { label: '10+ gaps closed', met: state.gapsClosedCount >= 10, current: state.gapsClosedCount },
        { label: '5+ avg citations per strategic', met: (s?.avgCitationsPerStrategic ?? 0) >= 5, current: s ? s.avgCitationsPerStrategic.toFixed(1) : undefined },
        { label: '2+ methodology recommendations applied', met: (s?.methodologyRecommendationsApplied ?? 0) >= 2, current: s?.methodologyRecommendationsApplied },
        { label: '20+ learning versions', met: (s?.learningVersionCount ?? 0) >= 20, current: s?.learningVersionCount },
        { label: '10+ dojo sessions generated', met: (s?.dojoSessionsGenerated ?? 0) >= 10, current: s?.dojoSessionsGenerated },
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
