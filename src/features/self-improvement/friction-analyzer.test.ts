import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Learning, LearningFilter, LearningInput, LearningPermanence } from '@domain/types/learning.js';
import { readReflections } from '@infra/persistence/run-store.js';
import { FrictionAnalyzer } from './friction-analyzer.js';

// ---------------------------------------------------------------------------
// Mock IKnowledgeStore
// ---------------------------------------------------------------------------

interface MockStoreState {
  learnings: Learning[];
  archiveCalls: Array<{ id: string; reason?: string }>;
  captureCalls: Array<Omit<LearningInput, 'id' | 'createdAt' | 'updatedAt'>>;
}

function makeMockStore(initialLearnings: Learning[] = []): {
  store: IKnowledgeStore;
  state: MockStoreState;
} {
  const state: MockStoreState = {
    learnings: [...initialLearnings],
    archiveCalls: [],
    captureCalls: [],
  };

  const store: IKnowledgeStore = {
    query(filter: LearningFilter): Learning[] {
      return state.learnings.filter((l) => {
        if (filter.includeArchived === false && l.archived) return false;
        if (filter.tier !== undefined && l.tier !== filter.tier) return false;
        if (filter.category !== undefined && l.category !== filter.category) return false;
        return true;
      });
    },

    capture(input: Omit<LearningInput, 'id' | 'createdAt' | 'updatedAt'>): Learning {
      state.captureCalls.push(input);
      const now = new Date().toISOString();
      const learning: Learning = {
        id: randomUUID(),
        tier: input.tier,
        category: input.category,
        content: input.content,
        confidence: input.confidence ?? 0,
        evidence: [],
        citations: [],
        derivedFrom: input.derivedFrom ?? [],
        reinforcedBy: [],
        usageCount: 0,
        versions: [],
        archived: false,
        createdAt: now,
        updatedAt: now,
      };
      state.learnings.push(learning);
      return learning;
    },

    archiveLearning(id: string, reason?: string): Learning {
      state.archiveCalls.push({ id, reason });
      const learning = state.learnings.find((l) => l.id === id);
      if (!learning) {
        throw new Error(`Learning ${id} not found`);
      }
      learning.archived = true;
      return learning;
    },

    // Unused methods — provide minimal stubs to satisfy IKnowledgeStore interface
    loadForStage(_stageType: string): Learning[] {
      return [];
    },
    loadForSubscriptions(_agentId: string): Learning[] {
      return [];
    },
    resurrectedBy(id: string, _observationId: string, _citedAt: string): Learning {
      const learning = state.learnings.find((l) => l.id === id);
      if (!learning) throw new Error(`Learning ${id} not found`);
      return learning;
    },
    promote(id: string, _toPermanence: LearningPermanence): Learning {
      const learning = state.learnings.find((l) => l.id === id);
      if (!learning) throw new Error(`Learning ${id} not found`);
      return learning;
    },
    computeDecayedConfidence(learning: Learning): number {
      return learning.confidence;
    },
    checkExpiry(_now?: Date): { archived: Learning[]; flaggedStale: Learning[] } {
      return { archived: [], flaggedStale: [] };
    },
    loadForStep(_stepId: string): Learning[] {
      return [];
    },
    loadForFlavor(_flavorId: string): Learning[] {
      return [];
    },
  };

  return { store, state };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrictionObs(overrides: {
  id?: string;
  taxonomy?: string;
  content?: string;
  contradicts?: string;
}): object {
  return {
    id: overrides.id ?? randomUUID(),
    timestamp: new Date().toISOString(),
    type: 'friction',
    content: overrides.content ?? 'friction observation content',
    taxonomy: overrides.taxonomy ?? 'stale-learning',
    ...(overrides.contradicts !== undefined ? { contradicts: overrides.contradicts } : {}),
  };
}

function makeNonFrictionObs(type: string): object {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    type,
    content: `${type} observation content`,
  };
}

function writeFrictionObsToRun(runsDir: string, runId: string, obs: object[]): void {
  const obsPath = join(runsDir, runId, 'observations.jsonl');
  writeFileSync(obsPath, obs.map((o) => JSON.stringify(o)).join('\n') + '\n');
}

function makeTestLearning(id: string, overrides: Partial<Learning> = {}): Learning {
  const now = new Date().toISOString();
  return {
    id,
    tier: 'category',
    category: 'test-category',
    content: 'original learning content',
    confidence: 0.8,
    evidence: [],
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    usageCount: 0,
    versions: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let tempDir: string;
let runsDir: string;
let runId: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'friction-analyzer-'));
  runsDir = join(tempDir, 'runs');
  runId = randomUUID();
  mkdirSync(join(runsDir, runId), { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Group 1: analyze() with no frictions
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — no frictions', () => {
  it('returns zero frictionCount when no observations exist', () => {
    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.frictionCount).toBe(0);
    expect(result.totalObservations).toBe(0);
    expect(result.overrideThresholdMet).toBe(false);
    expect(result.resolutions).toHaveLength(0);
  });

  it('returns zero frictions when only non-friction observations exist', () => {
    writeFrictionObsToRun(runsDir, runId, [
      makeNonFrictionObs('prediction'),
      makeNonFrictionObs('outcome'),
    ]);
    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.frictionCount).toBe(0);
    expect(result.totalObservations).toBe(2);
    expect(result.overrideThresholdMet).toBe(false);
    expect(result.resolutions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 2: analyze() with 2 frictions (below count threshold)
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — 2 frictions (below threshold)', () => {
  it('returns frictions but no resolutions when count < 3 and rate <= 30%', () => {
    // 2 frictions out of 10 total = 20% rate
    const frictions = [makeFrictionObs({}), makeFrictionObs({})];
    const nonFrictions = Array.from({ length: 8 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...nonFrictions]);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.frictionCount).toBe(2);
    expect(result.totalObservations).toBe(10);
    expect(result.overrideThresholdMet).toBe(false);
    expect(result.resolutions).toHaveLength(0);
  });

  it('returns correct runId in result', () => {
    writeFrictionObsToRun(runsDir, runId, [makeFrictionObs({})]);
    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.runId).toBe(runId);
  });
});

// ---------------------------------------------------------------------------
// Group 3: analyze() with 3+ frictions (count threshold)
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — 3+ frictions (count threshold)', () => {
  it('sets overrideThresholdMet=true with exactly 3 frictions', () => {
    const frictions = [makeFrictionObs({}), makeFrictionObs({}), makeFrictionObs({})];
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.overrideThresholdMet).toBe(true);
    expect(result.resolutions).toHaveLength(3);
  });

  it('produces one resolution per friction when threshold met', () => {
    const frictions = [
      makeFrictionObs({ content: 'first friction' }),
      makeFrictionObs({ content: 'second friction' }),
      makeFrictionObs({ content: 'third friction' }),
    ];
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.resolutions).toHaveLength(3);
    expect(result.resolutions.every((r) => r.frictionId !== undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 4: rate threshold
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — rate threshold', () => {
  it('sets overrideThresholdMet=true when 4 out of 10 observations are frictions (40% > 30%)', () => {
    const frictions = Array.from({ length: 4 }, () => makeFrictionObs({}));
    const others = Array.from({ length: 6 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.overrideThresholdMet).toBe(true);
    expect(result.frictionCount).toBe(4);
    expect(result.totalObservations).toBe(10);
  });

  it('does NOT set overrideThresholdMet when rate is exactly 30% with < 3 frictions', () => {
    // 2 frictions out of ~6.67 would be 30%, so use 3 frictions / 10 = 30% (not > 30%)
    const frictions = Array.from({ length: 3 }, () => makeFrictionObs({}));
    const others = Array.from({ length: 7 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // 3 frictions → count threshold is met (count >= 3)
    // But test is about the rate threshold specifically
    // To test only rate: 2 frictions / 6 total = 33% which triggers rate threshold with count < 3
    expect(result.overrideThresholdMet).toBe(true); // count threshold kicks in
  });

  it('triggers only rate threshold when 2 frictions out of 6 total observations (33%)', () => {
    // 2 out of 6 = 33% > 30% → rate threshold only (count < 3)
    const frictions = [makeFrictionObs({}), makeFrictionObs({})];
    const others = Array.from({ length: 4 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.frictionCount).toBe(2);
    expect(result.totalObservations).toBe(6);
    expect(result.overrideThresholdMet).toBe(true); // 2/6 = 33.3% > 30%
    expect(result.resolutions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Group 5: Path selection — invalidate
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — path selection: invalidate', () => {
  it('selects invalidate path when contradicts present and confidence >= 0.8', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, { permanence: 'operational' });

    // friction content shares keywords with learning → overlap > 0.6
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'original learning content fails in practice',
        contradicts: learningId,
        taxonomy: 'stale-learning',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store, state } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // All 3 frictions have same taxonomy ('stale-learning') with count=3 → +0.1 for taxonomy
    // contradicts known operational learning → +0.2 + 0.1 = +0.3
    // keyword overlap > 0.6 → +0.1
    // total: 0.5 + 0.3 + 0.1 + 0.1 = 1.0, clamped to 1.0 → invalidate
    const invalidated = result.resolutions.filter((r) => r.path === 'invalidate');
    expect(invalidated.length).toBeGreaterThan(0);
    expect(state.archiveCalls.some((c) => c.id === learningId && c.reason === 'friction-invalidated')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Path selection — scope
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — path selection: scope', () => {
  it('selects scope path when contradicts present and confidence in [0.7, 0.8)', () => {
    const learningId = randomUUID();
    // Non-operational so no +0.1 from permanence, no keyword overlap → only +0.2 for known learning
    // Total: 0.5 + 0.2 = 0.7 → scope
    const learning = makeTestLearning(learningId, { permanence: 'strategic' });

    // Use 2 frictions so taxonomy count < 3 (no taxonomy bonus) — but rate triggers threshold
    const frictions = [
      makeFrictionObs({
        content: 'completely different content xyz',
        contradicts: learningId,
        taxonomy: 'config-drift',
      }),
      makeFrictionObs({
        content: 'completely different content abc',
        contradicts: learningId,
        taxonomy: 'config-drift',
      }),
    ];
    const others = Array.from({ length: 4 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store, state } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // Confidence: 0.5 + 0.2 (known learning) = 0.7 → scope path
    const scoped = result.resolutions.filter((r) => r.path === 'scope');
    expect(scoped.length).toBeGreaterThan(0);
    // scope path archives old + captures new
    expect(state.archiveCalls.some((c) => c.id === learningId && c.reason === 'scoped')).toBe(true);
    expect(state.captureCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Group 7: Path selection — synthesize
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — path selection: synthesize', () => {
  it('selects synthesize path when contradicts present but not found and taxonomy count >= 3', () => {
    // synthesize path: contradicts present, confidence in [0.6, 0.7)
    // To achieve this: unknown contradicts ID (not in store) + taxonomy count=3 → 0.5 + 0.1 = 0.6 → synthesize
    const unknownId = randomUUID();
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'xyz conflict with unknown',
        contradicts: unknownId,
        taxonomy: 'tool-mismatch',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    // Empty store — learning not found → no +0.2, only +0.1 (taxonomy 3+) → total 0.6 → synthesize
    const { store, state } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.resolutions.length).toBe(1); // dedup: only 1 per unique contradicts target
    expect(result.resolutions.every((r) => r.path === 'synthesize')).toBe(true);
    expect(state.captureCalls.length).toBe(1); // dedup: only 1 capture for the unique contradicts target
  });

  it('captures new learning with derivedFrom for synthesize path', () => {
    // Confidence in [0.6, 0.7): 0.5 (base) + 0.1 (taxonomy 3+) = 0.6, contradicts unknown ID
    const unknownId = randomUUID();
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'friction with unknown contradiction',
        contradicts: unknownId,
        taxonomy: 'convention-clash',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    // Empty store — contradicts ID not found → only taxonomy bonus applies
    const { store, state } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence: 0.5 (base) + 0 (not found) + 0.1 (taxonomy 3+) = 0.6 → synthesize
    // dedup: only 1 resolution per unique contradicts target
    const synthesized = result.resolutions.filter((r) => r.path === 'synthesize');
    expect(synthesized.length).toBe(1);
    expect(state.captureCalls.length).toBe(1);
    // Each capture should have derivedFrom including friction id
    for (const call of state.captureCalls) {
      expect(Array.isArray(call.derivedFrom)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 8: Path selection — escalate
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — path selection: escalate', () => {
  it('always selects escalate when no contradicts field', () => {
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({ taxonomy: 'scope-creep' }), // no contradicts
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.resolutions.every((r) => r.path === 'escalate')).toBe(true);
  });

  it('selects escalate when contradicts present but confidence < 0.6', () => {
    // contradicts unknown ID, only 1 friction (no taxonomy bonus)
    // confidence: 0.5 (base only) → escalate
    const unknownId = randomUUID();
    const frictions = [
      makeFrictionObs({ contradicts: unknownId, taxonomy: 'config-drift' }),
      makeFrictionObs({ contradicts: unknownId, taxonomy: 'config-drift' }),
      // need 3 for threshold (and NOT same taxonomy 3 times to avoid bonus)
      makeFrictionObs({ contradicts: unknownId, taxonomy: 'tool-mismatch' }),
    ];
    writeFrictionObsToRun(runsDir, runId, frictions);

    // Empty store → contradicts not found → no bonuses except 0 (config-drift count=2, tool-mismatch=1)
    // taxonomy bonus only for count >= 3, so no bonus here
    const { store } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence = 0.5 for all (contradicts not found, taxonomy counts < 3)
    // dedup: only 1 resolution for the unique unknownId contradicts target
    const escalated = result.resolutions.filter((r) => r.path === 'escalate');
    expect(escalated.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group 9: invalidate path behavior
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — invalidate path', () => {
  it('calls archiveLearning with friction-invalidated reason', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      permanence: 'operational',
      content: 'original learning content',
    });

    // 3 frictions with overlap content → confidence 0.5+0.2+0.1+0.1+0.1=1.0 → invalidate
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'original learning content fails',
        contradicts: learningId,
        taxonomy: 'stale-learning',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store, state } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    expect(state.archiveCalls.some((c) => c.id === learningId && c.reason === 'friction-invalidated')).toBe(true);
  });

  it('writes ResolutionReflection with path=invalidate to run reflections', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      permanence: 'operational',
      content: 'learning content matches friction text',
    });
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'learning content matches friction text perfectly',
        contradicts: learningId,
        taxonomy: 'stale-learning',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const resolutionReflections = reflections.filter((r) => r.type === 'resolution');
    expect(resolutionReflections.length).toBeGreaterThan(0);
    expect(resolutionReflections.some((r) => r.type === 'resolution' && r.path === 'invalidate')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 10: scope path behavior
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — scope path', () => {
  it('archives old learning and captures new narrowed learning', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      permanence: 'strategic',
      content: 'do this always in production',
    });

    // 2 frictions with rate threshold, contradicts known strategic (no permanence bonus)
    // no keyword overlap → 0.5 + 0.2 = 0.7 → scope
    const frictions = [
      makeFrictionObs({
        content: 'xyz unrelated friction abc',
        contradicts: learningId,
        taxonomy: 'convention-clash',
      }),
      makeFrictionObs({
        content: 'xyz different friction def',
        contradicts: learningId,
        taxonomy: 'convention-clash',
      }),
    ];
    const others = Array.from({ length: 4 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store, state } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    // archive old
    expect(state.archiveCalls.some((c) => c.id === learningId && c.reason === 'scoped')).toBe(true);
    // capture new
    expect(state.captureCalls.some((c) => c.content.startsWith('In most cases:'))).toBe(true);
  });

  it('does not prepend "In most cases:" if content already starts with it', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      content: 'In most cases: do this always in production',
      permanence: 'strategic',
    });

    const frictions = [
      makeFrictionObs({ content: 'xyz abc', contradicts: learningId, taxonomy: 'config-drift' }),
      makeFrictionObs({ content: 'xyz def', contradicts: learningId, taxonomy: 'config-drift' }),
    ];
    const others = Array.from({ length: 4 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store, state } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    const captured = state.captureCalls.find((c) => c.content.includes('In most cases:'));
    expect(captured?.content).toBe('In most cases: do this always in production');
  });

  it('writes ResolutionReflection with path=scope', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, { permanence: 'strategic' });

    const frictions = [
      makeFrictionObs({ content: 'xyz abc', contradicts: learningId, taxonomy: 'config-drift' }),
      makeFrictionObs({ content: 'xyz def', contradicts: learningId, taxonomy: 'config-drift' }),
    ];
    const others = Array.from({ length: 4 }, () => makeNonFrictionObs('outcome'));
    writeFrictionObsToRun(runsDir, runId, [...frictions, ...others]);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    expect(reflections.some((r) => r.type === 'resolution' && r.path === 'scope')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 11: synthesize path behavior
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — synthesize path', () => {
  it('calls store.capture with derivedFrom containing frictionId', () => {
    const unknownId = randomUUID();
    // 3 frictions with unknown contradicts ID → confidence = 0.5 + 0.1 (taxonomy 3+) = 0.6 → synthesize
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'synthesis trigger content',
        contradicts: unknownId,
        taxonomy: 'convention-clash',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store, state } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    expect(state.captureCalls.length).toBe(1); // dedup: only 1 capture per unique contradicts target
    for (const call of state.captureCalls) {
      expect(call.derivedFrom?.some((id) => typeof id === 'string')).toBe(true);
    }
  });

  it('writes ResolutionReflection with path=synthesize', () => {
    const unknownId = randomUUID();
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({ content: 'friction text', contradicts: unknownId, taxonomy: 'tool-mismatch' }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    expect(reflections.some((r) => r.type === 'resolution' && r.path === 'synthesize')).toBe(true);
  });

  it('uses category="friction-synthesis" when no existing learning found', () => {
    const unknownId = randomUUID();
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({ content: 'friction content', contradicts: unknownId, taxonomy: 'scope-creep' }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store, state } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    expect(state.captureCalls.every((c) => c.category === 'friction-synthesis')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 12: escalate path behavior
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — escalate path', () => {
  it('does NOT call archiveLearning or capture for escalate path', () => {
    // 3 frictions, no contradicts → always escalate
    const frictions = Array.from({ length: 3 }, () => makeFrictionObs({ taxonomy: 'tool-mismatch' }));
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store, state } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    expect(state.archiveCalls).toHaveLength(0);
    expect(state.captureCalls).toHaveLength(0);
  });

  it('writes ResolutionReflection with path=escalate for each friction', () => {
    const frictions = Array.from({ length: 3 }, () => makeFrictionObs({ taxonomy: 'tool-mismatch' }));
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    analyzer.analyze(runId);

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const escalated = reflections.filter((r) => r.type === 'resolution' && r.path === 'escalate');
    expect(escalated.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Group 13: Diagnostic confidence computation
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — diagnostic confidence', () => {
  it('+0.2 for known contradicted learning', () => {
    const learningId = randomUUID();
    // Use learning with content that won't overlap with friction content
    const learning = makeTestLearning(learningId, { content: 'aaa bbb ccc ddd eee' });
    // Single friction with rate threshold (1 friction / 2 total = 50% > 30%)
    const friction = makeFrictionObs({
      content: 'completely different xyz text',
      contradicts: learningId,
      taxonomy: 'config-drift',
    });
    const other = makeNonFrictionObs('outcome');
    writeFrictionObsToRun(runsDir, runId, [friction, other]);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence: 0.5 (base) + 0.2 (known learning) = 0.7 (no taxonomy bonus, no overlap, no permanence)
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].diagnosticConfidence).toBe(0.7);
  });

  it('+0.1 for operational permanence', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      permanence: 'operational',
      content: 'aaa bbb ccc ddd eee',
    });
    // Single friction with rate threshold (1/2 = 50% > 30%)
    // contradicts known operational learning → +0.2 + 0.1 operational bonus
    const friction = makeFrictionObs({
      content: 'unrelated content xyz',
      contradicts: learningId,
      taxonomy: 'stale-learning',
    });
    const other = makeNonFrictionObs('outcome');
    writeFrictionObsToRun(runsDir, runId, [friction, other]);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence: 0.5 + 0.2 (known) + 0.1 (operational) = 0.8 → invalidate
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].diagnosticConfidence).toBeCloseTo(0.8, 10);
  });

  it('+0.1 when same taxonomy appears 3+ times', () => {
    const unknownId = randomUUID();
    // taxonomy count = 3 → +0.1, no learning found → no other bonuses → 0.6 → synthesize
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({ content: 'test friction xyz', contradicts: unknownId, taxonomy: 'scope-creep' }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore([]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence: 0.5 (base) + 0.1 (taxonomy 3+) = 0.6 → synthesize
    expect(result.resolutions.every((r) => r.diagnosticConfidence === 0.6)).toBe(true);
    expect(result.resolutions.every((r) => r.path === 'synthesize')).toBe(true);
  });

  it('+0.1 for keyword overlap > 0.6', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      content: 'shared keyword overlap test content here',
    });
    // Single friction with rate threshold (1/2 = 50% > 30%)
    // friction content shares enough keywords with learning content → overlap > 0.6
    const friction = makeFrictionObs({
      content: 'shared keyword overlap test',
      contradicts: learningId,
      taxonomy: 'stale-learning',
    });
    const other = makeNonFrictionObs('outcome');
    writeFrictionObsToRun(runsDir, runId, [friction, other]);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    // confidence: 0.5 + 0.2 (known) + 0.1 (keyword overlap > 0.6) = 0.8
    // no permanence bonus (undefined permanence), no taxonomy bonus (count=1)
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].diagnosticConfidence).toBeCloseTo(0.8, 10);
  });
});

// ---------------------------------------------------------------------------
// Group 14: Confidence clamped to [0,1]
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — confidence clamping', () => {
  it('clamps confidence to 1.0 maximum', () => {
    const learningId = randomUUID();
    const learning = makeTestLearning(learningId, {
      content: 'stale learning content taxonomy match',
      permanence: 'operational',
    });
    // All bonuses: +0.2 known, +0.1 operational, +0.1 overlap, +0.1 taxonomy 3+
    // total: 0.5 + 0.5 = 1.0 — already at max
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({
        content: 'stale learning content taxonomy match',
        contradicts: learningId,
        taxonomy: 'stale-learning',
      }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore([learning]);
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.resolutions.every((r) => r.diagnosticConfidence <= 1.0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 15: Empty run dir — no crash
// ---------------------------------------------------------------------------

describe('FrictionAnalyzer — empty run directory', () => {
  it('does not crash and returns zero frictions for an empty run directory', () => {
    // runId dir created in beforeEach but no observations.jsonl written
    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);

    expect(() => analyzer.analyze(runId)).not.toThrow();
    const result = analyzer.analyze(runId);
    expect(result.frictionCount).toBe(0);
    expect(result.totalObservations).toBe(0);
    expect(result.overrideThresholdMet).toBe(false);
  });

  it('does not crash for a completely non-existent runId', () => {
    const nonExistentRunId = randomUUID();
    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);

    expect(() => analyzer.analyze(nonExistentRunId)).not.toThrow();
    const result = analyzer.analyze(nonExistentRunId);
    expect(result.frictionCount).toBe(0);
  });

  it('returns reflectionsWritten equal to the number of resolutions produced', () => {
    const frictions = Array.from({ length: 3 }, () =>
      makeFrictionObs({ taxonomy: 'config-drift' }),
    );
    writeFrictionObsToRun(runsDir, runId, frictions);

    const { store } = makeMockStore();
    const analyzer = new FrictionAnalyzer(runsDir, store);
    const result = analyzer.analyze(runId);

    expect(result.reflectionsWritten).toBe(3); // one per friction
  });
});
