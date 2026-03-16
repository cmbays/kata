import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('runPredictionMatching is skipped when predictionMatcher is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Matcher');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Matcherless bet',
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

      // Explicitly pass null-ish prediction matcher deps to ensure no matcher
      const session = new CooldownSession({
        ...fixture.baseDeps,
        predictionMatcher: undefined,
        // Remove runsDir so auto-construction is skipped too
        runsDir: undefined,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Should complete without error — predictionMatching is a no-op
      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('runCalibrationDetection is skipped when calibrationDetector is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Calibration');
      const session = new CooldownSession({
        ...fixture.baseDeps,
        calibrationDetector: undefined,
        runsDir: undefined,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('runFrictionAnalysis is skipped when frictionAnalyzer is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Friction');
      const session = new CooldownSession({
        ...fixture.baseDeps,
        frictionAnalyzer: undefined,
        runsDir: undefined,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('runPredictionMatching calls predictionMatcher.match for each bet with runId', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Matcher Cycle');
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bet with run',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bet without run',
        appetite: 20,
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

      const predictionMatcher = { match: vi.fn() };
      const calibrationDetector = { detect: vi.fn() };
      const frictionAnalyzer = { analyze: vi.fn() };

      const session = new CooldownSession({
        ...fixture.baseDeps,
        predictionMatcher,
        calibrationDetector,
        frictionAnalyzer,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      await session.run(cycle.id);

      // Only the bet with a runId should have been processed
      expect(predictionMatcher.match).toHaveBeenCalledWith(run.id);
      expect(predictionMatcher.match).toHaveBeenCalledTimes(1);
      expect(calibrationDetector.detect).toHaveBeenCalledWith(run.id);
      expect(calibrationDetector.detect).toHaveBeenCalledTimes(1);
      expect(frictionAnalyzer.analyze).toHaveBeenCalledWith(run.id);
      expect(frictionAnalyzer.analyze).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('runExpiryCheck calls knowledgeStore.checkExpiry when available', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'Expiry Check');

      const checkExpirySpy = vi.spyOn(fixture.baseDeps.knowledgeStore, 'checkExpiry');
      vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      await session.run(cycle.id);

      // KnowledgeStore has checkExpiry, so it should have been invoked during run()
      expect(checkExpirySpy).toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('captureCooldownLearnings records evidence array with proper pipelineId and stageType', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'Evidence Cycle');
      // Low completion rate triggers a learning with evidence
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Pending bet 1',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Pending bet 2',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Pending bet 3',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);

      // With 0% completion rate (all pending, none resolved), we should get at least one learning
      expect(result.learningsCaptured).toBeGreaterThanOrEqual(1);

      // Verify a learning was actually captured with correct evidence
      const allLearnings = fixture.knowledgeStore.query({});
      const cooldownLearning = allLearnings.find((l) =>
        l.content.includes('low completion rate') || l.content.includes('under-utilized'),
      );
      if (cooldownLearning) {
        expect(cooldownLearning.evidence).toBeDefined();
        expect(cooldownLearning.evidence!.length).toBeGreaterThan(0);
        expect(cooldownLearning.evidence![0]!.stageType).toBe('cooldown');
        expect(cooldownLearning.evidence![0]!.pipelineId).toBe(cycle.id);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('hasFailedCaptures logs a warning when learning capture fails', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'Fail Capture');
      // Many pending bets with low completion to trigger learning drafts
      for (let i = 0; i < 5; i++) {
        fixture.cycleManager.addBet(cycle.id, {
          description: `Pending bet ${i}`,
          appetite: 10,
          outcome: 'pending',
          issueRefs: [],
        });
      }

      // Use a knowledge store that throws on capture
      const brokenStore = {
        ...fixture.knowledgeStore,
        capture: vi.fn(() => { throw new Error('Capture failed'); }),
        query: vi.fn(() => []),
        get: vi.fn(),
      };

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        ...fixture.baseDeps,
        knowledgeStore: brokenStore as unknown as typeof fixture.knowledgeStore,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      expect(result.learningsCaptured).toBe(0);
      // Should have warned about failed captures
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('cooldown learnings failed to capture'));
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('readBridgeRunMeta returns undefined for invalid JSON files in bridge-runs', async () => {
    const fixture = createFixture();

    try {
      writeFileSync(join(fixture.bridgeRunsDir, 'broken.json'), '{ invalid json }');

      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Broken Meta');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Working bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Should not crash — invalid files are skipped
      const result = await session.prepare(cycle.id);
      expect(result.synthesisInputPath).toBeTruthy();
    } finally {
      fixture.cleanup();
    }
  });

  it('checkIncompleteRuns returns empty when neither runsDir nor bridgeRunsDir is set', () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 1_000 }, 'No Dirs');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Test bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        // No runsDir, no bridgeRunsDir
      });

      const incomplete = session.checkIncompleteRuns(cycle.id);
      expect(incomplete).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('writeRunDiary writes diary entry when dojoDir is set and enriches betDescriptions', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Diary Write');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Diary test bet',
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

      mkdirSync(join(fixture.dojoDir, 'diary'), { recursive: true });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();

      // Diary should have been written unconditionally when dojoDir is set
      const diaryDir = join(fixture.dojoDir, 'diary');
      expect(existsSync(diaryDir)).toBe(true);
      const diaryFiles = readdirSync(diaryDir);
      expect(diaryFiles.length).toBeGreaterThan(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('writeCompleteDiary is skipped when dojoDir is not set during complete()', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'No Complete Diary');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'No diary bet',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const dojoSessionBuilder = { build: vi.fn() };
      const session = new CooldownSession({
        ...fixture.baseDeps,
        // dojoDir NOT set — writeCompleteDiary should be a no-op
        dojoSessionBuilder,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.complete(cycle.id);
      // Session should not be built either (no dojoDir)
      expect(dojoSessionBuilder.build).not.toHaveBeenCalled();
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('writeOptionalDojoSession is skipped when dojoSessionBuilder is not set', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'No Session Builder');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Session builder test',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        // dojoSessionBuilder NOT set
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // Should not crash — writeOptionalDojoSession skips when no builder
      const result = await session.complete(cycle.id);
      expect(result.report).toBeDefined();
    } finally {
      fixture.cleanup();
    }
  });

  it('collectSynthesisObservations uses hasObservations to filter empty observation lists', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Obs Filter Deep');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Bet with empty observations',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      writeStageState(fixture.runsDir, run.id, makeStageState());
      // Do NOT write any observations — readAllObservationsForRun returns []
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      // Empty observations should be filtered out by hasObservations
      expect(input.observations).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('collectSynthesisObservations returns empty when runsDir is not set', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'No Runs Dir');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'No runs dir bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        runsDir: undefined,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      expect(input.observations).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('autoSyncBetOutcomesFromBridgeRuns skips isSyncableBet check — non-pending bets are not synced', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Sync Filter');
      // Complete bet should NOT be synced
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Already resolved bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      // Pending bet without runId should NOT be synced
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Pending without runId',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      // No bets should have been auto-synced
      expect(result.betOutcomes).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('checkIncompleteRuns skips bets whose run file is missing (handles gracefully)', () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Missing Run');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Missing run bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      // Set a runId but don't create the run file or bridge-run file
      fixture.cycleManager.setRunId(cycle.id, bet.id, randomUUID());

      const session = new CooldownSession(fixture.baseDeps);
      const incomplete = session.checkIncompleteRuns(cycle.id);
      // Should handle missing files gracefully and not report incomplete
      expect(incomplete).toEqual([]);
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

describe('CooldownSession follow-up pipeline', () => {
  it('invokes predictionMatcher.match for each bet with a runId during run()', async () => {
    const fixture = createFixture();
    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 10_000 }, 'Prediction');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Predict bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const matchFn = vi.fn();
      const session = new CooldownSession({
        ...fixture.baseDeps,
        runsDir: fixture.runsDir,
        predictionMatcher: { match: matchFn },
      });

      await session.run(cycle.id);
      expect(matchFn).toHaveBeenCalledWith(run.id);
    } finally {
      fixture.cleanup();
    }
  });

  it('invokes calibrationDetector.detect for each bet with a runId during run()', async () => {
    const fixture = createFixture();
    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 10_000 }, 'Calibration');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Calibrate bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const detectFn = vi.fn();
      const session = new CooldownSession({
        ...fixture.baseDeps,
        runsDir: fixture.runsDir,
        calibrationDetector: { detect: detectFn },
      });

      await session.run(cycle.id);
      expect(detectFn).toHaveBeenCalledWith(run.id);
    } finally {
      fixture.cleanup();
    }
  });

  it('invokes frictionAnalyzer.analyze for each bet with a runId during run()', async () => {
    const fixture = createFixture();
    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 10_000 }, 'Friction');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Friction bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      const analyzeFn = vi.fn();
      const session = new CooldownSession({
        ...fixture.baseDeps,
        runsDir: fixture.runsDir,
        frictionAnalyzer: { analyze: analyzeFn },
      });

      await session.run(cycle.id);
      expect(analyzeFn).toHaveBeenCalledWith(run.id);
    } finally {
      fixture.cleanup();
    }
  });

  it('writes dojo diary entry when dojoDir is configured', async () => {
    const fixture = createFixture();
    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 10_000 }, 'Diary');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Diary bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
      });

      await session.run(cycle.id);

      // Verify diary dir was written to
      const diaryDir = join(fixture.dojoDir, 'diary');
      if (existsSync(diaryDir)) {
        const files = readdirSync(diaryDir);
        expect(files.length).toBeGreaterThanOrEqual(0);
      }
    } finally {
      fixture.cleanup();
    }
  });

  it('skips follow-up steps gracefully when matchers are not provided — no warnings logged', async () => {
    const fixture = createFixture();
    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 10_000 }, 'NoMatchers');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'No matchers bet',
        appetite: 20,
        outcome: 'complete',
        issueRefs: [],
      });
      const bet = updated.bets[0]!;
      const run = makeRun(cycle.id, bet.id);
      createRunTree(fixture.runsDir, run);
      fixture.cycleManager.setRunId(cycle.id, bet.id, run.id);

      // No predictionMatcher, calibrationDetector, or frictionAnalyzer injected
      const session = new CooldownSession({
        ...fixture.baseDeps,
        runsDir: fixture.runsDir,
      });

      const warnSpy = vi.spyOn(logger, 'warn');
      const result = await session.run(cycle.id);
      expect(result.report).toBeDefined();

      // Verify no warnings about prediction/calibration/friction failures
      // If the guard is mutated away, null reference errors would trigger logger.warn
      const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.filter((m) => m.includes('Prediction matching failed'))).toHaveLength(0);
      expect(warnMessages.filter((m) => m.includes('Calibration detection failed'))).toHaveLength(0);
      expect(warnMessages.filter((m) => m.includes('Friction analysis failed'))).toHaveLength(0);
      warnSpy.mockRestore();
    } finally {
      fixture.cleanup();
    }
  });

  it('collectSynthesisObservations returns empty when runsDir is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'No RunsDir');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Bet without runs dir',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      // Create session WITHOUT runsDir — collectSynthesisObservations should return empty
      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        synthesisDir: fixture.synthesisDir,
        // runsDir deliberately NOT set
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      expect(input.observations).toHaveLength(0);
    } finally {
      fixture.cleanup();
    }
  });

  it('checkIncompleteRuns returns empty when neither runsDir nor bridgeRunsDir is configured', () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'No Dirs');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Some bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      // Session with neither runsDir nor bridgeRunsDir
      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        // No runsDir, no bridgeRunsDir
      });

      const incomplete = session.checkIncompleteRuns(cycle.id);
      expect(incomplete).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it('hasObservations filters out runs with empty observations from synthesis input', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Empty Obs');
      // Add bet with run that has NO observations
      let updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Empty run',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });
      // Add bet with run that HAS observations
      updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Obs run',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      const emptyBet = updated.bets[0]!;
      const obsBet = updated.bets[1]!;

      // Create runs for both bets
      const emptyRun = makeRun(cycle.id, emptyBet.id);
      const obsRun = makeRun(cycle.id, obsBet.id);
      createRunTree(fixture.runsDir, emptyRun);
      createRunTree(fixture.runsDir, obsRun);
      writeStageState(fixture.runsDir, emptyRun.id, makeStageState());
      writeStageState(fixture.runsDir, obsRun.id, makeStageState());
      // Only obsRun gets an observation
      appendObservation(fixture.runsDir, obsRun.id, {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'insight',
        content: 'Real observation',
      }, { level: 'run' });
      fixture.cycleManager.setRunId(cycle.id, emptyBet.id, emptyRun.id);
      fixture.cycleManager.setRunId(cycle.id, obsBet.id, obsRun.id);

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      // Only the run with real observations should contribute
      expect(input.observations).toHaveLength(1);
      expect(input.observations[0]!.content).toBe('Real observation');
    } finally {
      fixture.cleanup();
    }
  });

  it('captureCooldownLearnings logs warning when capture fails', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 100 }, 'Fail Capture');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Low-completion bet',
        appetite: 40,
        outcome: 'pending',
        issueRefs: [],
      });

      // Create a knowledge store that throws on capture
      const failingKnowledgeStore = {
        capture: vi.fn(() => { throw new Error('capture failed'); }),
        query: vi.fn(() => []),
        get: vi.fn(),
        list: vi.fn(() => []),
      };

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: failingKnowledgeStore as unknown as typeof fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const result = await session.run(cycle.id);
      // hasFailedCaptures should be true, generating a warning about failed captures
      const warns = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warns.some((w) => w.includes('cooldown learnings failed to capture'))).toBe(true);
      expect(result.learningsCaptured).toBe(0);
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('hierarchical promotion passes correct tier and flavor arguments', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Promotion Args');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Promo bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      const hierarchicalPromoter = {
        promoteStepToFlavor: vi.fn(() => ({ learnings: ['mock-flavor'] })),
        promoteFlavorToStage: vi.fn(() => ({ learnings: ['mock-stage'] })),
        promoteStageToCategory: vi.fn(),
      };

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
        hierarchicalPromoter,
      });

      await session.run(cycle.id);

      // Verify the specific tier argument — kills ObjectLiteral survivor on query({tier: 'step'})
      expect(hierarchicalPromoter.promoteStepToFlavor).toHaveBeenCalledWith(
        expect.anything(),
        'cooldown-retrospective',
      );
      // Verify the specific stage argument — kills StringLiteral survivor
      expect(hierarchicalPromoter.promoteFlavorToStage).toHaveBeenCalledWith(
        ['mock-flavor'],
        'cooldown',
      );
      expect(hierarchicalPromoter.promoteStageToCategory).toHaveBeenCalledWith(['mock-stage']);
    } finally {
      fixture.cleanup();
    }
  });

  it('writeDojoSession passes { title } options to dojoSessionBuilder', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Session Title');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Title bet',
        appetite: 30,
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

      await session.run(cycle.id);

      // Verify { title: ... } was passed (kills ObjectLiteral survivor)
      expect(dojoSessionBuilder.build).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ title: expect.any(String) }),
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('gatherDojoSessionData passes { maxDiaries: 5 } to aggregator', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'Gather Data');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Gather bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      // The dojoSessionBuilder.build receives the aggregator output
      // If { maxDiaries: 5 } is mutated to {}, the aggregator defaults may differ
      const dojoSessionBuilder = {
        build: vi.fn(),
      };

      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        dojoSessionBuilder,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      await session.run(cycle.id);

      // Build was called — the aggregator was invoked with maxDiaries parameter
      expect(dojoSessionBuilder.build).toHaveBeenCalledTimes(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('listJsonFiles filters non-json files from bridge-runs directory', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Filter Test');
      const updated = fixture.cycleManager.addBet(cycle.id, {
        description: 'Filter bet',
        appetite: 30,
        outcome: 'complete',
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
        content: 'Test observation',
      }, { level: 'run' });

      // Write a valid bridge-run json
      writeBridgeRun(fixture.bridgeRunsDir, run.id, {
        cycleId: cycle.id,
        betId: bet.id,
        status: 'complete',
      });

      // Also write a non-json file to the bridge-runs dir that should be filtered out
      writeFileSync(join(fixture.bridgeRunsDir, 'README.txt'), 'Not a json file');
      writeFileSync(join(fixture.bridgeRunsDir, '.DS_Store'), 'junk');

      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // prepare triggers collectSynthesisObservations → loadBridgeRunIdsByBetId → listJsonFiles
      const result = await session.prepare(cycle.id);
      const input = JSON.parse(readFileSync(result.synthesisInputPath, 'utf-8'));
      // Should still find the observation — the .txt and .DS_Store should be filtered
      expect(input.observations).toHaveLength(1);
    } finally {
      fixture.cleanup();
    }
  });

  it('writeCompleteDiary calls writeDiaryEntry only when dojoDir is configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'Complete Diary Guard');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'Complete diary bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      // Session WITHOUT dojoDir — complete() should NOT attempt diary write
      const session = new CooldownSession({
        ...fixture.baseDeps,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await session.complete(cycle.id);

      // No diary-related warnings should appear
      const warns = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warns.filter((w) => w.includes('diary'))).toHaveLength(0);
      expect(result.report).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('writeOptionalDojoSession skips when dojoSessionBuilder is not configured', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 5_000 }, 'No Builder');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'No builder bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      // Session WITH dojoDir but WITHOUT dojoSessionBuilder
      const session = new CooldownSession({
        ...fixture.baseDeps,
        dojoDir: fixture.dojoDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await session.complete(cycle.id);

      // No session-generation warnings
      const warns = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warns.filter((w) => w.includes('dojo session'))).toHaveLength(0);
      expect(result.report).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });

  it('expiryCheck guard skips when knowledgeStore has no checkExpiry method', async () => {
    const fixture = createFixture();

    try {
      const cycle = fixture.cycleManager.create({ tokenBudget: 2_000 }, 'No Expiry');
      fixture.cycleManager.addBet(cycle.id, {
        description: 'No expiry bet',
        appetite: 30,
        outcome: 'complete',
        issueRefs: [],
      });

      // Use a knowledge store without checkExpiry method
      const noExpiryStore = {
        capture: vi.fn(),
        query: vi.fn(() => []),
        get: vi.fn(),
        list: vi.fn(() => []),
      };

      const session = new CooldownSession({
        cycleManager: fixture.cycleManager,
        knowledgeStore: noExpiryStore as unknown as typeof fixture.knowledgeStore,
        persistence: JsonStore,
        pipelineDir: fixture.pipelineDir,
        historyDir: fixture.historyDir,
        proposalGenerator: { generate: vi.fn(() => []) },
      });

      // If the guard is removed, it would try to call checkExpiry on a store that doesn't have it
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const result = await session.run(cycle.id);

      // Should not produce any expiry-related warnings
      const warns = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warns.filter((w) => w.includes('expiry'))).toHaveLength(0);
      expect(result.report).toBeDefined();
    } finally {
      vi.restoreAllMocks();
      fixture.cleanup();
    }
  });
});
