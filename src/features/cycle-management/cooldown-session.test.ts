import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { createRunTree, writeRun, writeStageState } from '@infra/persistence/run-store.js';
import type { Run, StageState } from '@domain/types/run-state.js';
import { logger } from '@shared/lib/logger.js';
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

    it('logs expiry-check summaries when archived or stale learnings are found', async () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const checkExpiry = vi.spyOn(knowledgeStore, 'checkExpiry').mockReturnValue({
        archived: [{ id: 'archived-learning' }],
        flaggedStale: [{ id: 'stale-learning' }],
      } as ReturnType<typeof knowledgeStore.checkExpiry>);
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Expiry Check Cycle');

      await session.run(cycle.id);

      expect(checkExpiry).toHaveBeenCalledTimes(1);
      expect(debugSpy).toHaveBeenCalledWith('Expiry check: auto-archived 1 expired operational learnings');
      expect(debugSpy).toHaveBeenCalledWith('Expiry check: flagged 1 stale strategic learnings for review');
    });

    it('does not log expiry-check summaries when nothing was archived or flagged', async () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const checkExpiry = vi.spyOn(knowledgeStore, 'checkExpiry').mockReturnValue({
        archived: [],
        flaggedStale: [],
      } as ReturnType<typeof knowledgeStore.checkExpiry>);
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Quiet Expiry Check');

      try {
        await session.run(cycle.id);

        expect(checkExpiry).toHaveBeenCalledTimes(1);
        expect(debugSpy).not.toHaveBeenCalledWith('Expiry check: auto-archived 0 expired operational learnings');
        expect(debugSpy).not.toHaveBeenCalledWith('Expiry check: flagged 0 stale strategic learnings for review');
      } finally {
        debugSpy.mockRestore();
      }
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

    it('does not capture a low-completion learning at exactly 50% completion', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Boundary Completion');
      cycleManager.addBet(cycle.id, {
        description: 'Bet 1',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const updatedCycle = cycleManager.addBet(cycle.id, {
        description: 'Bet 2',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const result = await session.run(cycle.id, [
        { betId: updatedCycle.bets[0]!.id, outcome: 'complete' },
        { betId: updatedCycle.bets[1]!.id, outcome: 'abandoned' },
      ]);

      expect(result.report.completionRate).toBe(50);
      const learnings = knowledgeStore.query({});
      expect(
        learnings.some((learning) => learning.content.includes('Boundary Completion') && learning.content.includes('low completion rate')),
      ).toBe(false);
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

    it('warns when some cooldown learnings fail to capture', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Partial Learning Failure');
      cycleManager.addBet(cycle.id, {
        description: 'Bet 1',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const updatedCycle = cycleManager.addBet(cycle.id, {
        description: 'Bet 2',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const originalCapture = knowledgeStore.capture.bind(knowledgeStore);
      vi.spyOn(knowledgeStore, 'capture')
        .mockImplementationOnce(() => {
          throw new Error('capture exploded');
        })
        .mockImplementation((params) => {
          originalCapture(params);
        });

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

      const result = await session.run(cycle.id, [
        { betId: updatedCycle.bets[0]!.id, outcome: 'abandoned' },
        { betId: updatedCycle.bets[1]!.id, outcome: 'abandoned' },
      ]);

      expect(result.learningsCaptured).toBe(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to capture cooldown learning: capture exploded'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('1 of 2 cooldown learnings failed to capture'));
    });

    it('does not capture an over-budget learning at exactly 100% utilization', async () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Exact Budget');
      cycleManager.addBet(cycle.id, {
        description: 'Exact budget bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 6000,
          outputTokens: 4000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 10000,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const result = await session.run(cycle.id);

      expect(result.report.utilizationPercent).toBe(100);
      expect(result.learningsCaptured).toBe(0);
    });

    it('does not capture an under-utilization learning at exactly 30% utilization', async () => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, 'Thirty Percent');
      cycleManager.addBet(cycle.id, {
        description: 'Thirty percent bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 3000,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const result = await session.run(cycle.id);

      expect(result.report.utilizationPercent).toBe(30);
      expect(result.learningsCaptured).toBe(0);
    });

    it('captures learnings for significant under-utilization', async () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Under Budget');
      cycleManager.addBet(cycle.id, {
        description: 'Small feature',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: 500,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 1000,
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

      expect(result.report.utilizationPercent).toBeCloseTo(1, 0);
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

    it('logs an error when rollback also fails after run() throws', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Rollback Failure Test');
      cycleManager.updateState(cycle.id, 'active');

      const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
      const originalUpdateState = cycleManager.updateState.bind(cycleManager);
      vi.spyOn(cycleManager, 'generateCooldown').mockImplementation(() => {
        throw new Error('Simulated failure');
      });
      vi.spyOn(cycleManager, 'updateState').mockImplementation((cycleId, state) => {
        if (state === 'active') {
          throw new Error('Rollback exploded');
        }
        originalUpdateState(cycleId, state);
      });

      try {
        await expect(session.run(cycle.id)).rejects.toThrow('Simulated failure');
        expect(errorSpy).toHaveBeenCalledWith(
          `Failed to roll back cycle "${cycle.id}" from cooldown to "active". Manual intervention may be required.`,
          { rollbackError: 'Rollback exploded' },
        );
        expect(cycleManager.get(cycle.id).state).toBe('cooldown');
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('handles empty cycle with no bets', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Empty Cycle');

      const result = await session.run(cycle.id);

      expect(result.report.bets).toEqual([]);
      expect(result.proposals).toEqual([]);
      expect(result.learningsCaptured).toBe(0);
    });
  });

  describe('agent confidence integration', () => {
    function writeAgentRecord(dir: string, id: string, name: string): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, `${id}.json`),
        JSON.stringify({
          id,
          name,
          role: 'executor',
          skills: [],
          createdAt: new Date().toISOString(),
          active: true,
        }, null, 2),
      );
    }

    it('computes confidence for each registered agent during run() using canonical deps', async () => {
      const agentDir = join(baseDir, 'agents-canonical');
      const alphaId = randomUUID();
      const betaId = randomUUID();
      writeAgentRecord(agentDir, alphaId, 'Alpha');
      writeAgentRecord(agentDir, betaId, 'Beta');

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Agent Confidence Cycle');
      const agentConfidenceCalculator = { compute: vi.fn() };
      const sessionWithAgents = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        agentDir,
        agentConfidenceCalculator,
      });

      await sessionWithAgents.run(cycle.id);

      expect(agentConfidenceCalculator.compute).toHaveBeenCalledTimes(2);
      expect(agentConfidenceCalculator.compute).toHaveBeenCalledWith(alphaId, 'Alpha');
      expect(agentConfidenceCalculator.compute).toHaveBeenCalledWith(betaId, 'Beta');
    });

    it('supports kataka compatibility aliases during complete()', async () => {
      const katakaDir = join(baseDir, 'agents-compat');
      const agentId = randomUUID();
      writeAgentRecord(katakaDir, agentId, 'Compat Agent');

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Compat Agent Cycle');
      const synthesisDir = join(baseDir, 'synthesis-agent-compat');
      mkdirSync(synthesisDir, { recursive: true });

      const katakaConfidenceCalculator = { compute: vi.fn() };
      const sessionWithCompat = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        synthesisDir,
        katakaDir,
        katakaConfidenceCalculator,
      });

      await sessionWithCompat.prepare(cycle.id);
      await sessionWithCompat.complete(cycle.id);

      expect(katakaConfidenceCalculator.compute).toHaveBeenCalledWith(agentId, 'Compat Agent');
    });
  });

  describe('belt advancement integration', () => {
    it('logs belt advancement during run() only when the belt levels up', async () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const projectStateFile = join(baseDir, 'project-state-run.json');

      const leveledCycle = cycleManager.create({ tokenBudget: 50000 }, 'Leveled Run Cycle');
      const leveledSession = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        projectStateFile,
        beltCalculator: {
          computeAndStore: vi.fn(() => ({
            belt: 'yon-kyu',
            previous: 'go-kyu',
            leveledUp: true,
          })),
        },
      });

      const steadyCycle = cycleManager.create({ tokenBudget: 50000 }, 'Steady Run Cycle');
      const steadySession = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        projectStateFile,
        beltCalculator: {
          computeAndStore: vi.fn(() => ({
            belt: 'go-kyu',
            previous: 'go-kyu',
            leveledUp: false,
          })),
        },
      });

      try {
        const leveledResult = await leveledSession.run(leveledCycle.id);
        expect(leveledResult.beltResult?.leveledUp).toBe(true);
        expect(infoSpy).toHaveBeenCalledWith('Belt advanced: go-kyu → yon-kyu');

        infoSpy.mockClear();

        const steadyResult = await steadySession.run(steadyCycle.id);
        expect(steadyResult.beltResult?.leveledUp).toBe(false);
        expect(infoSpy).not.toHaveBeenCalled();
      } finally {
        infoSpy.mockRestore();
      }
    });
  });

  describe('next-keiko integration', () => {
    it('passes completed and partial bets to the next-keiko generator', async () => {
      const runsDir = join(baseDir, 'runs-next-keiko');
      const bridgeRunsDir = join(baseDir, 'bridge-runs-next-keiko');
      mkdirSync(runsDir, { recursive: true });
      mkdirSync(bridgeRunsDir, { recursive: true });

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Next Keiko Cycle');
      cycleManager.addBet(cycle.id, {
        description: 'Completed bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Partial bet',
        appetite: 20,
        outcome: 'partial',
        issueRefs: [],
      });
      cycleManager.addBet(cycle.id, {
        description: 'Abandoned bet',
        appetite: 20,
        outcome: 'abandoned',
        issueRefs: [],
      });

      const nextKeikoProposalGenerator = {
        generate: vi.fn(() => ({
          text: '=== Next Keiko Proposals ===',
          observationCounts: { friction: 0, gap: 0, insight: 0, total: 0 },
          milestoneIssueCount: 2,
        })),
      };
      const sessionWithNextKeiko = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        runsDir,
        bridgeRunsDir,
        nextKeikoMilestoneName: 'Milestone Alpha',
        nextKeikoProposalGenerator,
      });

      const result = await sessionWithNextKeiko.run(cycle.id);

      expect(nextKeikoProposalGenerator.generate).toHaveBeenCalledWith(expect.objectContaining({
        cycle: expect.objectContaining({ id: cycle.id }),
        runsDir,
        bridgeRunsDir,
        milestoneName: 'Milestone Alpha',
        completedBets: ['Completed bet', 'Partial bet'],
      }));
      expect(result.nextKeikoResult?.text).toContain('Next Keiko Proposals');
      expect(result.nextKeikoResult?.milestoneIssueCount).toBe(2);
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

    it('logs unmatched bet IDs returned by the cycle manager', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const cycle = cycleManager.create({ tokenBudget: 50000 });

      try {
        session.recordBetOutcomes(cycle.id, [
          { betId: 'nonexistent-id', outcome: 'complete' },
        ]);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining(`Bet outcome(s) for cycle "${cycle.id}" referenced nonexistent bet IDs: nonexistent-id`),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not warn when every bet outcome matches a real bet', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const updated = cycleManager.addBet(cycle.id, {
        description: 'Known bet',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      try {
        session.recordBetOutcomes(cycle.id, [
          { betId: updated.bets[0]!.id, outcome: 'complete' },
        ]);

        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('referenced nonexistent bet IDs'));
      } finally {
        warnSpy.mockRestore();
      }
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

    it('requests history with warnOnInvalid=false and ignores entries for other cycles', () => {
      const cycle = cycleManager.create({ tokenBudget: 100000 }, 'Filtered History');
      const list = vi.fn(() => ([
        {
          id: 'entry-a',
          cycleId: cycle.id,
          tokenUsage: { total: 1800 },
        },
        {
          id: 'entry-b',
          cycleId: 'other-cycle',
          tokenUsage: { total: 9000 },
        },
        {
          id: 'entry-c',
          cycleId: cycle.id,
        },
      ]));
      const sessionWithPersistenceSpy = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: { list } as unknown as typeof JsonStore,
        pipelineDir,
        historyDir,
      });

      const enriched = sessionWithPersistenceSpy.enrichReportWithTokens(cycleManager.generateCooldown(cycle.id), cycle.id);

      expect(list).toHaveBeenCalledWith(historyDir, ExecutionHistoryEntrySchema, { warnOnInvalid: false });
      expect(enriched.tokensUsed).toBe(1800);
      expect(enriched.utilizationPercent).toBeCloseTo(1.8, 0);
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

    it.each([
      { total: 10000, expected: 'critical' },
      { total: 9000, expected: 'warning' },
      { total: 7500, expected: 'info' },
    ])('uses the exact $expected threshold boundary', ({ total, expected }) => {
      const cycle = cycleManager.create({ tokenBudget: 10000 }, `Boundary ${expected}`);
      const historyEntry = {
        id: crypto.randomUUID(),
        pipelineId: crypto.randomUUID(),
        stageType: 'build',
        stageIndex: 0,
        adapter: 'manual',
        tokenUsage: {
          inputTokens: total,
          outputTokens: 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total,
        },
        artifactNames: [],
        learningIds: [],
        cycleId: cycle.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      };
      JsonStore.write(join(historyDir, `${historyEntry.id}.json`), historyEntry, ExecutionHistoryEntrySchema);

      const enriched = session.enrichReportWithTokens(cycleManager.generateCooldown(cycle.id), cycle.id);
      expect(enriched.alertLevel).toBe(expected);
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

  describe('run with dojoSessionBuilder (dojo session generation)', () => {
    const dojoDir = join(baseDir, 'dojo-session-gen');
    const sessionsDir = join(dojoDir, 'sessions');

    beforeEach(() => {
      mkdirSync(sessionsDir, { recursive: true });
      mkdirSync(join(dojoDir, 'diary'), { recursive: true });
    });

    it('generates a dojo session on run() when dojoSessionBuilder is provided', async () => {
      const { SessionStore } = await import('@infra/dojo/session-store.js');
      const { SessionBuilder } = await import('@features/dojo/session-builder.js');
      const sessionStore = new SessionStore(sessionsDir);
      const dojoSessionBuilder = new SessionBuilder({ sessionStore });

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Session Gen Cycle');

      const sessionWithDojo = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
        dojoSessionBuilder,
      });

      await sessionWithDojo.run(cycle.id);

      const sessions = sessionStore.list();
      expect(sessions.length).toBe(1);
      expect(sessions[0]!.title).toContain('Session Gen Cycle');
    });

    it('does not generate a dojo session when dojoSessionBuilder is omitted (backward compat)', async () => {
      const { SessionStore } = await import('@infra/dojo/session-store.js');
      const sessionStore = new SessionStore(sessionsDir);

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'No Session');

      const sessionWithDojoNoBuilder = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
        // no dojoSessionBuilder
      });

      await sessionWithDojoNoBuilder.run(cycle.id);

      const sessions = sessionStore.list();
      expect(sessions.length).toBe(0);
    });

    it('does not generate a dojo session when dojoDir is omitted even if a builder exists', async () => {
      const dojoSessionBuilder = { build: vi.fn() };
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Builder Only');

      const sessionWithoutDojoDir = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoSessionBuilder,
      });

      await sessionWithoutDojoDir.run(cycle.id);

      expect(dojoSessionBuilder.build).not.toHaveBeenCalled();
    });

    it('does not abort cooldown when dojo session generation fails', async () => {
      const failingBuilder = {
        build: () => { throw new Error('SessionBuilder exploded'); },
      };

      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Fail Session');

      const sessionWithBadBuilder = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
        dojoSessionBuilder: failingBuilder,
      });

      // Should not throw
      const result = await sessionWithBadBuilder.run(cycle.id);
      expect(result.report).toBeDefined();
      expect(cycleManager.get(cycle.id).state).toBe('complete');
    });
  });

  describe('complete() with dojoSessionBuilder (dojo session generation)', () => {
    const dojoDir = join(baseDir, 'dojo-session-complete');
    const sessionsDir = join(dojoDir, 'sessions');
    const synthesisDir = join(baseDir, 'synthesis-complete');

    beforeEach(() => {
      mkdirSync(sessionsDir, { recursive: true });
      mkdirSync(join(dojoDir, 'diary'), { recursive: true });
      mkdirSync(synthesisDir, { recursive: true });
    });

    it('generates a dojo session on complete() when dojoSessionBuilder is provided', async () => {
      const { SessionStore } = await import('@infra/dojo/session-store.js');
      const { SessionBuilder } = await import('@features/dojo/session-builder.js');
      const sessionStore = new SessionStore(sessionsDir);
      const dojoSessionBuilder = new SessionBuilder({ sessionStore });

      // First prepare the cycle (transitions to cooldown state)
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Complete Session Cycle');
      const sessionForComplete = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        dojoDir,
        synthesisDir,
        dojoSessionBuilder,
      });

      await sessionForComplete.prepare(cycle.id);
      await sessionForComplete.complete(cycle.id);

      const sessions = sessionStore.list();
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions[0]!.title).toContain('Complete Session Cycle');
    });

    it('does not generate a dojo session on complete() when dojoDir is omitted', async () => {
      const dojoSessionBuilder = { build: vi.fn() };
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Complete Without Dojo Dir');
      const sessionForComplete = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        synthesisDir,
        dojoSessionBuilder,
      });

      await sessionForComplete.prepare(cycle.id);
      await sessionForComplete.complete(cycle.id);

      expect(dojoSessionBuilder.build).not.toHaveBeenCalled();
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

    it('calls calibrationDetector.detect for each bet with a runId', async () => {
      const detectMock = vi.fn().mockReturnValue({ biasesDetected: [], calibrationsWritten: 0, synthesisWritten: false });
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const runId1 = randomUUID();
      const runId2 = randomUUID();
      cycleManager.addBet(cycle.id, { description: 'Bet A', appetite: 10, runId: runId1 });
      cycleManager.addBet(cycle.id, { description: 'Bet B', appetite: 10, runId: runId2 });
      cycleManager.addBet(cycle.id, { description: 'Bet C (no runId)', appetite: 10 });

      const sessionWithDetector = new CooldownSession({
        cycleManager,
        knowledgeStore,
        persistence: JsonStore,
        pipelineDir,
        historyDir,
        calibrationDetector: { detect: detectMock },
      });

      await sessionWithDetector.run(cycle.id);

      expect(detectMock).toHaveBeenCalledTimes(2);
      expect(detectMock).toHaveBeenCalledWith(runId1);
      expect(detectMock).toHaveBeenCalledWith(runId2);
    });

    it('does not call calibrationDetector when no calibrationDetector provided (backward compat)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      // session has no calibrationDetector — should complete without error
      await expect(session.run(cycle.id)).resolves.toBeDefined();
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

  describe('checkIncompleteRuns', () => {
    const runsDir = join(baseDir, 'runs-incomplete');

    function makeRun(cycleId: string, betId: string, status: Run['status'] = 'completed'): Run {
      return {
        id: crypto.randomUUID(),
        cycleId,
        betId,
        betPrompt: 'Test bet',
        stageSequence: ['build'],
        currentStage: null,
        status,
        startedAt: new Date().toISOString(),
      };
    }

    beforeEach(() => {
      mkdirSync(runsDir, { recursive: true });
    });

    it('returns empty array when runsDir is not configured', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      // session has no runsDir
      const result = session.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('returns empty array when all runs are completed', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet A', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'completed');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('returns empty array when all runs are failed', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet B', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'failed');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('returns incomplete run info when a run is still pending', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet C', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0]!.runId).toBe(run.id);
      expect(result[0]!.betId).toBe(bet.id);
      expect(result[0]!.status).toBe('pending');
    });

    it('returns incomplete run info when a run is still running', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet D', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(runsDir, run);
      // Update run status to 'running' since createRunTree initialises as pending
      writeRun(runsDir, { ...run, status: 'running', currentStage: 'build' });
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0]!.status).toBe('running');
    });

    it('skips bets with no runId', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      cycleManager.addBet(cycle.id, { description: 'Bet no runId', appetite: 30, outcome: 'pending', issueRefs: [] });

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('skips bets whose run file is missing (handles gracefully)', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bet missing run', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      // Set a runId that doesn't actually have a run file
      cycleManager.setRunId(cycle.id, bet.id, crypto.randomUUID());

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      // Should not throw — missing run file is swallowed
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('counts only incomplete runs when cycle has mix of complete and incomplete', () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet1 = cycleManager.addBet(cycle.id, { description: 'Complete bet', appetite: 20, outcome: 'pending', issueRefs: [] });
      const bet1 = withBet1.bets[0]!;
      const withBet2 = cycleManager.addBet(cycle.id, { description: 'In-progress bet', appetite: 20, outcome: 'pending', issueRefs: [] });
      const bet2 = withBet2.bets[1]!;

      const run1 = makeRun(cycle.id, bet1.id, 'completed');
      createRunTree(runsDir, run1);
      cycleManager.setRunId(cycle.id, bet1.id, run1.id);

      const run2 = makeRun(cycle.id, bet2.id, 'pending');
      createRunTree(runsDir, run2);
      cycleManager.setRunId(cycle.id, bet2.id, run2.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = sessionWithRuns.checkIncompleteRuns(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0]!.betId).toBe(bet2.id);
    });

    it('prefers bridge-run metadata over run.json when bridgeRunsDir is provided', () => {
      const bridgeRunsDir = join(baseDir, 'bridge-runs-check');
      const runsDir = join(baseDir, 'runs-bridge-check');
      mkdirSync(bridgeRunsDir, { recursive: true });

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Bridge bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      // Write a stale run.json that still shows 'running' (as it always would without bridge-run support)
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'run.json'), JSON.stringify({
        id: runId, cycleId: cycle.id, betId: bet.id, betPrompt: 'Bridge bet',
        stageSequence: ['build'], currentStage: null, status: 'running',
        startedAt: new Date().toISOString(),
      }));

      // Write bridge-run file as 'complete' — should take precedence over stale run.json
      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({ runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'complete' }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir, runsDir,
      });
      // Bridge-run 'complete' takes precedence over stale run.json 'running' → no incomplete runs
      const result = sessionWithBridge.checkIncompleteRuns(cycle.id);
      expect(result).toEqual([]);
    });

    it('reports incomplete when bridge-run status is in-progress', () => {
      const bridgeRunsDir = join(baseDir, 'bridge-runs-inprogress');
      mkdirSync(bridgeRunsDir, { recursive: true });

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'In-progress bridge bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      
      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({ runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'in-progress' }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir,
      });
      const result = sessionWithBridge.checkIncompleteRuns(cycle.id);
      expect(result).toHaveLength(1);
      expect(result[0]!.runId).toBe(runId);
      expect(result[0]!.status).toBe('running');
    });
  });

  describe('autoSyncBetOutcomesFromBridgeRuns (via run)', () => {
    const bridgeRunsDir = join(baseDir, 'bridge-runs-autosync');

    beforeEach(() => {
      mkdirSync(bridgeRunsDir, { recursive: true });
    });

    it('auto-completes pending bets when bridge-run metadata shows complete', async () => {
      

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Auto-sync bet', appetite: 80, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      // Write bridge-run file as 'complete' (what kiai complete does)
      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({
        runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', betName: 'Auto-sync bet',
        stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'complete',
      }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir,
      });

      // Start cycle first
      cycleManager.updateState(cycle.id, 'active');

      const result = await sessionWithBridge.run(cycle.id, [], { force: true });

      // Bet should be auto-completed
      expect(result.report.completionRate).toBe(100);
      expect(result.report.bets[0]!.outcome).toBe('complete');
    });

    it('auto-marks failed bridge runs as partial', async () => {
      

      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Failed bet', appetite: 80, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({
        runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', betName: 'Failed bet',
        stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'failed',
      }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir,
      });

      cycleManager.updateState(cycle.id, 'active');
      const result = await sessionWithBridge.run(cycle.id, [], { force: true });

      expect(result.report.bets[0]!.outcome).toBe('partial');
      expect(result.report.completionRate).toBe(0); // partial doesn't count as complete
    });

    it('does not record bet outcomes when bridge-run status is still in progress', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Running bet', appetite: 80, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({
        runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', betName: 'Running bet',
        stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'in-progress',
      }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir,
      });
      const recordSpy = vi.spyOn(sessionWithBridge, 'recordBetOutcomes');

      try {
        cycleManager.updateState(cycle.id, 'active');
        const result = await sessionWithBridge.run(cycle.id, [], { force: true });

        expect(recordSpy).not.toHaveBeenCalled();
        expect(result.betOutcomes).toEqual([]);
        expect(result.report.bets[0]!.outcome).toBe('pending');
      } finally {
        recordSpy.mockRestore();
      }
    });

    it('explicit bet outcome passed to run() takes precedence over bridge-run auto-sync', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      // Bet starts as pending — auto-sync would set it to 'complete' from bridge-run
      const withBet = cycleManager.addBet(cycle.id, { description: 'Explicit override bet', appetite: 80, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;
      const runId = randomUUID();
      cycleManager.setRunId(cycle.id, bet.id, runId);

      // Bridge-run says 'complete' — but the sensei explicitly passes 'abandoned'
      writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({
        runId, betId: bet.id, cycleId: cycle.id, cycleName: 'Test', betName: 'Explicit override bet',
        stages: ['build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'complete',
      }));

      const sessionWithBridge = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, bridgeRunsDir,
      });

      cycleManager.updateState(cycle.id, 'active');
      // Explicit 'abandoned' should win over bridge-run 'complete'
      const result = await sessionWithBridge.run(cycle.id, [{ betId: bet.id, outcome: 'abandoned' }], { force: true });

      expect(result.report.bets[0]!.outcome).toBe('abandoned');
      // effectiveBetOutcomes should reflect the explicit outcome, not the auto-synced one
      expect(result.betOutcomes[0]!.outcome).toBe('abandoned');
    });
  });

  describe('run — incomplete runs warning', () => {
    const runsDir = join(baseDir, 'runs-warn');

    function makeRun(cycleId: string, betId: string, status: Run['status'] = 'completed'): Run {
      return {
        id: crypto.randomUUID(),
        cycleId,
        betId,
        betPrompt: 'Test bet',
        stageSequence: ['build'],
        currentStage: null,
        status,
        startedAt: new Date().toISOString(),
      };
    }

    beforeEach(() => {
      mkdirSync(runsDir, { recursive: true });
    });

    it('incompleteRuns is undefined when runsDir is not provided', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const result = await session.run(cycle.id);
      expect(result.incompleteRuns).toBeUndefined();
    });

    it('incompleteRuns is empty array when all runs are complete', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Done bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'completed');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.incompleteRuns).toBeDefined();
      expect(result.incompleteRuns).toHaveLength(0);
    });

    it('incompleteRuns is non-empty when a run is pending (no --force)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'In-progress bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      // Without --force, should still complete (just warns)
      const result = await sessionWithRuns.run(cycle.id, [], { force: false });

      expect(result.incompleteRuns).toHaveLength(1);
      expect(result.incompleteRuns![0]!.runId).toBe(run.id);
      expect(result.incompleteRuns![0]!.status).toBe('pending');
    });

    it('incompleteRuns is non-empty when --force is used (bypasses warning, still runs)', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Forced bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(runsDir, run);
      writeRun(runsDir, { ...run, status: 'running', currentStage: 'build' });
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      // --force should proceed without blocking
      const result = await sessionWithRuns.run(cycle.id, [], { force: true });

      expect(result.incompleteRuns).toHaveLength(1);
      expect(result.incompleteRuns![0]!.status).toBe('running');
      // Cycle should still complete
      expect(cycleManager.get(cycle.id).state).toBe('complete');
    });

    it('logs the incomplete-runs warning only when force is false', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Warned bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        await sessionWithRuns.run(cycle.id, [], { force: false });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(true);

        warnSpy.mockClear();
        cycleManager.updateState(cycle.id, 'active');

        await sessionWithRuns.run(cycle.id, [], { force: true });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('does not log the incomplete-runs warning when no incomplete runs exist', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        await session.run(cycle.id, [], { force: false });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('cooldown proceeds normally (no block) even with incomplete runs — just warns', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Stale bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir,
      });
      // Should not throw — just warns
      const result = await sessionWithRuns.run(cycle.id);

      expect(result.report).toBeDefined();
      expect(cycleManager.get(cycle.id).state).toBe('complete');
    });
  });

  describe('prepare — incomplete runs warning', () => {
    const runsDir = join(baseDir, 'runs-prepare-warn');
    const synthesisDir = join(baseDir, 'synthesis-prepare-warn');

    function makeRun(cycleId: string, betId: string, status: Run['status'] = 'completed'): Run {
      return {
        id: crypto.randomUUID(),
        cycleId,
        betId,
        betPrompt: 'Test bet',
        stageSequence: ['build'],
        currentStage: null,
        status,
        startedAt: new Date().toISOString(),
      };
    }

    beforeEach(() => {
      mkdirSync(runsDir, { recursive: true });
      mkdirSync(synthesisDir, { recursive: true });
    });

    it('incompleteRuns is non-empty in prepare result when run is still pending', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Pending bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir, synthesisDir,
      });
      const result = await sessionWithRuns.prepare(cycle.id, [], 'quick');

      expect(result.incompleteRuns).toHaveLength(1);
      expect(result.incompleteRuns![0]!.runId).toBe(run.id);
    });

    it('incompleteRuns is empty in prepare result when all runs complete', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Done bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'completed');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir, synthesisDir,
      });
      const result = await sessionWithRuns.prepare(cycle.id, [], 'quick', { force: false });

      expect(result.incompleteRuns).toHaveLength(0);
    });

    it('prepare with --force proceeds when runs are incomplete', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Running bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(runsDir, run);
      writeRun(runsDir, { ...run, status: 'running', currentStage: 'build' });
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir, synthesisDir,
      });
      const result = await sessionWithRuns.prepare(cycle.id, [], 'quick', { force: true });

      // Should still return incompleteRuns so the caller can surface them
      expect(result.incompleteRuns).toHaveLength(1);
      expect(result.synthesisInputId).toBeTruthy();
    });

    it('prepare logs the incomplete-runs warning only when force is false', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const withBet = cycleManager.addBet(cycle.id, { description: 'Prepare warn bet', appetite: 30, outcome: 'pending', issueRefs: [] });
      const bet = withBet.bets[0]!;

      const run = makeRun(cycle.id, bet.id, 'pending');
      createRunTree(runsDir, run);
      cycleManager.setRunId(cycle.id, bet.id, run.id);

      const sessionWithRuns = new CooldownSession({
        cycleManager, knowledgeStore, persistence: JsonStore, pipelineDir, historyDir, runsDir, synthesisDir,
      });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        await sessionWithRuns.prepare(cycle.id, [], 'quick', { force: false });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(true);

        warnSpy.mockClear();
        cycleManager.updateState(cycle.id, 'active');

        await sessionWithRuns.prepare(cycle.id, [], 'quick', { force: true });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('prepare does not log the incomplete-runs warning when every run is complete', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 });
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

      try {
        await session.prepare(cycle.id, [], 'quick', { force: false });
        expect(warnSpy.mock.calls.some((args) => String(args[0]).includes('still in progress'))).toBe(false);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('buildAgentPerspectiveFromProposals', () => {
    it('formats supported proposal types for diary agent perspective text', () => {
      const perspective = CooldownSession.buildAgentPerspectiveFromProposals([
        {
          id: 'new-learning',
          type: 'new-learning',
          proposedTier: 'stage',
          proposedCategory: 'testing',
          proposedContent: 'Write mutation-focused tests for hot seams.',
          confidence: 0.82,
        },
        {
          id: 'update-learning',
          type: 'update-learning',
          confidenceDelta: 0.15,
          proposedContent: 'Prefer smaller cooldown scopes when mutation debt is high.',
        },
        {
          id: 'promote',
          type: 'promote',
          toTier: 'category',
        },
        {
          id: 'archive',
          type: 'archive',
          reason: 'Superseded by recent cooldown evidence.',
        },
        {
          id: 'methodology',
          type: 'methodology-recommendation',
          area: 'planning',
          recommendation: 'Split large orchestration seams before adding more CLI wiring.',
        },
      ] as Parameters<typeof CooldownSession.buildAgentPerspectiveFromProposals>[0]);

      expect(perspective).toContain('New learning');
      expect(perspective).toContain('[stage/testing]');
      expect(perspective).toContain('Updated learning');
      expect(perspective).toContain('+0.15');
      expect(perspective).toContain('Promoted learning');
      expect(perspective).toContain('Archived learning');
      expect(perspective).toContain('Methodology recommendation');
      expect(perspective).toContain('(planning)');
      expect(perspective).toContain('Split large orchestration seams before adding more CLI wiring.');
    });

    it('returns undefined when there are no proposals', () => {
      expect(CooldownSession.buildAgentPerspectiveFromProposals([])).toBeUndefined();
    });
  });
});
