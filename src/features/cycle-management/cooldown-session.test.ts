import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { createRunTree, writeStageState } from '@infra/persistence/run-store.js';
import type { Run, StageState } from '@domain/types/run-state.js';
// JsonStore satisfies IPersistence structurally — passed as persistence adapter in deps
import {
  CooldownSession,
  type CooldownSessionDeps,
  type BetOutcomeRecord,
} from './cooldown-session.js';

describe('CooldownSession', () => {
  const baseDir = join(tmpdir(), `kata-cooldown-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;
  let session: CooldownSession;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(pipelineDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });

    cycleManager = new CycleManager(cyclesDir, JsonStore);
    knowledgeStore = new KnowledgeStore(knowledgeDir);

    const deps: CooldownSessionDeps = {
      cycleManager,
      knowledgeStore,
      persistence: JsonStore,
      pipelineDir,
      historyDir,
    };

    session = new CooldownSession(deps);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('run', () => {
    it('runs full cooldown session for a simple cycle', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Simple Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Build feature A',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const result = await session.run(cycle.id);

      expect(result.report).toBeDefined();
      expect(result.report.cycleId).toBe(cycle.id);
      expect(result.proposals).toEqual([]);
      expect(result.betOutcomes).toEqual([]);

      // Cycle should be in 'complete' state
      const updatedCycle = cycleManager.get(cycle.id);
      expect(updatedCycle.state).toBe('complete');
    });

    it('records bet outcomes during cooldown', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Outcomes Cycle');
      const updatedCycle = cycleManager.addBet(cycle.id, {
        description: 'Auth system',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const betId = updatedCycle.bets[0]!.id;

      const outcomes: BetOutcomeRecord[] = [
        { betId, outcome: 'partial', notes: 'Login done, signup pending' },
      ];

      const result = await session.run(cycle.id, outcomes);

      expect(result.betOutcomes.length).toBe(1);
      expect(result.betOutcomes[0]!.outcome).toBe('partial');

      // The report should reflect the updated bet outcome
      expect(result.report.bets[0]!.outcome).toBe('partial');
      expect(result.report.bets[0]!.outcomeNotes).toBe('Login done, signup pending');

      // Proposals should include unfinished work
      expect(result.proposals.length).toBeGreaterThanOrEqual(1);
      expect(result.proposals[0]!.source).toBe('unfinished');
    });

    it('transitions through cooldown to complete state', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'State Transitions');

      expect(cycleManager.get(cycle.id).state).toBe('planning');

      await session.run(cycle.id);

      expect(cycleManager.get(cycle.id).state).toBe('complete');
    });

    it('enriches report with token usage from cycle history', async () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Token Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Feature B',
        appetite: 50,
        outcome: 'complete',
        issueRefs: [],
      });

      // Create a history entry linked to this cycle (not just global tracker)
      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 3000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 8000,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      JsonStore.write(
        join(historyDir, `${historyEntry.id}.json`),
        historyEntry,
        ExecutionHistoryEntrySchema,
      );

      const result = await session.run(cycle.id);

      // Report should have enriched token data from cycle history
      expect(result.report.tokensUsed).toBe(8000);
      expect(result.report.utilizationPercent).toBeCloseTo(8, 0);
    });

    it('captures learnings for low completion rate', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Low Completion');
      cycleManager.addBet(cycle.id, {
        description: 'Feature C',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Feature D',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const updatedCycle = cycleManager.get(cycle.id);
      const outcomes: BetOutcomeRecord[] = [
        { betId: updatedCycle.bets[0]!.id, outcome: 'abandoned', notes: 'Blocked' },
        { betId: updatedCycle.bets[1]!.id, outcome: 'abandoned', notes: 'No time' },
      ];

      const result = await session.run(cycle.id, outcomes);

      // Should capture at least one learning about low completion
      expect(result.learningsCaptured).toBeGreaterThanOrEqual(1);
    });

    it('captures learnings for over-budget usage', async () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Over Budget');
      cycleManager.addBet(cycle.id, {
        description: 'Big feature',
        appetite: 80,
        outcome: 'complete',
        issueRefs: [],
      });

      // Create history entry with token usage exceeding budget, linked to cycle
      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 8000,
          outputTokens: 7000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 15000,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      JsonStore.write(
        join(historyDir, `${historyEntry.id}.json`),
        historyEntry,
        ExecutionHistoryEntrySchema,
      );

      const result = await session.run(cycle.id);

      expect(result.report.tokensUsed).toBe(15000);
      expect(result.report.utilizationPercent).toBe(150);
      expect(result.report.alertLevel).toBe('critical');
      expect(result.learningsCaptured).toBeGreaterThanOrEqual(1);
    });

    it('rolls back cycle state when an error occurs mid-session', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Rollback Test');
      cycleManager.updateState(cycle.id, 'active');

      // Force an error after state transition to cooldown
      vi.spyOn(cycleManager, 'generateCooldown').mockImplementation(() => {
        throw new Error('Simulated failure');
      });

      await expect(session.run(cycle.id)).rejects.toThrow('Simulated failure');

      // State should be rolled back to 'active', not stuck at 'cooldown'
      expect(cycleManager.get(cycle.id).state).toBe('active');
    });

    it('handles empty cycle with no bets', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Empty Cycle');

      const result = await session.run(cycle.id);

      expect(result.report.bets).toEqual([]);
      expect(result.proposals).toEqual([]);
      expect(result.learningsCaptured).toBe(0);
    });
  });

  describe('recordBetOutcomes', () => {
    it('updates bet outcome on disk', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const updated = cycleManager.addBet(cycle.id, {
        description: 'Test bet',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });
      const betId = updated.bets[0]!.id;

      session.recordBetOutcomes(cycle.id, [
        { betId, outcome: 'complete', notes: 'All done!' },
      ]);

      const reloaded = cycleManager.get(cycle.id);
      expect(reloaded.bets[0]!.outcome).toBe('complete');
      expect(reloaded.bets[0]!.outcomeNotes).toBe('All done!');
    });

    it('handles multiple bet outcomes', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Bet 1',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });
      const c2 = cycleManager.addBet(cycle.id, {
        description: 'Bet 2',
        appetite: 15,
        outcome: 'pending',
        issueRefs: [],
      });

      session.recordBetOutcomes(cycle.id, [
        { betId: c2.bets[0]!.id, outcome: 'complete' },
        { betId: c2.bets[1]!.id, outcome: 'partial', notes: 'Half done' },
      ]);

      const reloaded = cycleManager.get(cycle.id);
      expect(reloaded.bets[0]!.outcome).toBe('complete');
      expect(reloaded.bets[1]!.outcome).toBe('partial');
      expect(reloaded.bets[1]!.outcomeNotes).toBe('Half done');
    });

    it('ignores unknown bet IDs gracefully', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, {
        description: 'Real bet',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      // Should not throw for unknown bet ID
      session.recordBetOutcomes(cycle.id, [
        { betId: 'nonexistent-id', outcome: 'complete' },
      ]);

      const reloaded = cycleManager.get(cycle.id);
      expect(reloaded.bets[0]!.outcome).toBe('pending'); // Unchanged
    });
  });

  describe('enrichReportWithTokens', () => {
    it('reports zero tokens when no cycle history exists', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Enrich Test');

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.tokensUsed).toBe(0);
      expect(enriched.utilizationPercent).toBe(0);
    });

    it('uses cycle-specific history when available', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'History Test');

      // Create a history entry for this cycle
      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 10000,
          outputTokens: 8000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 18000,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };

      const entryPath = join(historyDir, `${historyEntry.id}.json`);
      JsonStore.write(entryPath, historyEntry, ExecutionHistoryEntrySchema);

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.tokensUsed).toBe(18000);
      expect(enriched.utilizationPercent).toBe(18);
    });

    it('sets critical alert when over budget', () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Over Budget');

      const historyEntry = {
        id: crypto.randomUUID(), pipelineId: crypto.randomUUID(),
        stageType: 'build', stageIndex: 0, adapter: 'manual',
        tokenUsage: { inputTokens: 8000, outputTokens: 7000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 15000 },
        artifactNames: [], learningIds: [], cycleId: cycle.id,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('critical');
    });

    it('sets warning alert at 90%+ utilization', () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Warning Level');

      const historyEntry = {
        id: crypto.randomUUID(), pipelineId: crypto.randomUUID(),
        stageType: 'build', stageIndex: 0, adapter: 'manual',
        tokenUsage: { inputTokens: 5000, outputTokens: 4500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 9500 },
        artifactNames: [], learningIds: [], cycleId: cycle.id,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('warning');
    });

    it('sets info alert at 75%+ utilization', () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Info Level');

      const historyEntry = {
        id: crypto.randomUUID(), pipelineId: crypto.randomUUID(),
        stageType: 'build', stageIndex: 0, adapter: 'manual',
        tokenUsage: { inputTokens: 4000, outputTokens: 3800, cacheCreationTokens: 0, cacheReadTokens: 0, total: 7800 },
        artifactNames: [], learningIds: [], cycleId: cycle.id,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('info');
    });

    it('clears alert level when under 75%', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Low Usage');

      const historyEntry = {
        id: crypto.randomUUID(), pipelineId: crypto.randomUUID(),
        stageType: 'build', stageIndex: 0, adapter: 'manual',
        tokenUsage: { inputTokens: 1000, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1500 },
        artifactNames: [], learningIds: [], cycleId: cycle.id,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBeUndefined();
    });

    it('handles zero budget gracefully', () => {
      const cycle = cycleManager.create({}, 'No Budget');

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.utilizationPercent).toBe(0);
    });
  });

  describe('run with runsDir (loadRunSummaries)', () => {
    const runsDir = join(baseDir, 'runs');

    function makeRun(cycleId: string, betId: string): Run {
      return {
        id: crypto.randomUUID(),
        cycleId,
        betId,
        betPrompt: 'Test bet',
        stageSequence: ['build'],
        currentStage: null,
        status: 'completed',
        startedAt: new Date().toISOString(),
      };
    }

    function makeStageState(category: 'build', overrides: Partial<StageState> = {}): StageState {
      return {
        category,
        status: 'completed',
        selectedFlavors: [],
        gaps: [],
        decisions: [],
        approvedGates: [],
        ...overrides,
      };
    }

    beforeEach(() => {
      mkdirSync(runsDir, { recursive: true });
    });

    it('returns runSummaries when runsDir provided', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet A', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build', { status: 'completed' }));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.runSummaries).toBeDefined();
      expect(result.runSummaries).toHaveLength(1);
      expect(result.runSummaries![0]!.betId).toBe(bet.id);
      expect(result.runSummaries![0]!.runId).toBe(run.id);
      expect(result.runSummaries![0]!.stagesCompleted).toBe(1);
    });

    it('skips bets without runId silently', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, { description: 'Bet no runId', appetite: 30, outcome: 'complete', issueRefs: [] });

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.runSummaries).toBeDefined();
      expect(result.runSummaries).toHaveLength(0);
    });

    it('returns null avgConfidence when no decisions recorded', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet B', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build'));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.runSummaries![0]!.avgConfidence).toBeNull();
    });

    it('computes gapsBySeverity from stage state', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet C', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build', {
        gaps: [
          { description: 'High gap', severity: 'high' },
          { description: 'Med gap', severity: 'medium' },
          { description: 'Low gap', severity: 'low' },
        ],
      }));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      const summary = result.runSummaries![0]!;
      expect(summary.gapCount).toBe(3);
      expect(summary.gapsBySeverity).toEqual({ low: 1, medium: 1, high: 1 });
    });

    it('runSummaries is undefined when runsDir not provided (backward compat)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const result = await session.run(cycle.id);
      expect(result.runSummaries).toBeUndefined();
    });

    it('populates stageDetails from stageState.selectedFlavors and gaps', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet SD', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build', {
        selectedFlavors: ['tdd', 'review'],
        gaps: [{ description: 'Missing integration tests', severity: 'medium' }],
      }));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      const summary = result.runSummaries![0]!;
      expect(summary.stageDetails).toHaveLength(1);
      expect(summary.stageDetails[0]!.category).toBe('build');
      expect(summary.stageDetails[0]!.selectedFlavors).toEqual(['tdd', 'review']);
      expect(summary.stageDetails[0]!.gaps).toEqual([{ description: 'Missing integration tests', severity: 'medium' }]);
    });

    it('counts yoloDecisionCount from lowConfidence === true decisions', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet Yolo', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build'));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      // Write decisions.jsonl with 2 normal + 2 yolo entries
      const { JsonlStore } = await import('@infra/persistence/jsonl-store.js');
      const { DecisionEntrySchema } = await import('@domain/types/run-state.js');
      const { runPaths } = await import('@infra/persistence/run-store.js');
      const paths = runPaths(runsDir, run.id);
      const makeDecision = (lowConfidence?: boolean) => ({
        id: crypto.randomUUID(),
        stageCategory: 'build' as const,
        flavor: null,
        step: null,
        decisionType: 'flavor-selection',
        context: {},
        options: ['a', 'b'],
        selection: 'a',
        reasoning: 'test',
        confidence: lowConfidence ? 0.3 : 0.9,
        decidedAt: new Date().toISOString(),
        ...(lowConfidence ? { lowConfidence: true } : {}),
      });
      JsonlStore.append(paths.decisionsJsonl, makeDecision(), DecisionEntrySchema);
      JsonlStore.append(paths.decisionsJsonl, makeDecision(true), DecisionEntrySchema);
      JsonlStore.append(paths.decisionsJsonl, makeDecision(true), DecisionEntrySchema);
      JsonlStore.append(paths.decisionsJsonl, makeDecision(), DecisionEntrySchema);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.runSummaries![0]!.yoloDecisionCount).toBe(2);
    });

    it('sets yoloDecisionCount to 0 when no decisions recorded', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet No Yolo', appetite: 30, outcome: 'complete', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id);
      createRunTree(runsDir, run);
      writeStageState(runsDir, run.id, makeStageState('build'));
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.runSummaries![0]!.yoloDecisionCount).toBe(0);
    });
  });

  describe('run with dojoDir (diary writing)', () => {
    const dojoDir = join(baseDir, 'dojo');
    const diaryDir = join(dojoDir, 'diary');

    beforeEach(() => {
      mkdirSync(diaryDir, { recursive: true });
    });

    it('writes a diary entry when dojoDir is provided', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Diary Test Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Auth feature',
        appetite: 40,
        outcome: 'pending',
        issueRefs: [],
      });

      const updatedCycle = cycleManager.get(cycle.id);
      const outcomes: BetOutcomeRecord[] = [
        { betId: updatedCycle.bets[0]!.id, outcome: 'complete', notes: 'Shipped!' },
      ];

      const sessionWithDojo = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
      });

      const result = await sessionWithDojo.run(cycle.id, outcomes);

      // Session should complete normally
      expect(result.report).toBeDefined();
      expect(cycleManager.get(cycle.id).state).toBe('complete');

      // Diary entry should exist on disk
      const { DiaryStore } = await import('@infra/dojo/diary-store.js');
      const store = new DiaryStore(diaryDir);
      const entry = store.readByCycleId(cycle.id);
      expect(entry).not.toBeNull();
      expect(entry!.cycleId).toBe(cycle.id);
      expect(entry!.cycleName).toBe('Diary Test Cycle');
      expect(entry!.narrative).toBeTruthy();
      expect(entry!.mood).toBeDefined();
    });

    it('does not write diary when dojoDir is omitted (backward compat)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'No Diary');

      // Default session has no dojoDir
      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();

      // Diary dir should be empty (or not created)
      const { DiaryStore } = await import('@infra/dojo/diary-store.js');
      const store = new DiaryStore(diaryDir);
      expect(store.list()).toEqual([]);
    });

    it('does not abort cooldown when diary write fails', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Diary Fail');

      // Use a non-writable dojoDir path to force a write failure
      const badDojoDir = '/nonexistent/deeply/nested/invalid/path/dojo';
      const sessionWithBadDojo = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir: badDojoDir,
      });

      // Should not throw — diary failure is non-critical
      const result = await sessionWithBadDojo.run(cycle.id);
      expect(result.report).toBeDefined();
      expect(cycleManager.get(cycle.id).state).toBe('complete');
    });

    it('diary entry contains bet outcome data', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Outcomes Diary');
      cycleManager.addBet(cycle.id, {
        description: 'Feature X',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Feature Y',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const updatedCycle = cycleManager.get(cycle.id);
      const outcomes: BetOutcomeRecord[] = [
        { betId: updatedCycle.bets[0]!.id, outcome: 'complete' },
        { betId: updatedCycle.bets[1]!.id, outcome: 'abandoned', notes: 'Blocked by infra' },
      ];

      const sessionWithDojo = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
      });

      await sessionWithDojo.run(cycle.id, outcomes);

      const { DiaryStore } = await import('@infra/dojo/diary-store.js');
      const store = new DiaryStore(diaryDir);
      const entry = store.readByCycleId(cycle.id);

      // Wins should include the completed bet
      expect(entry!.wins.length).toBeGreaterThanOrEqual(1);
      // Pain points should include the abandoned bet
      expect(entry!.painPoints.length).toBeGreaterThanOrEqual(1);
      // Tags should include 'abandoned-bets'
      expect(entry!.tags).toContain('abandoned-bets');
    });
  });

  describe('run with ruleRegistry (ruleSuggestions)', () => {
    const rulesDir = join(baseDir, 'rules');

    function makeSuggestionInput() {
      return {
        suggestedRule: {
          category: 'build' as const,
          name: 'Boost TypeScript flavor',
          condition: 'When tests exist',
          effect: 'boost' as const,
          magnitude: 0.3,
          confidence: 0.8,
          source: 'auto-detected' as const,
          evidence: ['decision-abc'],
        },
        triggerDecisionIds: ['00000000-0000-4000-8000-000000000001'],
        observationCount: 3,
        reasoning: 'Observed 3 times in build stages',
      };
    }

    beforeEach(() => {
      mkdirSync(rulesDir, { recursive: true });
    });

    it('includes pending suggestions in result when ruleRegistry provided', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const sessionWithRegistry = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        ruleRegistry,
      });

      const result = await sessionWithRegistry.run(cycle.id);

      expect(result.ruleSuggestions).toBeDefined();
      expect(result.ruleSuggestions).toHaveLength(1);
      expect(result.ruleSuggestions![0]!.id).toBe(suggestion.id);
      expect(result.ruleSuggestions![0]!.status).toBe('pending');
    });

    it('returns empty array when no pending suggestions', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const sessionWithRegistry = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        ruleRegistry,
      });

      const result = await sessionWithRegistry.run(cycle.id);

      expect(result.ruleSuggestions).toBeDefined();
      expect(result.ruleSuggestions).toHaveLength(0);
    });

    it('ruleSuggestions is undefined when ruleRegistry not provided (backward compat)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const result = await session.run(cycle.id);
      expect(result.ruleSuggestions).toBeUndefined();
    });

    it('only includes pending suggestions, not accepted or rejected', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const pending = ruleRegistry.suggestRule(makeSuggestionInput());
      const toAccept = ruleRegistry.suggestRule(makeSuggestionInput());
      const toReject = ruleRegistry.suggestRule(makeSuggestionInput());

      ruleRegistry.acceptSuggestion(toAccept.id);
      ruleRegistry.rejectSuggestion(toReject.id, 'Not needed');

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const sessionWithRegistry = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        ruleRegistry,
      });

      const result = await sessionWithRegistry.run(cycle.id);

      expect(result.ruleSuggestions).toHaveLength(1);
      expect(result.ruleSuggestions![0]!.id).toBe(pending.id);
    });
  });
});
