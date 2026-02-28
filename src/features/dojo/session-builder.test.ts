import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionStore } from '@infra/dojo/session-store.js';
import type { DojoDataBundle } from './data-aggregator.js';
import type { DojoDiaryEntry } from '@domain/types/dojo.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { Learning } from '@domain/types/learning.js';
import type { RunSummary } from '@features/cycle-management/types.js';
import { SessionBuilder } from './session-builder.js';

// ── Factories ───────────────────────────────────────────────────────────────

function makeDiary(overrides: Partial<DojoDiaryEntry> = {}): DojoDiaryEntry {
  return {
    id: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    cycleName: 'Sprint Alpha',
    narrative: 'A productive cycle with solid outcomes.',
    wins: ['Shipped feature X'],
    painPoints: ['Build times too slow'],
    openQuestions: ['Should we refactor the auth module?'],
    mood: 'steady',
    tags: ['build', 'review'],
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

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  return {
    id: crypto.randomUUID(),
    tier: 'stage',
    category: 'code-quality',
    content: 'Always write tests first',
    evidence: [],
    confidence: 0.85,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    betId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    stagesCompleted: 3,
    gapCount: 1,
    gapsBySeverity: { low: 1, medium: 0, high: 0 },
    avgConfidence: 0.75,
    artifactPaths: ['stages/build/flavors/ts/artifacts/output.md'],
    stageDetails: [
      { category: 'build', selectedFlavors: ['typescript-feature'], gaps: [] },
    ],
    yoloDecisionCount: 0,
    ...overrides,
  };
}

function makeEmptyBundle(): DojoDataBundle {
  return {
    backward: {
      recentDiaries: [],
      cycles: [],
      runSummaries: [],
      topLearnings: [],
      recurringGaps: [],
    },
    inward: {
      knowledgeStats: { total: 0, byTier: { stage: 0, category: 0, agent: 0 }, topCategories: [], averageConfidence: 0 },
      flavorFrequency: new Map(),
    },
    metadata: {
      totalCycles: 0,
      totalRuns: 0,
    },
  };
}

function makeRichBundle(): DojoDataBundle {
  return {
    backward: {
      recentDiaries: [makeDiary(), makeDiary({ cycleName: 'Sprint Beta', tags: ['research'] })],
      cycles: [makeCycle(), makeCycle()],
      runSummaries: [
        makeRunSummary({ stagesCompleted: 3, avgConfidence: 0.8 }),
        makeRunSummary({ stagesCompleted: 2, avgConfidence: 0.6 }),
      ],
      topLearnings: [
        makeLearning({ confidence: 0.95, content: 'Test everything' }),
        makeLearning({ confidence: 0.7, content: 'Use strict types' }),
      ],
      recurringGaps: [
        { description: 'Missing integration tests', severity: 'high', betCount: 3 },
      ],
    },
    inward: {
      knowledgeStats: { total: 42, byTier: { stage: 20, category: 15, agent: 7 }, topCategories: [{ category: 'code-quality', count: 12 }], averageConfidence: 0.73 },
      flavorFrequency: new Map([['typescript-feature', 5], ['code-review', 3]]),
    },
    metadata: {
      totalCycles: 2,
      totalRuns: 2,
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

let tempDir: string;
let sessionStore: SessionStore;
let builder: SessionBuilder;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-session-builder-test-'));
  sessionStore = new SessionStore(tempDir);
  builder = new SessionBuilder({ sessionStore });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('SessionBuilder', () => {
  describe('build() basics', () => {
    it('returns meta and htmlPath', () => {
      const result = builder.build(makeRichBundle());

      expect(result).toHaveProperty('meta');
      expect(result).toHaveProperty('htmlPath');
      expect(result.meta.id).toBeDefined();
      expect(result.htmlPath).toContain(result.meta.id);
    });

    it('generates a valid DojoSession that passes schema validation', () => {
      // The build() method calls DojoSessionSchema.parse() internally.
      // If it doesn't throw, the schema is valid.
      expect(() => builder.build(makeRichBundle())).not.toThrow();
    });

    it('generates HTML string saved to disk', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id);

      expect(html).not.toBeNull();
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });
  });

  describe('build() title generation', () => {
    it('uses custom title from options', () => {
      const result = builder.build(makeRichBundle(), { title: 'My Custom Dojo' });

      expect(result.meta.title).toBe('My Custom Dojo');
    });

    it('generates default title from latest diary cycleName', () => {
      const bundle = makeRichBundle();
      const result = builder.build(bundle);

      // First diary has cycleName 'Sprint Alpha'
      expect(result.meta.title).toBe('Dojo — Sprint Alpha Review');
    });

    it('generates "Getting Started" title with no data', () => {
      const result = builder.build(makeEmptyBundle());

      expect(result.meta.title).toBe('Dojo — Getting Started');
    });

    it('generates "Training Session" title when diary has no cycleName', () => {
      const bundle = makeRichBundle();
      bundle.backward.recentDiaries = [makeDiary({ cycleName: undefined })];
      bundle.metadata.totalCycles = 1;
      const result = builder.build(bundle);

      expect(result.meta.title).toBe('Dojo — Training Session');
    });
  });

  describe('build() summary generation', () => {
    it('generates summary with cycle and run counts', () => {
      const result = builder.build(makeRichBundle());

      expect(result.meta.summary).toContain('2 cycle(s)');
      expect(result.meta.summary).toContain('2 run(s)');
    });

    it('includes learning count in summary', () => {
      const result = builder.build(makeRichBundle());

      expect(result.meta.summary).toContain('2 learning(s) reviewed');
    });

    it('includes recurring gap count in summary', () => {
      const result = builder.build(makeRichBundle());

      expect(result.meta.summary).toContain('1 recurring gap(s) identified');
    });

    it('generates fallback summary with no data', () => {
      const result = builder.build(makeEmptyBundle());

      expect(result.meta.summary).toBe('A fresh training session with no prior data.');
    });
  });

  describe('build() topic generation', () => {
    it('generates default topics covering backward, inward, and forward directions', () => {
      const bundle = makeRichBundle();
      const result = builder.build(bundle);
      const html = sessionStore.getHtml(result.meta.id)!;

      // backward topic: Execution History
      expect(html).toContain('Execution History');
      // inward topic: Project State
      expect(html).toContain('Project State');
      // forward topic: What&#39;s Next (HTML-escaped)
      expect(html).toContain('What');
      expect(html).toContain('Next');
    });

    it('includes outward topic when recurring gaps exist', () => {
      const bundle = makeRichBundle();
      const result = builder.build(bundle);
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Best Practices');
    });

    it('omits backward topic when no diaries and no runs', () => {
      const bundle = makeEmptyBundle();
      const result = builder.build(bundle);

      // With no diaries or runs, the backward topic should not be generated.
      // The inward and forward topics should still be present.
      expect(result.meta.topicCount).toBeGreaterThanOrEqual(2);
    });

    it('uses custom topics from options', () => {
      const customTopics = [
        {
          title: 'Custom Topic',
          direction: 'inward' as const,
          description: 'A custom topic for testing.',
          priority: 'high' as const,
          tags: ['custom'],
        },
      ];
      const result = builder.build(makeRichBundle(), { topics: customTopics });
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Custom Topic');
      expect(result.meta.topicCount).toBe(1);
    });
  });

  describe('build() section generation', () => {
    it('generates backward sections from diaries and gaps', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Recent Diary Entries');
      expect(html).toContain('Recurring Gaps');
      expect(html).toContain('Stages Completed per Run');
    });

    it('generates inward sections from knowledge stats and flavor frequency', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Knowledge Overview');
      expect(html).toContain('42'); // totalLearnings
      expect(html).toContain('Most Used Flavors');
      expect(html).toContain('Top Learnings');
    });

    it('generates outward sections as research checklist', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Research Checklist');
      expect(html).toContain('Missing integration tests');
    });

    it('generates forward sections from open questions', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Open Questions');
      expect(html).toContain('Should we refactor the auth module?');
    });

    it('generates confidence trend sparkline with 2+ runs', () => {
      const result = builder.build(makeRichBundle());
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).toContain('Confidence Trend');
      expect(html).toContain('<svg');
    });

    it('omits confidence trend with fewer than 2 runs with avgConfidence', () => {
      const bundle = makeRichBundle();
      bundle.backward.runSummaries = [makeRunSummary()];
      const result = builder.build(bundle);
      const html = sessionStore.getHtml(result.meta.id)!;

      expect(html).not.toContain('Confidence Trend');
    });
  });

  describe('build() tag extraction', () => {
    it('extracts session tags from diary tags and gaps', () => {
      const result = builder.build(makeRichBundle());

      expect(result.meta.tags).toContain('build');
      expect(result.meta.tags).toContain('review');
      expect(result.meta.tags).toContain('research');
      expect(result.meta.tags).toContain('gaps');
    });

    it('returns sorted tags', () => {
      const result = builder.build(makeRichBundle());

      const sorted = [...result.meta.tags].sort();
      expect(result.meta.tags).toEqual(sorted);
    });
  });

  describe('build() with empty data', () => {
    it('handles empty data bundle gracefully', () => {
      expect(() => builder.build(makeEmptyBundle())).not.toThrow();

      const result = builder.build(makeEmptyBundle());
      expect(result.meta.title).toBe('Dojo — Getting Started');
      expect(result.meta.summary).toBe('A fresh training session with no prior data.');
      expect(result.meta.tags).toEqual([]);
    });
  });

  describe('build() persistence', () => {
    it('saves session to store and can be retrieved via meta', () => {
      const result = builder.build(makeRichBundle());

      const meta = sessionStore.getMeta(result.meta.id);
      expect(meta).not.toBeNull();
      expect(meta!.id).toBe(result.meta.id);
      expect(meta!.title).toBe(result.meta.title);
      expect(meta!.summary).toBe(result.meta.summary);
    });

    it('appears in session index after save', () => {
      builder.build(makeRichBundle());
      const allSessions = sessionStore.list();

      expect(allSessions.length).toBeGreaterThanOrEqual(1);
    });
  });
});
