import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { KatakaObservabilityAggregator } from './kataka-observability-aggregator.js';
import { createRunTree } from '@infra/persistence/run-store.js';
import { appendObservation } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';
import type { Observation } from '@domain/types/observation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDirs(): { kataDir: string; runsDir: string; knowledgeDir: string } {
  const base = join(tmpdir(), `kata-obs-agg-${randomUUID()}`);
  const kataDir = join(base, '.kata');
  const runsDir = join(kataDir, 'runs');
  const knowledgeDir = join(kataDir, 'knowledge');
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(knowledgeDir, { recursive: true });
  return { kataDir, runsDir, knowledgeDir };
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'test bet',
    stageSequence: ['build'],
    currentStage: null,
    status: 'pending',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'insight',
    content: 'test observation',
    ...overrides,
  } as Observation;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KatakaObservabilityAggregator', () => {
  describe('computeStats — no runs', () => {
    it('returns zero stats when runsDir is empty', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);
      const katakaId = randomUUID();

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.katakaId).toBe(katakaId);
      expect(stats.katakaName).toBe('my-agent');
      expect(stats.observationCount).toBe(0);
      expect(stats.observationsByType).toEqual({});
      expect(stats.decisionCount).toBe(0);
      expect(stats.avgDecisionConfidence).toBe(0);
      expect(stats.agentLearningCount).toBe(0);
      expect(stats.lastRunId).toBeUndefined();
    });

    it('returns zero stats when runsDir does not exist', () => {
      const base = join(tmpdir(), `kata-no-dir-${randomUUID()}`);
      const runsDir = join(base, 'runs');
      const knowledgeDir = join(base, 'knowledge');

      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);
      const stats = agg.computeStats(randomUUID(), 'ghost-agent');

      expect(stats.observationCount).toBe(0);
    });
  });

  describe('computeStats — runs without matching katakaId', () => {
    it('ignores runs assigned to a different kataka', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const otherKatakaId = randomUUID();
      const run = makeRun({ katakaId: otherKatakaId });
      createRunTree(runsDir, run);

      // Record an observation attributed to the other kataka
      const obs = makeObservation({ katakaId: otherKatakaId });
      appendObservation(runsDir, run.id, obs, { level: 'run' });

      // Query for a different katakaId
      const myId = randomUUID();
      const stats = agg.computeStats(myId, 'my-agent');

      expect(stats.observationCount).toBe(0);
      expect(stats.lastRunId).toBeUndefined();
    });
  });

  describe('computeStats — matching runs', () => {
    it('counts observations attributed to the kataka', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const run = makeRun({ katakaId });
      createRunTree(runsDir, run);

      appendObservation(runsDir, run.id, makeObservation({ katakaId, type: 'insight' }), { level: 'run' });
      appendObservation(runsDir, run.id, makeObservation({ katakaId, type: 'insight' }), { level: 'run' });
      appendObservation(runsDir, run.id, makeObservation({ katakaId, type: 'prediction' }), { level: 'run' });

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.observationCount).toBe(3);
      expect(stats.observationsByType['insight']).toBe(2);
      expect(stats.observationsByType['prediction']).toBe(1);
    });

    it('counts stage-level observations attributed to the kataka', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const run = makeRun({ katakaId, stageSequence: ['build'] });
      createRunTree(runsDir, run);

      appendObservation(
        runsDir,
        run.id,
        makeObservation({ katakaId, type: 'friction', taxonomy: 'convention-clash' } as Observation),
        { level: 'stage', category: 'build' },
      );

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.observationCount).toBe(1);
      expect(stats.observationsByType['friction']).toBe(1);
    });

    it('does not count observations without katakaId', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const run = makeRun({ katakaId });
      createRunTree(runsDir, run);

      // Observation without katakaId — should not be counted
      appendObservation(runsDir, run.id, makeObservation({ katakaId: undefined, type: 'insight' }), { level: 'run' });
      // Observation with a different katakaId — also should not be counted
      appendObservation(runsDir, run.id, makeObservation({ katakaId: randomUUID(), type: 'insight' }), { level: 'run' });

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.observationCount).toBe(0);
    });

    it('sets lastRunId, lastRunCycleId, and lastActiveAt to the most recent run', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const earlier = makeRun({ katakaId, startedAt: '2026-01-01T00:00:00.000Z' });
      const later = makeRun({ katakaId, startedAt: '2026-02-01T00:00:00.000Z' });
      createRunTree(runsDir, earlier);
      createRunTree(runsDir, later);

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.lastRunId).toBe(later.id);
      expect(stats.lastRunCycleId).toBe(later.cycleId);
      expect(stats.lastActiveAt).toBe('2026-02-01T00:00:00.000Z');
    });

    it('aggregates observations across multiple matching runs', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const run1 = makeRun({ katakaId, startedAt: '2026-01-01T00:00:00.000Z' });
      const run2 = makeRun({ katakaId, startedAt: '2026-02-01T00:00:00.000Z' });
      createRunTree(runsDir, run1);
      createRunTree(runsDir, run2);

      appendObservation(runsDir, run1.id, makeObservation({ katakaId, type: 'insight' }), { level: 'run' });
      appendObservation(runsDir, run2.id, makeObservation({ katakaId, type: 'outcome' }), { level: 'run' });
      appendObservation(runsDir, run2.id, makeObservation({ katakaId, type: 'insight' }), { level: 'run' });

      const stats = agg.computeStats(katakaId, 'my-agent');

      expect(stats.observationCount).toBe(3);
      expect(stats.observationsByType['insight']).toBe(2);
      expect(stats.observationsByType['outcome']).toBe(1);
    });
  });

  describe('computeStats — decisions', () => {
    it('always returns decisionCount=0 and avgDecisionConfidence=0', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);
      const stats = agg.computeStats(randomUUID(), 'agent');

      expect(stats.decisionCount).toBe(0);
      expect(stats.avgDecisionConfidence).toBe(0);
    });
  });

  describe('computeStats — agent learnings', () => {
    it('returns agentLearningCount=0 when knowledge dir is empty', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const stats = agg.computeStats(randomUUID(), 'my-agent');

      expect(stats.agentLearningCount).toBe(0);
    });

    it('counts agent-tier learnings matching katakaName', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const katakaName = `agent-${randomUUID()}`;
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      // Write learning files directly into knowledge/learnings/
      const learningsDir = join(knowledgeDir, 'learnings');
      mkdirSync(learningsDir, { recursive: true });
      const now = new Date().toISOString();

      const makeLearning = (agentId: string) => ({
        id: randomUUID(),
        tier: 'agent',
        category: 'testing',
        content: 'a pattern',
        evidence: [],
        confidence: 0.8,
        citations: [],
        derivedFrom: [],
        reinforcedBy: [],
        usageCount: 0,
        versions: [],
        archived: false,
        agentId,
        createdAt: now,
        updatedAt: now,
      });

      const l1 = makeLearning(katakaName);
      const l2 = makeLearning(katakaName);
      const l3 = makeLearning('other-agent'); // different agent — should not count

      writeFileSync(join(learningsDir, `${l1.id}.json`), JSON.stringify(l1), 'utf-8');
      writeFileSync(join(learningsDir, `${l2.id}.json`), JSON.stringify(l2), 'utf-8');
      writeFileSync(join(learningsDir, `${l3.id}.json`), JSON.stringify(l3), 'utf-8');

      const stats = agg.computeStats(katakaId, katakaName);

      expect(stats.agentLearningCount).toBe(2);
    });

    it('excludes archived agent learnings', () => {
      const { runsDir, knowledgeDir } = makeDirs();
      const katakaId = randomUUID();
      const katakaName = `agent-${randomUUID()}`;
      const agg = new KatakaObservabilityAggregator(runsDir, knowledgeDir);

      const learningsDir = join(knowledgeDir, 'learnings');
      mkdirSync(learningsDir, { recursive: true });
      const now = new Date().toISOString();

      const active = {
        id: randomUUID(),
        tier: 'agent',
        category: 'testing',
        content: 'active pattern',
        evidence: [],
        confidence: 0.8,
        citations: [],
        derivedFrom: [],
        reinforcedBy: [],
        usageCount: 0,
        versions: [],
        archived: false,
        agentId: katakaName,
        createdAt: now,
        updatedAt: now,
      };

      const archived = {
        ...active,
        id: randomUUID(),
        archived: true,
      };

      writeFileSync(join(learningsDir, `${active.id}.json`), JSON.stringify(active), 'utf-8');
      writeFileSync(join(learningsDir, `${archived.id}.json`), JSON.stringify(archived), 'utf-8');

      const stats = agg.computeStats(katakaId, katakaName);

      // KnowledgeStore.loadForAgent uses query() which excludes archived by default
      expect(stats.agentLearningCount).toBe(1);
    });
  });
});
