import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { TokenTracker } from '@infra/tracking/token-tracker.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  CooldownSession,
  type CooldownSessionDeps,
  type BetOutcomeRecord,
} from './cooldown-session.js';

describe('CooldownSession', () => {
  const baseDir = join(tmpdir(), `kata-cooldown-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const trackingDir = join(baseDir, 'tracking');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;
  let tokenTracker: TokenTracker;
  let session: CooldownSession;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(trackingDir, { recursive: true });
    mkdirSync(pipelineDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });

    cycleManager = new CycleManager(cyclesDir);
    knowledgeStore = new KnowledgeStore(knowledgeDir);
    tokenTracker = new TokenTracker(trackingDir);

    const deps: CooldownSessionDeps = {
      cycleManager,
      knowledgeStore,
      tokenTracker,
      cyclesDir,
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

    it('enriches report with token usage', async () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Token Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Feature B',
        appetite: 50,
        outcome: 'complete',
        issueRefs: [],
      });

      // Record some token usage
      tokenTracker.recordUsage('stage-1', {
        inputTokens: 5000,
        outputTokens: 3000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 8000,
      });

      const result = await session.run(cycle.id);

      // Report should have enriched token data
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

      // Record token usage exceeding budget
      tokenTracker.recordUsage('stage-big', {
        inputTokens: 8000,
        outputTokens: 7000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 15000,
      });

      const result = await session.run(cycle.id);

      expect(result.report.tokensUsed).toBe(15000);
      expect(result.report.utilizationPercent).toBe(150);
      expect(result.report.alertLevel).toBe('critical');
      expect(result.learningsCaptured).toBeGreaterThanOrEqual(1);
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
    it('uses tracker total when no cycle history exists', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Enrich Test');

      tokenTracker.recordUsage('some-stage', {
        inputTokens: 3000,
        outputTokens: 2000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 5000,
      });

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.tokensUsed).toBe(5000);
      expect(enriched.utilizationPercent).toBe(5);
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

      tokenTracker.recordUsage('big-stage', {
        inputTokens: 8000,
        outputTokens: 7000,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 15000,
      });

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('critical');
    });

    it('sets warning alert at 90%+ utilization', () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Warning Level');

      tokenTracker.recordUsage('stage-a', {
        inputTokens: 5000,
        outputTokens: 4500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 9500,
      });

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('warning');
    });

    it('sets info alert at 75%+ utilization', () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Info Level');

      tokenTracker.recordUsage('stage-b', {
        inputTokens: 4000,
        outputTokens: 3800,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 7800,
      });

      const baseReport = cycleManager.generateCooldown(cycle.id);
      const enriched = session.enrichReportWithTokens(baseReport, cycle.id);

      expect(enriched.alertLevel).toBe('info');
    });

    it('clears alert level when under 75%', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Low Usage');

      tokenTracker.recordUsage('stage-c', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        total: 1500,
      });

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
});
