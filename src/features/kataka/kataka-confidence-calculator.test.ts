import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { KatakaConfidenceCalculator } from './kataka-confidence-calculator.js';
import { KatakaConfidenceProfileSchema } from '@domain/types/kataka-confidence.js';
import { createRunTree, appendObservation } from '@infra/persistence/run-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { Run } from '@domain/types/run-state.js';
import type { Observation } from '@domain/types/observation.js';
import type { LearningInput } from '@domain/types/learning.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDirs() {
  const base = join(tmpdir(), `kata-conf-calc-${randomUUID()}`);
  const kataDir = join(base, '.kata');
  const runsDir = join(kataDir, 'runs');
  const knowledgeDir = join(kataDir, 'knowledge');
  const katakaDir = join(kataDir, 'kataka');
  mkdirSync(runsDir, { recursive: true });
  mkdirSync(knowledgeDir, { recursive: true });
  mkdirSync(katakaDir, { recursive: true });
  return { kataDir, runsDir, knowledgeDir, katakaDir };
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

function seedLearning(knowledgeDir: string, overrides: Partial<LearningInput> = {}) {
  const store = new KnowledgeStore(knowledgeDir);
  return store.capture({
    tier: 'agent',
    category: 'general',
    content: 'test learning',
    confidence: 0.8,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KatakaConfidenceCalculator', () => {
  describe('compute()', () => {
    it('returns a KatakaConfidenceProfile with correct structure', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();

      const profile = calc.compute(id, 'test-agent');

      expect(profile.katakaId).toBe(id);
      expect(profile.katakaName).toBe('test-agent');
      expect(typeof profile.computedAt).toBe('string');
      expect(profile.domainScores).toEqual({});
      expect(profile.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(profile.overallConfidence).toBeLessThanOrEqual(1);
      expect(profile.observationCount).toBeGreaterThanOrEqual(0);
      expect(profile.learningCount).toBeGreaterThanOrEqual(0);
    });

    it('profile passes KatakaConfidenceProfileSchema.parse', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });

      const profile = calc.compute(randomUUID(), 'test-agent');
      expect(() => KatakaConfidenceProfileSchema.parse(profile)).not.toThrow();
    });

    it('writes confidence.json to katakaDir/<katakaId>/', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();

      calc.compute(id, 'test-agent');

      const filePath = join(katakaDir, id, 'confidence.json');
      expect(existsSync(filePath)).toBe(true);
    });

    it('creates the kataka subdirectory if it does not exist', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();
      const subDir = join(katakaDir, id);

      expect(existsSync(subDir)).toBe(false);
      calc.compute(id, 'test-agent');
      expect(existsSync(subDir)).toBe(true);
    });

    it('returns 0 overallConfidence when no agent learnings exist', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });

      const profile = calc.compute(randomUUID(), 'test-agent');
      expect(profile.overallConfidence).toBe(0);
      expect(profile.learningCount).toBe(0);
    });

    it('computes overallConfidence as average of agent learning confidence values', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();

      // Seed learnings for this agent
      seedLearning(knowledgeDir, { agentId: 'my-agent', confidence: 0.6 });
      seedLearning(knowledgeDir, { agentId: 'my-agent', confidence: 0.8 });
      seedLearning(knowledgeDir, { agentId: 'my-agent', confidence: 1.0 });
      // A learning for a different agent — should be excluded
      seedLearning(knowledgeDir, { agentId: 'other-agent', confidence: 0.1 });

      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const profile = calc.compute(randomUUID(), 'my-agent');

      expect(profile.learningCount).toBe(3);
      expect(profile.overallConfidence).toBeCloseTo(0.8, 5);
    });

    it('counts observations attributed to this kataka', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const katakaId = randomUUID();

      // Create a run assigned to this kataka
      const run = makeRun({ katakaId });
      createRunTree(runsDir, run);
      appendObservation(runsDir, run.id, makeObservation({ katakaId }), { level: 'run' });
      appendObservation(runsDir, run.id, makeObservation({ katakaId }), { level: 'run' });

      // Another run for a different kataka
      const otherRun = makeRun({ katakaId: randomUUID() });
      createRunTree(runsDir, otherRun);
      appendObservation(runsDir, otherRun.id, makeObservation({ katakaId: otherRun.katakaId }), {
        level: 'run',
      });

      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const profile = calc.compute(katakaId, 'my-agent');

      expect(profile.observationCount).toBe(2);
    });

    it('handles missing runsDir gracefully (observationCount = 0)', () => {
      const base = join(tmpdir(), `kata-conf-calc-${randomUUID()}`);
      const knowledgeDir = join(base, '.kata', 'knowledge');
      const katakaDir = join(base, '.kata', 'kataka');
      mkdirSync(knowledgeDir, { recursive: true });
      mkdirSync(katakaDir, { recursive: true });
      // runsDir not created
      const runsDir = join(base, '.kata', 'runs-missing');

      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const profile = calc.compute(randomUUID(), 'test-agent');

      expect(profile.observationCount).toBe(0);
    });

    it('handles missing knowledgeDir gracefully (learningCount = 0, overallConfidence = 0)', () => {
      const base = join(tmpdir(), `kata-conf-calc-${randomUUID()}`);
      const runsDir = join(base, '.kata', 'runs');
      const katakaDir = join(base, '.kata', 'kataka');
      mkdirSync(runsDir, { recursive: true });
      mkdirSync(katakaDir, { recursive: true });
      // knowledgeDir not created — will cause KnowledgeStore to fail
      const knowledgeDir = join(base, '.kata', 'knowledge-missing');

      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const profile = calc.compute(randomUUID(), 'test-agent');

      expect(profile.overallConfidence).toBe(0);
      expect(profile.learningCount).toBe(0);
    });

    it('creates distinct profiles for different katakaIds', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });

      const id1 = randomUUID();
      const id2 = randomUUID();

      seedLearning(knowledgeDir, { agentId: 'agent-a', confidence: 0.9 });
      seedLearning(knowledgeDir, { agentId: 'agent-b', confidence: 0.3 });

      const p1 = calc.compute(id1, 'agent-a');
      const p2 = calc.compute(id2, 'agent-b');

      expect(p1.katakaId).toBe(id1);
      expect(p2.katakaId).toBe(id2);
      expect(p1.overallConfidence).not.toBe(p2.overallConfidence);
      expect(existsSync(join(katakaDir, id1, 'confidence.json'))).toBe(true);
      expect(existsSync(join(katakaDir, id2, 'confidence.json'))).toBe(true);
    });
  });

  describe('load()', () => {
    it('returns null when file does not exist', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });

      expect(calc.load(randomUUID())).toBeNull();
    });

    it('returns profile when file exists (written by compute)', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();

      const computed = calc.compute(id, 'test-agent');
      const loaded = calc.load(id);

      expect(loaded).not.toBeNull();
      expect(loaded!.katakaId).toBe(computed.katakaId);
      expect(loaded!.overallConfidence).toBe(computed.overallConfidence);
    });

    it('returns null when file is corrupted', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();
      const dir = join(katakaDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'confidence.json'), 'not valid json');

      expect(calc.load(id)).toBeNull();
    });

    it('returns null when file has invalid schema data', () => {
      const { runsDir, knowledgeDir, katakaDir } = makeDirs();
      const calc = new KatakaConfidenceCalculator({ runsDir, knowledgeDir, katakaDir });
      const id = randomUUID();
      const dir = join(katakaDir, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'confidence.json'), JSON.stringify({ bad: 'data' }));

      expect(calc.load(id)).toBeNull();
    });
  });
});
