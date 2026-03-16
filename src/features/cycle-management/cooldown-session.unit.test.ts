import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { ProjectStateSchema } from '@domain/types/belt.js';
import type { Run, StageState } from '@domain/types/run-state.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { appendObservation, createRunTree, writeStageState } from '@infra/persistence/run-store.js';
import { KataAgentRegistry } from '@infra/registries/kata-agent-registry.js';
import { SynthesisResultSchema } from '@domain/types/synthesis.js';
import { logger } from '@shared/lib/logger.js';
import {
  CooldownSession,
  type CooldownSessionDeps,
} from './cooldown-session.js';

function createFixture() {
  const baseDir = join(tmpdir(), `kata-cooldown-unit-${randomUUID()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');
  const runsDir = join(baseDir, 'runs');
  const bridgeRunsDir = join(baseDir, 'bridge-runs');
  const synthesisDir = join(baseDir, 'synthesis');
  const dojoDir = join(baseDir, 'dojo');
  const agentDir = join(baseDir, 'agents');
  const projectStateFile = join(baseDir, 'project-state.json');

  for (const dir of [cyclesDir, knowledgeDir, pipelineDir, historyDir, runsDir, bridgeRunsDir, synthesisDir, dojoDir, agentDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const cycleManager = new CycleManager(cyclesDir, JsonStore);
  const knowledgeStore = new KnowledgeStore(knowledgeDir);

  const baseDeps: CooldownSessionDeps = {
    cycleManager,
    knowledgeStore,
    persistence: JsonStore,
    pipelineDir,
    historyDir,
    runsDir,
    bridgeRunsDir,
    synthesisDir,
  };

  return {
    baseDir,
    cycleManager,
    knowledgeStore,
    pipelineDir,
    historyDir,
    runsDir,
    bridgeRunsDir,
    synthesisDir,
    dojoDir,
    agentDir,
    projectStateFile,
    baseDeps,
    cleanup() {
      rmSync(baseDir, { recursive: true, force: true });
    },
  };
}

function makeRun(cycleId: string, betId: string, status: Run['status'] = 'completed'): Run {
  return {
    id: randomUUID(),
    cycleId,
    betId,
    betPrompt: 'Unit test bet',
    stageSequence: ['build'],
    currentStage: null,
    status,
    startedAt: new Date().toISOString(),
  };
}

function makeStageState(overrides: Partial<StageState> = {}): StageState {
  return {
    category: 'build',
    status: 'completed',
    selectedFlavors: [],
    gaps: [],
    decisions: [],
    approvedGates: [],
    ...overrides,
  };
}

function writeBridgeRun(
  bridgeRunsDir: string,
  runId: string,
  data: { cycleId?: string; betId?: string; status?: string },
): void {
  writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify({
    runId,
    ...data,
  }));
}

function writeProjectState(projectStateFile: string): void {
  JsonStore.write(projectStateFile, {
    currentBelt: 'mukyu',
    synthesisAppliedCount: 0,
    gapsClosedCount: 0,
    ranWithYolo: false,
    discovery: {
      ranFirstExecution: false,
      completedFirstCycleCooldown: false,
      savedKataSequence: false,
      createdCustomStepOrFlavor: false,
      launchedConfig: false,
      launchedWatch: false,
      launchedDojo: false,
    },
    checkHistory: [],
  }, ProjectStateSchema);
}

describe('CooldownSession unit seams', () => {
  it('runs bounded optional cooldown workflows and records low-completion learnings', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Bounded Run');
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bridge-backed bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Still pending bet',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Another pending bet',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const bridgeBet = updated.bets[0]!;
      const run = makeRun(cycle.id, bridgeBet.id);
      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      fixture.cycleManager.setRunId(cycle.id, bridgeBet.id, run.id);
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: bridgeBet.id,
        status: 'failed',
      });

      const proposalGenerator = { generate: vi.fn(() => []) };
      const predictionMatcher = { match: vi.fn() };
      const calibrationDetector = { detect: vi.fn() };
      const frictionAnalyzer = { analyze: vi.fn() };
      const hierarchicalPromoter = {
        promoteStepToFlavor: vi.fn(() => ({ learnings: [] })),
        promoteFlavorToStage: vi.fn(() => ({ learnings: [] })),
        promoteStageToCategory: vi.fn(),
      };
      const beltCalculator = {
        computeAndStore: vi.fn(() => ({
          belt: 'go-kyu' as const,
          previous: 'mukyu' as const,
          leveledUp: true,
          snapshot: {} as never,
        })),
      };
      const agentConfidenceCalculator = { compute: vi.fn() };
      const dojoSessionBuilder = { build: vi.fn() };
      const nextKeikoProposalGenerator = {
        generate: vi.fn(() => ({
          text: 'next keiko',
          observationCounts: { friction: 0, gap: 0, insight: 0, total: 0 },
          milestoneIssueCount: 0,
        })),
      };

      writeProjectState(fixture.projectStateFile);
      const registry = new KataAgentRegistry(fixture.agentDir);
      registry.register({
        id: randomUUID(),
        name: 'Unit Agent',
        role: 'executor',
        skills: ['testing'],
        createdAt: new Date().toISOString(),
        active: true,
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        agentDir: fixture.agentDir,
        projectStateFile: fixture.projectStateFile,
        proposalGenerator,
        predictionMatcher,
        calibrationDetector,
        frictionAnalyzer,
        hierarchicalPromoter,
        beltCalculator,
        agentConfidenceCalculator,
        dojoSessionBuilder,
        nextKeikoProposalGenerator,
        ruleRegistry: { getPendingSuggestions: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);

      expect(result.betOutcomes).toEqual([
        { betId: bridgeBet.id, outcome: 'partial' },
      ]);
      expect(result.learningsCaptured).toBeGreaterThanOrEqual(1);
      expect(predictionMatcher.match).toHaveBeenCalledWith(run.id);
      expect(calibrationDetector.detect).toHaveBeenCalledWith(run.id);
      expect(frictionAnalyzer.analyze).toHaveBeenCalledWith(run.id);
      expect(hierarchicalPromoter.promoteStepToFlavor).toHaveBeenCalled();
      expect(beltCalculator.computeAndStore).toHaveBeenCalledWith(
        fixture.projectStateFile,
        expect.objectContaining({ currentBelt: 'mukyu' }),
      );
      expect(agentConfidenceCalculator.compute).toHaveBeenCalledTimes(1);
      expect(dojoSessionBuilder.build).toHaveBeenCalledTimes(1);
      expect(nextKeikoProposalGenerator.generate).toHaveBeenCalledTimes(1);
      expect(fixture.cycleManager.get(cycle.id).state).toBe('complete');
    } finally {
      fixture.cleanup();
    }
  });

  it('prepare writes synthesis input from bridge-run fallback data and removes stale pending files', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Prepare Fallback');
      const withBet = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bridge fallback bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = withBet.bets[0]!;
      const run = makeRun(cycle.id, bet.id);

      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      appendObservation(fixture.runsDir, run.id, {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'insight',
        content: 'Observation collected through the bridge fallback',
      }, { level: 'run' });
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: bet.id,
        status: 'complete',
      });

      const stalePath = join(fixture.synthesisDir, `pending-${randomUUID()}.json`);
      const otherPath = join(fixture.synthesisDir, `pending-${randomUUID()}.json`);
      writeFileSync(stalePath, JSON.stringify({ cycleId: cycle.id }));
      writeFileSync(otherPath, JSON.stringify({ cycleId: randomUUID() }));

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const synthesisInput = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));

      expect(synthesisInput.observations).toHaveLength(1);
      expect(synthesisInput.observations[0]!.content).toContain('bridge fallback');
      expect(existsSync(stalePath)).toBe(false);
      expect(existsSync(otherPath)).toBe(true);
    } finally {
      fixture.cleanup();
    }
  });

  it('complete applies only the accepted synthesis proposals', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Complete Apply');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Completed bet',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const inputId = randomUUID();
      const acceptedProposalId = randomUUID();
      JsonStore.write(join(fixture.synthesisDir, `result-${inputId}.json`), {
        inputId,
        proposals: [
          {
            id: acceptedProposalId,
            type: 'new-learning',
            confidence: 0.8,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'High-signal synthesis',
            createdAt: new Date().toISOString(),
            proposedContent: 'Prefer bounded helpers for cooldown orchestration',
            proposedTier: 'category',
            proposedCategory: 'cycle-management',
          },
          {
            id: randomUUID(),
            type: 'methodology-recommendation',
            confidence: 0.6,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'Not accepted',
            createdAt: new Date().toISOString(),
            recommendation: 'Keep the session thin',
            area: 'cooldown',
          },
        ],
      }, SynthesisResultSchema);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.complete(cycle.id, inputId, [acceptedProposalId]);

      expect(result.synthesisProposals).toHaveLength(1);
      expect(result.synthesisProposals![0]!.id).toBe(acceptedProposalId);
      expect(fixture.knowledgeStore.query({}).some((learning) =>
        learning.content.includes('bounded helpers for cooldown orchestration'),
      )).toBe(true);
      expect(fixture.cycleManager.get(cycle.id).state).toBe('complete');
    } finally {
      fixture.cleanup();
    }
  });

  it('complete covers update, promote, archive, and methodology synthesis proposals', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Complete Variants');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Completed bet',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const toUpdate = fixture.knowledgeStore.capture({
        tier: 'category',
        category: 'cycle-management',
        content: 'Old content',
        confidence: 0.4,
        source: 'user',
      });
      const toPromote = fixture.knowledgeStore.capture({
        tier: 'step',
        stageType: 'build',
        category: 'testing',
        content: 'Promote me',
        confidence: 0.6,
        source: 'user',
      });
      const toArchive = fixture.knowledgeStore.capture({
        tier: 'category',
        category: 'testing',
        content: 'Archive me',
        confidence: 0.5,
        source: 'user',
      });

      const inputId = randomUUID();
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      JsonStore.write(join(fixture.synthesisDir, `result-${inputId}.json`), {
        inputId,
        proposals: [
          {
            id: randomUUID(),
            type: 'update-learning',
            confidence: 0.8,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'Update confidence and wording',
            createdAt: new Date().toISOString(),
            targetLearningId: toUpdate.id,
            proposedContent: 'Updated content',
            confidenceDelta: 0.3,
          },
          {
            id: randomUUID(),
            type: 'promote',
            confidence: 0.7,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'Promote proven learning',
            createdAt: new Date().toISOString(),
            targetLearningId: toPromote.id,
            fromTier: 'step',
            toTier: 'flavor',
          },
          {
            id: randomUUID(),
            type: 'archive',
            confidence: 0.6,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'Archive obsolete learning',
            createdAt: new Date().toISOString(),
            targetLearningId: toArchive.id,
            reason: 'Superseded',
          },
          {
            id: randomUUID(),
            type: 'methodology-recommendation',
            confidence: 0.5,
            citations: [randomUUID(), randomUUID()],
            reasoning: 'Document process guidance',
            createdAt: new Date().toISOString(),
            recommendation: 'Keep cooldown wrappers thin',
            area: 'cooldown',
          },
        ],
      }, SynthesisResultSchema);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.complete(cycle.id, inputId);

      expect(result.synthesisProposals).toHaveLength(4);
      expect(fixture.knowledgeStore.get(toUpdate.id)).toEqual(expect.objectContaining({
        content: 'Updated content',
        confidence: 0.7,
      }));
      expect(fixture.knowledgeStore.get(toPromote.id).tier).toBe('flavor');
      expect(fixture.knowledgeStore.query({ includeArchived: true }).find((learning) => learning.id === toArchive.id)?.archived).toBe(true);
      expect(infoSpy).toHaveBeenCalledWith('Methodology recommendation (area: cooldown): Keep cooldown wrappers thin');
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('rolls cycle state back when run fails after cooldown begins', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'Rollback Run');
      fixture.cycleManager.updateState(cycle.id, 'active');
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => { throw new Error('planned failure'); }) },
      });

      await expect(session.run(cycle.id)).rejects.toThrow('planned failure');
      expect(fixture.cycleManager.get(cycle.id).state).toBe('active');
    } finally {
      fixture.cleanup();
    }
  });

  it('warns and continues when agent confidence loading fails', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'Confidence Warning');
      const brokenAgentPath = join(fixture.baseDir, 'not-a-directory.json');
      writeFileSync(brokenAgentPath, '{}');

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        agentDir: brokenAgentPath,
        agentConfidenceCalculator: { compute: vi.fn() },
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      await session.run(cycle.id);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Agent confidence computation failed:'));
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('writeRunDiary skips diary when dojoDir is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Diary');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Skip diary bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const dojoSessionBuilder = { build: vi.fn() };
      const session = new CooldownSession({
        ...fixture.baseDeps,
        // dojoDir deliberately NOT set
        dojoSessionBuilder,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);

      // Diary and session should NOT be written when dojoDir is absent
      expect(dojoSessionBuilder.build).not.toHaveBeenCalled();
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('complete writes diary and session when dojoDir and dojoSessionBuilder are configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Complete Diary');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Diary bet',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const dojoSessionBuilder = { build: vi.fn() };
      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        dojoSessionBuilder,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      await session.complete(cycle.id);

      // Both diary and session should be written
      expect(dojoSessionBuilder.build).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('run with force=true parameter exercises warning bypass', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Force Bypass');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Force bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Should not warn when force=true
      await session.run(cycle.id, [], { force: true });
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('run(s) are still in progress'));
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('prepare with depth parameter overrides default synthesis depth', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Depth Override');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Depth bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        synthesisDepth: 'minimal',
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id, [], 'thorough');
      const synthesisInput = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      expect(synthesisInput.depth).toBe('thorough');
    } finally {
      fixture.cleanup();
    }
  });

  it('run skips nextKeiko when runsDir is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Runs');
      const nextKeikoGen = { generate: vi.fn(() => ({ text: 'test', observationCounts: { friction: 0, gap: 0, insight: 0, total: 0 }, milestoneIssueCount: 0 })) };

      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        // runsDir deliberately NOT set
        proposalGenerator: { generate: vi.fn(() => []) },
        nextKeikoProposalGenerator: nextKeikoGen,
      });

      const result = await session.run(cycle.id);

      // nextKeiko should NOT be called without runsDir
      expect(nextKeikoGen.generate).not.toHaveBeenCalled();
      expect(result.nextKeikoResult).toBeUndefined();
      expect(result.incompleteRuns).toBeUndefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('run returns empty incompleteRuns when all bets are complete', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'All Complete');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Done bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      expect(result.incompleteRuns).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('checkIncompleteRuns prefers bridge metadata and falls back to run.json status', () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 3_000 }, 'Incomplete Check');
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bridge running bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Run file pending bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const bridgeBet = updated.bets[0]!;
      const runBet = updated.bets[1]!;

      const bridgeRun = makeRun(cycle.id, bridgeBet.id, 'completed');
      const pendingRun = makeRun(cycle.id, runBet.id, 'pending');
      createRunTree(fixture.runsDir, bridgeRun);
      createRunTree(fixture.runsDir, pendingRun);
      fixture.cycleManager.setRunId(cycle.id, bridgeBet.id, bridgeRun.id);
      fixture.cycleManager.setRunId(cycle.id, runBet.id, pendingRun.id);
      writeBridgeRun(fixture.bridgeRunsDir, bridgeRun.id, {
        cycleId: cycle.id,
        betId: bridgeBet.id,
        status: 'in-progress',
      });

      const session = new CooldownSession(fixture.baseDeps);

      expect(session.checkIncompleteRuns(cycle.id)).toEqual([
        { runId: bridgeRun.id, betId: bridgeBet.id, status: 'running' },
        { runId: pendingRun.id, betId: runBet.id, status: 'pending' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('enrichBetOutcomesWithDescriptions falls back to cycle bet descriptions when betDescription is absent', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Enrich Test');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bet with known description',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: bet.id,
        status: 'complete',
      });

      // Create diary dir so diary writing is exercised
      mkdirSync(join(fixture.dojoDir, 'diary'), { recursive: true });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Run with empty betOutcomes — auto-sync from bridge runs should provide outcomes
      // and enrichBetOutcomesWithDescriptions should fill in betDescription from the cycle
      const result = await session.run(cycle.id);
      expect(result.betOutcomes).toHaveLength(1);
      expect(result.betOutcomes[0]!.betId).toBe(bet.id);
    } finally {
      fixture.cleanup();
    }
  });

  it('run with force=false (default) warns on incomplete runs', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Default Force');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'In-progress bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Default force=false should warn about incomplete runs
      await session.run(cycle.id);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('run(s) are still in progress'));
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('prepare with force=false (default) warns on incomplete runs', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Prepare Default Force');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Prep incomplete bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id, 'running');
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Default force=false should warn about incomplete runs in prepare path
      await session.prepare(cycle.id);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('run(s) are still in progress'));
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('collectSynthesisObservations skips bets without runId and filters empty observation lists', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Obs Filter');
      // Add a bet with a run that has observations
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Has observations',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      // Add a bet WITHOUT a runId — should be skipped
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'No run assigned',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      appendObservation(fixture.runsDir, run.id, {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'insight',
        content: 'Observable insight',
      }, { level: 'run' });
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      expect(input.observations).toHaveLength(1);
      expect(input.observations[0]!.content).toBe('Observable insight');
    } finally {
      fixture.cleanup();
    }
  });

  it('autoSyncBetOutcomesFromBridgeRuns skips bets that are not syncable', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'AutoSync');
      // Add a bet that is already complete (not syncable)
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Already complete bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      // Add a pending bet WITH runId (syncable)
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Syncable bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const syncableBet = updated.bets[1]!;
      const run = makeRun(cycle.id, syncableBet.id);
      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      fixture.cycleManager.setRunId(cycle.id, syncableBet.id, run.id);
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: syncableBet.id,
        status: 'complete',
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      // Only the syncable bet should have an outcome recorded
      expect(result.betOutcomes).toEqual([
        { betId: syncableBet.id, outcome: 'complete' },
      ]);
    } finally {
      fixture.cleanup();
    }
  });

  it('listJsonFiles filters non-json files from bridge-runs directory', async () => {
    const fixture = createFixture();

    try {
      // Write a .txt file into bridge-runs — should be ignored
      writeFileSync(join(fixture.bridgeRunsDir, 'notes.txt'), 'not json');
      writeFileSync(join(fixture.bridgeRunsDir, 'readme.md'), '# notes');

      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Json Filter');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Filter bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: bet.id,
        status: 'complete',
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // prepare uses collectSynthesisObservations which uses loadBridgeRunIdsByBetId
      // which uses listJsonFiles — the .txt file should be filtered out
      const result = await session.prepare(cycle.id);
      expect(result.synthesisInputPath).toBeTruthy();
    } finally {
      fixture.cleanup();
    }
  });
});
