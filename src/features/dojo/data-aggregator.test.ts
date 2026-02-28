import type { Cycle } from '@domain/types/cycle.js';
import type { Learning } from '@domain/types/learning.js';
import type { DojoDiaryEntry } from '@domain/types/dojo.js';
import type { IDiaryStore } from '@domain/ports/diary-store.js';
import type { CycleManager } from '@domain/services/cycle-manager.js';
import { DataAggregator, type DataAggregatorDeps, type IDojoKnowledgeStore } from './data-aggregator.js';

// ── Factories ───────────────────────────────────────────────────────────────

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  return {
    id: crypto.randomUUID(),
    tier: 'stage',
    category: 'code-quality',
    content: 'Always write tests first',
    evidence: [],
    confidence: 0.8,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDiary(overrides: Partial<DojoDiaryEntry> = {}): DojoDiaryEntry {
  return {
    id: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    cycleName: 'Sprint Alpha',
    narrative: 'A productive cycle.',
    wins: ['Shipped feature X'],
    painPoints: [],
    openQuestions: ['Should we refactor?'],
    mood: 'steady',
    tags: ['build'],
    createdAt: '2026-02-20T12:00:00.000Z',
    ...overrides,
  };
}

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: crypto.randomUUID(),
    budget: { tokenBudget: 100000 },
    bets: [],
    pipelineMappings: [],
    state: 'complete',
    cooldownReserve: 10,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    ...overrides,
  };
}

function makeBet(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    description: 'Build the thing',
    appetite: 40,
    outcome: 'complete' as const,
    ...overrides,
  };
}

// ── Mock deps ───────────────────────────────────────────────────────────────

function makeMockDeps(overrides: Partial<DataAggregatorDeps> = {}): DataAggregatorDeps {
  const knowledgeStore: IDojoKnowledgeStore = {
    loadForStage: vi.fn().mockReturnValue([]),
    loadForSubscriptions: vi.fn().mockReturnValue([]),
    capture: vi.fn().mockReturnValue({} as Learning),
    query: vi.fn().mockReturnValue([]),
    stats: vi.fn().mockReturnValue({
      total: 0,
      byTier: { stage: 0, category: 0, agent: 0 },
      topCategories: [],
      averageConfidence: 0,
    }),
  };

  const diaryStore = {
    recent: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    write: vi.fn(),
    readByCycleId: vi.fn().mockReturnValue(null),
  } as unknown as IDiaryStore;

  const cycleManager = {
    list: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    getBudgetStatus: vi.fn(),
  } as unknown as CycleManager;

  return {
    knowledgeStore,
    diaryStore,
    cycleManager,
    runsDir: '/tmp/kata-test-runs',
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DataAggregator', () => {
  describe('gather() structure', () => {
    it('returns a bundle with backward, inward, and metadata fields', () => {
      const deps = makeMockDeps();
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle).toHaveProperty('backward');
      expect(bundle).toHaveProperty('inward');
      expect(bundle).toHaveProperty('metadata');
      expect(bundle.backward).toHaveProperty('recentDiaries');
      expect(bundle.backward).toHaveProperty('cycles');
      expect(bundle.backward).toHaveProperty('runSummaries');
      expect(bundle.backward).toHaveProperty('topLearnings');
      expect(bundle.backward).toHaveProperty('recurringGaps');
      expect(bundle.inward).toHaveProperty('knowledgeStats');
      expect(bundle.inward).toHaveProperty('flavorFrequency');
      expect(bundle.metadata).toHaveProperty('totalCycles');
      expect(bundle.metadata).toHaveProperty('totalRuns');
    });
  });

  describe('gather() with no data', () => {
    it('handles no cycles gracefully', () => {
      const deps = makeMockDeps();
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.cycles).toEqual([]);
      expect(bundle.backward.runSummaries).toEqual([]);
      expect(bundle.backward.recurringGaps).toEqual([]);
      expect(bundle.metadata.totalCycles).toBe(0);
      expect(bundle.metadata.totalRuns).toBe(0);
    });

    it('returns empty flavor frequency with no runs', () => {
      const deps = makeMockDeps();
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.inward.flavorFrequency.size).toBe(0);
    });
  });

  describe('gather() with cycles', () => {
    it('handles cycles without bets', () => {
      const cycle = makeCycle({ bets: [] });
      const deps = makeMockDeps();
      vi.mocked(deps.cycleManager.list).mockReturnValue([cycle]);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.cycles).toHaveLength(1);
      expect(bundle.backward.runSummaries).toEqual([]);
      expect(bundle.metadata.totalCycles).toBe(1);
      expect(bundle.metadata.totalRuns).toBe(0);
    });

    it('skips bets without runIds', () => {
      const cycle = makeCycle({
        bets: [
          makeBet({ runId: undefined }),
          makeBet({ runId: undefined }),
        ],
      });
      const deps = makeMockDeps();
      vi.mocked(deps.cycleManager.list).mockReturnValue([cycle]);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.runSummaries).toEqual([]);
      expect(bundle.metadata.totalRuns).toBe(0);
    });
  });

  describe('gather() diary options', () => {
    it('respects maxDiaries option', () => {
      const diaries = Array.from({ length: 10 }, (_, i) =>
        makeDiary({ narrative: `Diary ${i}` }),
      );
      const deps = makeMockDeps();
      vi.mocked(deps.diaryStore.recent).mockReturnValue(diaries.slice(0, 3));
      const aggregator = new DataAggregator(deps);
      aggregator.gather({ maxDiaries: 3 });

      expect(deps.diaryStore.recent).toHaveBeenCalledWith(3);
    });

    it('defaults maxDiaries to 5', () => {
      const deps = makeMockDeps();
      const aggregator = new DataAggregator(deps);
      aggregator.gather();

      expect(deps.diaryStore.recent).toHaveBeenCalledWith(5);
    });
  });

  describe('gather() learnings', () => {
    it('respects maxLearnings option', () => {
      const learnings = Array.from({ length: 30 }, (_, i) =>
        makeLearning({ confidence: i / 30 }),
      );
      const deps = makeMockDeps();
      vi.mocked(deps.knowledgeStore.query).mockReturnValue(learnings);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather({ maxLearnings: 10 });

      expect(bundle.backward.topLearnings).toHaveLength(10);
    });

    it('defaults maxLearnings to 20', () => {
      const learnings = Array.from({ length: 25 }, (_, i) =>
        makeLearning({ confidence: i / 25 }),
      );
      const deps = makeMockDeps();
      vi.mocked(deps.knowledgeStore.query).mockReturnValue(learnings);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.topLearnings).toHaveLength(20);
    });

    it('sorts learnings by confidence descending', () => {
      const learnings = [
        makeLearning({ confidence: 0.3 }),
        makeLearning({ confidence: 0.9 }),
        makeLearning({ confidence: 0.6 }),
      ];
      const deps = makeMockDeps();
      vi.mocked(deps.knowledgeStore.query).mockReturnValue(learnings);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.topLearnings[0]!.confidence).toBe(0.9);
      expect(bundle.backward.topLearnings[1]!.confidence).toBe(0.6);
      expect(bundle.backward.topLearnings[2]!.confidence).toBe(0.3);
    });
  });

  describe('gather() recurring gaps', () => {
    it('returns empty recurring gaps with fewer than 2 runs', () => {
      const deps = makeMockDeps();
      // No cycles means no runs
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.recurringGaps).toEqual([]);
    });
  });

  describe('gather() knowledge stats', () => {
    it('passes knowledge stats through from the store', () => {
      const deps = makeMockDeps();
      const expectedStats = {
        total: 42,
        byTier: { stage: 20, category: 15, agent: 7 },
        topCategories: [{ category: 'code-quality', count: 12 }],
        averageConfidence: 0.73,
      };
      vi.mocked(deps.knowledgeStore.stats).mockReturnValue(expectedStats);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.inward.knowledgeStats).toEqual(expectedStats);
    });
  });

  describe('gather() metadata', () => {
    it('reports correct totalCycles count', () => {
      const deps = makeMockDeps();
      vi.mocked(deps.cycleManager.list).mockReturnValue([
        makeCycle(),
        makeCycle(),
        makeCycle(),
      ]);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.metadata.totalCycles).toBe(3);
    });

    it('reports correct totalRuns count (0 when no bets have runIds)', () => {
      const deps = makeMockDeps();
      vi.mocked(deps.cycleManager.list).mockReturnValue([
        makeCycle({ bets: [makeBet()] }),
      ]);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      // Bets without runId are skipped, so totalRuns = 0
      expect(bundle.metadata.totalRuns).toBe(0);
    });
  });

  describe('gather() error handling', () => {
    it('gracefully handles failed run loads and continues', () => {
      const runId = crypto.randomUUID();
      const cycle = makeCycle({
        bets: [makeBet({ runId })],
      });
      const deps = makeMockDeps();
      vi.mocked(deps.cycleManager.list).mockReturnValue([cycle]);

      // readRun will throw because runsDir doesn't exist / no files
      // The DataAggregator should catch and log warning, not throw
      const aggregator = new DataAggregator(deps);
      expect(() => aggregator.gather()).not.toThrow();

      const bundle = aggregator.gather();
      expect(bundle.backward.runSummaries).toEqual([]);
    });
  });

  describe('gather() diary data', () => {
    it('passes diary entries through from the store', () => {
      const diaries = [makeDiary(), makeDiary()];
      const deps = makeMockDeps();
      vi.mocked(deps.diaryStore.recent).mockReturnValue(diaries);
      const aggregator = new DataAggregator(deps);
      const bundle = aggregator.gather();

      expect(bundle.backward.recentDiaries).toHaveLength(2);
      expect(bundle.backward.recentDiaries).toEqual(diaries);
    });
  });
});
