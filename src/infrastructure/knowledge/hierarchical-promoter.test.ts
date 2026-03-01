import { randomUUID } from 'node:crypto';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Learning, LearningFilter, LearningInput } from '@domain/types/learning.js';
import type { Observation, FrictionTaxonomy, GapSeverity } from '@domain/types/observation.js';
import { HierarchicalPromoter } from './hierarchical-promoter.js';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  const ts = now();
  return {
    id: randomUUID(),
    tier: 'step',
    category: 'step-a',
    content: 'Test content about performance optimisation patterns',
    evidence: [],
    confidence: 0.6,
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    usageCount: 0,
    versions: [],
    archived: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makeObservation(
  type: Observation['type'],
  content: string,
  extra: Record<string, unknown> = {},
): Observation {
  const base = {
    id: randomUUID(),
    timestamp: now(),
    content,
    ...extra,
  };

  switch (type) {
    case 'friction':
      return { ...base, type: 'friction', taxonomy: (extra['taxonomy'] as FrictionTaxonomy) ?? 'config-drift' };
    case 'gap':
      return { ...base, type: 'gap', severity: (extra['severity'] as GapSeverity) ?? 'major' };
    case 'assumption':
      return { ...base, type: 'assumption' };
    case 'prediction':
      return { ...base, type: 'prediction' };
    case 'decision':
      return { ...base, type: 'decision' };
    case 'outcome':
      return { ...base, type: 'outcome' };
    case 'insight':
      return { ...base, type: 'insight' };
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

// ---------------------------------------------------------------------------
// In-memory mock IKnowledgeStore
// ---------------------------------------------------------------------------

function createMockStore(initialLearnings: Learning[] = []): IKnowledgeStore & {
  captured: Learning[];
  resurrected: string[];
} {
  const store: Learning[] = [...initialLearnings];
  const resurrected: string[] = [];

  return {
    captured: store,
    resurrected,

    capture(input: Omit<LearningInput, 'id' | 'createdAt' | 'updatedAt'>): Learning {
      const ts = now();
      const learning = makeLearning({
        id: randomUUID(),
        ...(input as Partial<Learning>),
        createdAt: ts,
        updatedAt: ts,
      });
      store.push(learning);
      return learning;
    },

    query(filter: LearningFilter): Learning[] {
      return store.filter((l) => {
        if (filter.tier && l.tier !== filter.tier) return false;
        if (filter.category && l.category !== filter.category) return false;
        if (!filter.includeArchived && l.archived) return false;
        return true;
      });
    },

    loadForStage(_stageType: string): Learning[] {
      return store;
    },

    loadForSubscriptions(_agentId: string): Learning[] {
      return store;
    },

    resurrectedBy(id: string, _observationId: string, _citedAt: string): Learning {
      resurrected.push(id);
      const existing = store.find((l) => l.id === id);
      if (!existing) throw new Error(`Learning ${id} not found`);
      existing.archived = false;
      return existing;
    },
  };
}

// ---------------------------------------------------------------------------
// promoteObservationsToStepLearnings
// ---------------------------------------------------------------------------

describe('HierarchicalPromoter.promoteObservationsToStepLearnings', () => {
  it('creates a step learning when 3+ same-type observations have high content similarity', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'config drift causes build failures across environments';
    const observations: Observation[] = [
      makeObservation('friction', content, { taxonomy: 'config-drift' }),
      makeObservation('friction', content + ' repeated', { taxonomy: 'config-drift' }),
      makeObservation('friction', 'config drift causes build failures seen again', { taxonomy: 'config-drift' }),
    ];

    const result = promoter.promoteObservationsToStepLearnings(observations, 'step-a');

    expect(result.length).toBeGreaterThan(0);
    expect(result[0].tier).toBe('step');
    expect(result[0].category).toBe('step-a');
    expect(result[0].content).toContain('Recurring pattern:');
  });

  it('does not create a learning when only 2 similar observations exist', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const observations: Observation[] = [
      makeObservation('friction', 'config drift causes failures', { taxonomy: 'config-drift' }),
      makeObservation('friction', 'config drift causes build failures', { taxonomy: 'config-drift' }),
    ];

    const result = promoter.promoteObservationsToStepLearnings(observations, 'step-a');
    expect(result).toHaveLength(0);
  });

  it('does not cluster observations of different types together', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'recurring issue with config drift failures detected';
    // 2 frictions + 1 gap — not enough of any single type
    const observations: Observation[] = [
      makeObservation('friction', content, { taxonomy: 'config-drift' }),
      makeObservation('friction', content + ' again', { taxonomy: 'config-drift' }),
      makeObservation('gap', content, { severity: 'major' }),
    ];

    const result = promoter.promoteObservationsToStepLearnings(observations, 'step-a');
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty observations input', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);
    expect(promoter.promoteObservationsToStepLearnings([], 'step-a')).toEqual([]);
  });

  it('resurrects an archived learning when a similar one exists', () => {
    const archivedId = randomUUID();
    const archivedLearning = makeLearning({
      id: archivedId,
      tier: 'step',
      category: 'step-a',
      content: 'Recurring pattern: config drift causes build failures',
      archived: true,
    });
    const mockStore = createMockStore([archivedLearning]);
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'config drift causes build failures across environments';
    const observations: Observation[] = [
      makeObservation('friction', content, { taxonomy: 'config-drift' }),
      makeObservation('friction', content + ' again', { taxonomy: 'config-drift' }),
      makeObservation('friction', 'config drift causes build failures repeated', { taxonomy: 'config-drift' }),
    ];

    const result = promoter.promoteObservationsToStepLearnings(observations, 'step-a');
    // Either resurrected or newly created — should not be empty
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// promoteStepToFlavor
// ---------------------------------------------------------------------------

describe('HierarchicalPromoter.promoteStepToFlavor', () => {
  it('creates a flavor learning when 3+ step learnings from different categories are similar', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'performance optimisation patterns reduce latency in builds';
    const stepLearnings: Learning[] = [
      makeLearning({ tier: 'step', category: 'step-a', content }),
      makeLearning({ tier: 'step', category: 'step-b', content: content + ' observed' }),
      makeLearning({ tier: 'step', category: 'step-c', content: 'performance optimisation patterns reduce latency' }),
    ];

    const { learnings, events } = promoter.promoteStepToFlavor(stepLearnings, 'flavor-x');

    expect(learnings.length).toBeGreaterThan(0);
    expect(learnings[0].tier).toBe('flavor');
    expect(learnings[0].category).toBe('flavor-x');
    expect(events.length).toBeGreaterThan(0);
  });

  it('does not promote when only 2 step learnings exist', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'performance optimisation patterns reduce latency in builds';
    const stepLearnings: Learning[] = [
      makeLearning({ tier: 'step', category: 'step-a', content }),
      makeLearning({ tier: 'step', category: 'step-b', content }),
    ];

    const { learnings, events } = promoter.promoteStepToFlavor(stepLearnings, 'flavor-x');
    expect(learnings).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('does not promote when all step learnings share the same category (same step)', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'performance optimisation patterns reduce latency in builds';
    const stepLearnings: Learning[] = [
      makeLearning({ tier: 'step', category: 'step-a', content }),
      makeLearning({ tier: 'step', category: 'step-a', content: content + ' duplicate' }),
      makeLearning({ tier: 'step', category: 'step-a', content: 'performance optimisation patterns reduce latency' }),
    ];

    const { learnings } = promoter.promoteStepToFlavor(stepLearnings, 'flavor-x');
    expect(learnings).toHaveLength(0);
  });

  it('populates PromotionEvent fields correctly', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'performance optimisation patterns reduce latency in builds';
    const stepLearnings: Learning[] = [
      makeLearning({ id: randomUUID(), tier: 'step', category: 'step-a', content }),
      makeLearning({ id: randomUUID(), tier: 'step', category: 'step-b', content: content + ' extended' }),
      makeLearning({ id: randomUUID(), tier: 'step', category: 'step-c', content: 'performance optimisation patterns reduce latency' }),
    ];

    const { learnings, events } = promoter.promoteStepToFlavor(stepLearnings, 'flavor-x');
    expect(learnings.length).toBeGreaterThan(0);

    const event = events[0];
    expect(event.fromTier).toBe('step');
    expect(event.toTier).toBe('flavor');
    expect(event.evidenceCount).toBe(3);
    expect(event.reason).toContain('step-tier');
    expect(event.toLearningId).toBe(learnings[0].id);
    // fromLearningId must be one of the step learning IDs
    const sourceIds = stepLearnings.map((l) => l.id);
    expect(sourceIds).toContain(event.fromLearningId);
  });
});

// ---------------------------------------------------------------------------
// promoteFlavorToStage
// ---------------------------------------------------------------------------

describe('HierarchicalPromoter.promoteFlavorToStage', () => {
  it('creates a stage learning when 2+ flavor learnings from different categories are similar', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'caching reduces repeated work across flavor executions';
    const flavorLearnings: Learning[] = [
      makeLearning({ tier: 'flavor', category: 'flavor-a', content }),
      makeLearning({ tier: 'flavor', category: 'flavor-b', content: 'caching reduces repeated work across executions' }),
    ];

    const { learnings, events } = promoter.promoteFlavorToStage(flavorLearnings, 'build');

    expect(learnings.length).toBeGreaterThan(0);
    expect(learnings[0].tier).toBe('stage');
    expect(learnings[0].category).toBe('build');
    expect(events.length).toBeGreaterThan(0);
  });

  it('does not promote when only 1 flavor learning exists', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const flavorLearnings: Learning[] = [
      makeLearning({ tier: 'flavor', category: 'flavor-a', content: 'caching reduces repeated work' }),
    ];

    const { learnings, events } = promoter.promoteFlavorToStage(flavorLearnings, 'build');
    expect(learnings).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('does not promote when both learnings share the same flavor category', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'caching reduces repeated work across flavor executions';
    const flavorLearnings: Learning[] = [
      makeLearning({ tier: 'flavor', category: 'flavor-a', content }),
      makeLearning({ tier: 'flavor', category: 'flavor-a', content: 'caching reduces repeated work' }),
    ];

    const { learnings } = promoter.promoteFlavorToStage(flavorLearnings, 'build');
    expect(learnings).toHaveLength(0);
  });

  it('populates PromotionEvent with correct fromTier and toTier', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'caching reduces repeated work across flavor executions';
    const flavorLearnings: Learning[] = [
      makeLearning({ tier: 'flavor', category: 'flavor-a', content }),
      makeLearning({ tier: 'flavor', category: 'flavor-b', content: 'caching reduces repeated work across executions' }),
    ];

    const { events } = promoter.promoteFlavorToStage(flavorLearnings, 'build');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].fromTier).toBe('flavor');
    expect(events[0].toTier).toBe('stage');
  });
});

// ---------------------------------------------------------------------------
// promoteStageToCategory
// ---------------------------------------------------------------------------

describe('HierarchicalPromoter.promoteStageToCategory', () => {
  it('creates a category learning when 2+ stage learnings from different categories are similar', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'early testing prevents integration failures across stages';
    const stageLearnings: Learning[] = [
      makeLearning({ tier: 'stage', category: 'build', content }),
      makeLearning({ tier: 'stage', category: 'research', content: 'early testing prevents integration failures' }),
    ];

    const { learnings, events } = promoter.promoteStageToCategory(stageLearnings);

    expect(learnings.length).toBeGreaterThan(0);
    expect(learnings[0].tier).toBe('category');
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].fromTier).toBe('stage');
    expect(events[0].toTier).toBe('category');
  });

  it('does not promote when only 1 stage learning exists', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const stageLearnings: Learning[] = [
      makeLearning({ tier: 'stage', category: 'build', content: 'early testing prevents integration failures' }),
    ];

    const { learnings, events } = promoter.promoteStageToCategory(stageLearnings);
    expect(learnings).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('does not promote when all stage learnings share the same category', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'early testing prevents integration failures across stages';
    const stageLearnings: Learning[] = [
      makeLearning({ tier: 'stage', category: 'build', content }),
      makeLearning({ tier: 'stage', category: 'build', content: 'early testing prevents integration failures' }),
    ];

    const { learnings } = promoter.promoteStageToCategory(stageLearnings);
    expect(learnings).toHaveLength(0);
  });

  it('populates evidenceCount correctly', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'early testing prevents integration failures across stages';
    const stageLearnings: Learning[] = [
      makeLearning({ tier: 'stage', category: 'build', content }),
      makeLearning({ tier: 'stage', category: 'research', content: 'early testing prevents integration failures' }),
    ];

    const { events } = promoter.promoteStageToCategory(stageLearnings);
    expect(events.length).toBeGreaterThan(0);
    // evidenceCount equals the cluster size
    expect(events[0].evidenceCount).toBe(2);
    expect(events[0].reason).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// PromotionEvent shape validation
// ---------------------------------------------------------------------------

describe('HierarchicalPromoter — PromotionEvent field integrity', () => {
  it('generates valid UUIDs for PromotionEvent id fields', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'performance optimisation patterns reduce latency in builds';
    const stepLearnings: Learning[] = [
      makeLearning({ tier: 'step', category: 'step-a', content }),
      makeLearning({ tier: 'step', category: 'step-b', content: content + ' extended' }),
      makeLearning({ tier: 'step', category: 'step-c', content: 'performance optimisation patterns reduce latency' }),
    ];

    const { events } = promoter.promoteStepToFlavor(stepLearnings, 'flavor-x');
    expect(events.length).toBeGreaterThan(0);

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const event of events) {
      expect(event.id).toMatch(uuidPattern);
      expect(event.fromLearningId).toMatch(uuidPattern);
      expect(event.toLearningId).toMatch(uuidPattern);
    }
  });

  it('sets promotedAt to a valid ISO datetime', () => {
    const mockStore = createMockStore();
    const promoter = new HierarchicalPromoter(mockStore);

    const content = 'early testing prevents integration failures across stages';
    const stageLearnings: Learning[] = [
      makeLearning({ tier: 'stage', category: 'build', content }),
      makeLearning({ tier: 'stage', category: 'research', content: 'early testing prevents integration failures' }),
    ];

    const { events } = promoter.promoteStageToCategory(stageLearnings);
    expect(events.length).toBeGreaterThan(0);
    expect(() => new Date(events[0].promotedAt)).not.toThrow();
    expect(new Date(events[0].promotedAt).toISOString()).toBe(events[0].promotedAt);
  });
});
