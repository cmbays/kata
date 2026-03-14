import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { SynthesisInputSchema } from '@domain/types/synthesis.js';
import { appendObservation, createRunTree } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';
import type { Observation } from '@domain/types/observation.js';
import {
  CooldownSession,
  type CooldownSessionDeps,
  type BetOutcomeRecord,
} from './cooldown-session.js';

describe('CooldownSession.prepare()', () => {
  const baseDir = join(tmpdir(), `kata-cooldown-prepare-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');
  const synthesisDir = join(baseDir, 'synthesis');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;
  let session: CooldownSession;

  function makeDeps(overrides: Partial<CooldownSessionDeps> = {}): CooldownSessionDeps {
    return {
      cycleManager,
      knowledgeStore,
      persistence: JsonStore,
      pipelineDir,
      historyDir,
      synthesisDir,
      ...overrides,
    };
  }

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(pipelineDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });
    mkdirSync(synthesisDir, { recursive: true });

    cycleManager = new CycleManager(cyclesDir, JsonStore);
    knowledgeStore = new KnowledgeStore(knowledgeDir);
    session = new CooldownSession(makeDeps());
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns a synthesisInputId and synthesisInputPath', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Prepare Test');

    const result = await session.prepare(cycle.id);

    expect(result.synthesisInputId).toBeTruthy();
    expect(result.synthesisInputPath).toBeTruthy();
    expect(result.synthesisInputPath).toContain(`pending-${result.synthesisInputId}`);
  });

  it('writes a valid SynthesisInput JSON file to synthesisDir', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Write Test');
    cycleManager.addBet(cycle.id, {
      description: 'Feature X',
      appetite: 30,
      outcome: 'pending',
      issueRefs: [],
    });

    const result = await session.prepare(cycle.id);

    expect(existsSync(result.synthesisInputPath)).toBe(true);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validated = SynthesisInputSchema.safeParse(parsed);
    expect(validated.success).toBe(true);

    if (validated.success) {
      expect(validated.data.cycleId).toBe(cycle.id);
      expect(validated.data.depth).toBe('standard');
    }
  });

  it('uses the provided depth parameter', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 });

    const result = await session.prepare(cycle.id, [], 'thorough');

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.depth).toBe('thorough');
  });

  it('uses synthesisDepth from deps when depth not provided', async () => {
    const sessionWithDepth = new CooldownSession(makeDeps({ synthesisDepth: 'quick' }));
    const cycle = cycleManager.create({ tokenBudget: 50000 });

    const result = await sessionWithDepth.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.depth).toBe('quick');
  });

  it('transitions cycle to cooldown state (but NOT complete)', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 });

    await session.prepare(cycle.id);

    const updatedCycle = cycleManager.get(cycle.id);
    expect(updatedCycle.state).toBe('cooldown');
  });

  it('does NOT transition cycle to complete', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 });

    await session.prepare(cycle.id);

    const updatedCycle = cycleManager.get(cycle.id);
    expect(updatedCycle.state).not.toBe('complete');
  });

  it('returns report, proposals, learningsCaptured, betOutcomes', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Full Result Test');
    cycleManager.addBet(cycle.id, {
      description: 'Bet A',
      appetite: 40,
      outcome: 'complete',
      issueRefs: [],
    });

    const result = await session.prepare(cycle.id);

    expect(result.report).toBeDefined();
    expect(result.report.cycleId).toBe(cycle.id);
    expect(result.betOutcomes).toEqual([]);
    expect(Array.isArray(result.proposals)).toBe(true);
    expect(typeof result.learningsCaptured).toBe('number');
  });

  it('records provided bet outcomes', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    const withBet = cycleManager.addBet(cycle.id, {
      description: 'Auth feature',
      appetite: 30,
      outcome: 'pending',
      issueRefs: [],
    });
    const betId = withBet.bets[0]!.id;

    const outcomes: BetOutcomeRecord[] = [
      { betId, outcome: 'complete', notes: 'Shipped' },
    ];

    const result = await session.prepare(cycle.id, outcomes);

    expect(result.betOutcomes).toHaveLength(1);
    expect(result.betOutcomes[0]!.outcome).toBe('complete');

    // Verify the bet outcome was applied to the cycle
    const updatedCycle = cycleManager.get(cycle.id);
    expect(updatedCycle.bets[0]!.outcome).toBe('complete');
  });

  it('includes cycleName in the synthesis input', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'My Named Cycle');

    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.cycleName).toBe('My Named Cycle');
  });

  it('includes tokenBudget in the synthesis input', async () => {
    const cycle = cycleManager.create({ tokenBudget: 75000 });

    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.tokenBudget).toBe(75000);
  });

  it('includes current learnings from KnowledgeStore', async () => {
    knowledgeStore.capture({
      tier: 'stage',
      category: 'testing',
      content: 'Write tests before implementation',
      confidence: 0.8,
    });

    const cycle = cycleManager.create({ tokenBudget: 50000 });

    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.learnings).toHaveLength(1);
    expect(parsed.learnings[0]!.content).toBe('Write tests before implementation');
  });

  it('rolls back cycle state when prepare fails mid-way', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    cycleManager.updateState(cycle.id, 'active');

    vi.spyOn(cycleManager, 'generateCooldown').mockImplementation(() => {
      throw new Error('Simulated failure');
    });

    await expect(session.prepare(cycle.id)).rejects.toThrow('Simulated failure');

    expect(cycleManager.get(cycle.id).state).toBe('active');
  });

  it('works without synthesisDir (returns empty path)', async () => {
    const sessionNoSynthesis = new CooldownSession(makeDeps({ synthesisDir: undefined }));
    const cycle = cycleManager.create({ tokenBudget: 50000 });

    const result = await sessionNoSynthesis.prepare(cycle.id);

    expect(result.synthesisInputId).toBeTruthy(); // Still generates an ID
    expect(result.synthesisInputPath).toBe('');   // Empty path — no file written
  });
});

describe('CooldownSession.complete()', () => {
  const baseDir = join(tmpdir(), `kata-cooldown-complete-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');
  const synthesisDir = join(baseDir, 'synthesis');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;

  function makeDeps(overrides: Partial<CooldownSessionDeps> = {}): CooldownSessionDeps {
    return {
      cycleManager,
      knowledgeStore,
      persistence: JsonStore,
      pipelineDir,
      historyDir,
      synthesisDir,
      ...overrides,
    };
  }

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(pipelineDir, { recursive: true });
    mkdirSync(historyDir, { recursive: true });
    mkdirSync(synthesisDir, { recursive: true });

    cycleManager = new CycleManager(cyclesDir, JsonStore);
    knowledgeStore = new KnowledgeStore(knowledgeDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('transitions cycle to complete state', async () => {
    const session = new CooldownSession(makeDeps());
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    // First prepare (transitions to cooldown)
    await session.prepare(cycle.id);

    const result = await session.complete(cycle.id);

    expect(cycleManager.get(cycle.id).state).toBe('complete');
    expect(result.report).toBeDefined();
  });

  it('can be called without synthesis (no synthesisInputId)', async () => {
    const session = new CooldownSession(makeDeps());
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    // Manually transition to cooldown (simulating prepare was called)
    cycleManager.updateState(cycle.id, 'cooldown');

    const result = await session.complete(cycle.id);

    expect(cycleManager.get(cycle.id).state).toBe('complete');
    expect(result.synthesisProposals).toBeUndefined();
  });

  it('applies new-learning proposals from synthesis result', async () => {
    const session = new CooldownSession(makeDeps());
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    await session.prepare(cycle.id);

    // Write a synthesis result file
    const proposalId = crypto.randomUUID();
    const synthesisInputId = crypto.randomUUID();
    const synthesisResult = {
      inputId: synthesisInputId,
      proposals: [
        {
          id: proposalId,
          type: 'new-learning',
          confidence: 0.9,
          citations: [crypto.randomUUID(), crypto.randomUUID()],
          reasoning: 'Observed pattern multiple times',
          createdAt: new Date().toISOString(),
          proposedContent: 'Use dependency injection for testability',
          proposedTier: 'stage',
          proposedCategory: 'architecture',
        },
      ],
    };
    JsonStore.write(
      join(synthesisDir, `result-${synthesisInputId}.json`),
      synthesisResult,
      (await import('@domain/types/synthesis.js')).SynthesisResultSchema,
    );

    const result = await session.complete(cycle.id, synthesisInputId, [proposalId]);

    expect(result.synthesisProposals).toHaveLength(1);
    expect(result.synthesisProposals![0]!.type).toBe('new-learning');

    // Verify the new learning was captured
    const learnings = knowledgeStore.query({ category: 'architecture' });
    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.content).toBe('Use dependency injection for testability');
  });

  it('applies archive proposals from synthesis result', async () => {
    const session = new CooldownSession(makeDeps());
    const learning = knowledgeStore.capture({
      tier: 'stage',
      category: 'testing',
      content: 'Old pattern no longer valid',
      confidence: 0.5,
    });
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    await session.prepare(cycle.id);

    const proposalId = crypto.randomUUID();
    const synthesisInputId = crypto.randomUUID();
    const synthesisResult = {
      inputId: synthesisInputId,
      proposals: [
        {
          id: proposalId,
          type: 'archive',
          confidence: 0.85,
          citations: [crypto.randomUUID(), crypto.randomUUID()],
          reasoning: 'This approach was replaced',
          createdAt: new Date().toISOString(),
          targetLearningId: learning.id,
          reason: 'Replaced by newer approach',
        },
      ],
    };
    JsonStore.write(
      join(synthesisDir, `result-${synthesisInputId}.json`),
      synthesisResult,
      (await import('@domain/types/synthesis.js')).SynthesisResultSchema,
    );

    await session.complete(cycle.id, synthesisInputId, [proposalId]);

    const updated = knowledgeStore.get(learning.id);
    expect(updated.archived).toBe(true);
  });

  it('skips proposals not in acceptedProposalIds', async () => {
    const session = new CooldownSession(makeDeps());
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    await session.prepare(cycle.id);

    const proposalId1 = crypto.randomUUID();
    const proposalId2 = crypto.randomUUID();
    const synthesisInputId = crypto.randomUUID();
    const synthesisResult = {
      inputId: synthesisInputId,
      proposals: [
        {
          id: proposalId1,
          type: 'new-learning',
          confidence: 0.9,
          citations: [crypto.randomUUID(), crypto.randomUUID()],
          reasoning: 'Pattern A',
          createdAt: new Date().toISOString(),
          proposedContent: 'Accepted learning',
          proposedTier: 'stage',
          proposedCategory: 'architecture',
        },
        {
          id: proposalId2,
          type: 'new-learning',
          confidence: 0.9,
          citations: [crypto.randomUUID(), crypto.randomUUID()],
          reasoning: 'Pattern B',
          createdAt: new Date().toISOString(),
          proposedContent: 'Rejected learning',
          proposedTier: 'stage',
          proposedCategory: 'performance',
        },
      ],
    };
    JsonStore.write(
      join(synthesisDir, `result-${synthesisInputId}.json`),
      synthesisResult,
      (await import('@domain/types/synthesis.js')).SynthesisResultSchema,
    );

    // Only accept proposalId1
    const result = await session.complete(cycle.id, synthesisInputId, [proposalId1]);

    expect(result.synthesisProposals).toHaveLength(1);
    expect(result.synthesisProposals![0]!.id).toBe(proposalId1);

    // Only 'Accepted learning' should be in the store
    const archLearnings = knowledgeStore.query({ category: 'architecture' });
    const perfLearnings = knowledgeStore.query({ category: 'performance' });
    expect(archLearnings).toHaveLength(1);
    expect(perfLearnings).toHaveLength(0);
  });

  it('completes without error when synthesis result file does not exist', async () => {
    const session = new CooldownSession(makeDeps());
    const cycle = cycleManager.create({ tokenBudget: 50000 });
    cycleManager.updateState(cycle.id, 'cooldown');

    const result = await session.complete(cycle.id, crypto.randomUUID());

    expect(cycleManager.get(cycle.id).state).toBe('complete');
    expect(result.synthesisProposals).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Observation wiring: synthesis input collects observations from runs (#335)
// ---------------------------------------------------------------------------

describe('CooldownSession.prepare() — observation wiring', () => {
  const baseDir = join(tmpdir(), `kata-obs-wiring-test-${Date.now()}`);
  const cyclesDir = join(baseDir, 'cycles');
  const knowledgeDir = join(baseDir, 'knowledge');
  const pipelineDir = join(baseDir, 'pipelines');
  const historyDir = join(baseDir, 'history');
  const synthesisDir = join(baseDir, 'synthesis');
  const runsDir = join(baseDir, 'runs');
  const bridgeRunsDir = join(baseDir, 'bridge-runs');

  let cycleManager: CycleManager;
  let knowledgeStore: KnowledgeStore;

  function makeRun(cycleId: string, betId: string): Run {
    return {
      id: randomUUID(),
      cycleId,
      betId,
      betPrompt: 'Test bet',
      stageSequence: ['research', 'build'],
      currentStage: null,
      status: 'completed',
      startedAt: new Date().toISOString(),
    };
  }

  function makeObservation(content: string): Observation {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'insight',
      content,
    };
  }

  function writeBridgeRun(runId: string, betId: string, cycleId: string): void {
    const meta = { runId, betId, cycleId, cycleName: cycleId, stages: ['research', 'build'], isolation: 'shared', startedAt: new Date().toISOString(), status: 'complete' };
    writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify(meta, null, 2) + '\n');
  }

  function makeDeps(overrides: Partial<CooldownSessionDeps> = {}): CooldownSessionDeps {
    return {
      cycleManager,
      knowledgeStore,
      persistence: JsonStore,
      pipelineDir,
      historyDir,
      synthesisDir,
      runsDir,
      bridgeRunsDir,
      ...overrides,
    };
  }

  beforeEach(() => {
    for (const dir of [cyclesDir, knowledgeDir, pipelineDir, historyDir, synthesisDir, runsDir, bridgeRunsDir]) {
      mkdirSync(dir, { recursive: true });
    }
    cycleManager = new CycleManager(cyclesDir, JsonStore);
    knowledgeStore = new KnowledgeStore(knowledgeDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('includes run-level observations in synthesis input when bet.runId is set', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Obs Test');
    const withBet = cycleManager.addBet(cycle.id, { description: 'Bet A', appetite: 30, outcome: 'pending', issueRefs: [] });
    const bet = withBet.bets[0]!;

    const run = makeRun(cycle.id, bet.id);
    createRunTree(runsDir, run);
    cycleManager.setRunId(cycle.id, bet.id, run.id);

    const obs = makeObservation('Insight from run');
    appendObservation(runsDir, run.id, obs, { level: 'run' });

    const session = new CooldownSession(makeDeps());
    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const input = SynthesisInputSchema.parse(JSON.parse(raw));
    expect(input.observations).toHaveLength(1);
    expect(input.observations[0]!.content).toBe('Insight from run');
  });

  it('finds observations via bridge-run lookup when bet.runId is missing (staged workflow fix — #335)', async () => {
    // Simulate a staged-workflow cycle: bets have NO runId on the cycle record,
    // but bridge-run files exist with the betId → runId mapping.
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Staged Obs Test');
    const withBet = cycleManager.addBet(cycle.id, { description: 'Staged bet', appetite: 40, outcome: 'pending', issueRefs: [] });
    const bet = withBet.bets[0]!;

    // bet.runId is NOT set on the cycle (simulates pre-backfill staged launch)
    expect(cycleManager.get(cycle.id).bets[0]!.runId).toBeUndefined();

    const run = makeRun(cycle.id, bet.id);
    createRunTree(runsDir, run);
    // Write bridge-run file with the betId → runId mapping
    writeBridgeRun(run.id, bet.id, cycle.id);

    const obs = makeObservation('Discovered via bridge-run lookup');
    appendObservation(runsDir, run.id, obs, { level: 'run' });

    const session = new CooldownSession(makeDeps());
    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const input = SynthesisInputSchema.parse(JSON.parse(raw));
    expect(input.observations).toHaveLength(1);
    expect(input.observations[0]!.content).toBe('Discovered via bridge-run lookup');
  });

  it('collects stage-level observations in addition to run-level (#335)', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'All Levels Test');
    const withBet = cycleManager.addBet(cycle.id, { description: 'Multi-level bet', appetite: 30, outcome: 'pending', issueRefs: [] });
    const bet = withBet.bets[0]!;

    const run = makeRun(cycle.id, bet.id);
    createRunTree(runsDir, run);
    cycleManager.setRunId(cycle.id, bet.id, run.id);

    // Write observations at run level and stage level
    appendObservation(runsDir, run.id, makeObservation('Run-level insight'), { level: 'run' });
    appendObservation(runsDir, run.id, makeObservation('Research-stage insight'), { level: 'stage', category: 'research' });

    const session = new CooldownSession(makeDeps());
    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const input = SynthesisInputSchema.parse(JSON.parse(raw));
    expect(input.observations.length).toBeGreaterThanOrEqual(2);
    const contents = input.observations.map((o) => o.content);
    expect(contents).toContain('Run-level insight');
    expect(contents).toContain('Research-stage insight');
  });

  it('aggregates observations from all bets in the cycle', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Multi-Bet Test');
    const withBetA = cycleManager.addBet(cycle.id, { description: 'Bet A', appetite: 25, outcome: 'pending', issueRefs: [] });
    const withBetB = cycleManager.addBet(cycle.id, { description: 'Bet B', appetite: 25, outcome: 'pending', issueRefs: [] });
    const betA = withBetA.bets[0]!;
    const betB = withBetB.bets[1]!;

    const runA = makeRun(cycle.id, betA.id);
    const runB = makeRun(cycle.id, betB.id);
    createRunTree(runsDir, runA);
    createRunTree(runsDir, runB);
    cycleManager.setRunId(cycle.id, betA.id, runA.id);
    cycleManager.setRunId(cycle.id, betB.id, runB.id);

    appendObservation(runsDir, runA.id, makeObservation('From bet A'), { level: 'run' });
    appendObservation(runsDir, runB.id, makeObservation('From bet B'), { level: 'run' });

    const session = new CooldownSession(makeDeps());
    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const input = SynthesisInputSchema.parse(JSON.parse(raw));
    expect(input.observations.length).toBeGreaterThanOrEqual(2);
    const contents = input.observations.map((o) => o.content);
    expect(contents).toContain('From bet A');
    expect(contents).toContain('From bet B');
  });

  it('returns 0 observations when no runs or bridge-runs exist', async () => {
    const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Empty Obs Test');
    cycleManager.addBet(cycle.id, { description: 'No run bet', appetite: 30, outcome: 'pending', issueRefs: [] });

    const session = new CooldownSession(makeDeps());
    const result = await session.prepare(cycle.id);

    const raw = readFileSync(result.synthesisInputPath, 'utf-8');
    const input = SynthesisInputSchema.parse(JSON.parse(raw));
    expect(input.observations).toHaveLength(0);
  });

  describe('stale synthesis input cleanup (#330)', () => {
    it('removes a previous pending file for the same cycleId before writing a new one', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Stale Cleanup Test');
      const sessionA = new CooldownSession(makeDeps());

      // First --prepare run
      const first = await sessionA.prepare(cycle.id);
      expect(existsSync(first.synthesisInputPath)).toBe(true);

      // Reset to active so we can prepare again
      cycleManager.updateState(cycle.id, 'active');

      // Second --prepare run — stale file from first run should be removed
      const sessionA2 = new CooldownSession(makeDeps());
      const second = await sessionA2.prepare(cycle.id);
      expect(existsSync(second.synthesisInputPath)).toBe(true);
      expect(first.synthesisInputId).not.toBe(second.synthesisInputId);

      // The first pending file must be gone
      expect(existsSync(first.synthesisInputPath)).toBe(false);
    });

    it('only removes pending files matching the current cycleId, not other cycles', async () => {
      const cycleA = cycleManager.create({ tokenBudget: 50000 }, 'Cycle A');
      const cycleB = cycleManager.create({ tokenBudget: 50000 }, 'Cycle B');
      const sessionA = new CooldownSession(makeDeps());
      const sessionB = new CooldownSession(makeDeps());

      const resultA = await sessionA.prepare(cycleA.id);
      const resultB = await sessionB.prepare(cycleB.id);

      // Both pending files should still exist at this point
      expect(existsSync(resultA.synthesisInputPath)).toBe(true);
      expect(existsSync(resultB.synthesisInputPath)).toBe(true);

      // Re-prepare cycleA — should only remove cycleA's stale file
      cycleManager.updateState(cycleA.id, 'active');
      const sessionA2 = new CooldownSession(makeDeps());
      const resultA2 = await sessionA2.prepare(cycleA.id);

      expect(existsSync(resultA.synthesisInputPath)).toBe(false);
      expect(existsSync(resultA2.synthesisInputPath)).toBe(true);
      // CycleB's file must remain untouched
      expect(existsSync(resultB.synthesisInputPath)).toBe(true);
    });

    it('ignores unrelated files while cleaning stale synthesis inputs', async () => {
      const cycle = cycleManager.create({ tokenBudget: 50000 }, 'Ignore Other Files');
      const unrelatedPending = join(synthesisDir, 'pending-unrelated.json');
      const unrelatedResult = join(synthesisDir, 'result-stale.json');
      const notesFile = join(synthesisDir, 'notes.txt');

      writeFileSync(unrelatedPending, JSON.stringify({ cycleId: 'some-other-cycle' }));
      writeFileSync(unrelatedResult, JSON.stringify({ cycleId: cycle.id }));
      writeFileSync(notesFile, 'keep me');

      const result = await new CooldownSession(makeDeps()).prepare(cycle.id);

      expect(existsSync(unrelatedPending)).toBe(true);
      expect(existsSync(unrelatedResult)).toBe(true);
      expect(existsSync(notesFile)).toBe(true);
      expect(existsSync(result.synthesisInputPath)).toBe(true);
    });
  });
});
