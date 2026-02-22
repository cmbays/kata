import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Learning } from '@domain/types/learning.js';
import { KnowledgeStore } from './knowledge-store.js';

let tempDir: string;
let store: KnowledgeStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-knowledge-test-'));
  store = new KnowledgeStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Helper to create a valid learning input (without id/timestamps) */
function makeLearningInput(overrides: Partial<Omit<Learning, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    tier: 'stage' as const,
    category: 'testing',
    content: 'Always write tests before implementation',
    evidence: [],
    confidence: 0.8,
    stageType: 'build',
    ...overrides,
  };
}

describe('KnowledgeStore', () => {
  describe('capture', () => {
    it('creates a new learning with generated ID and timestamps', () => {
      const input = makeLearningInput();
      const result = store.capture(input);

      expect(result.id).toBeDefined();
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.tier).toBe('stage');
      expect(result.category).toBe('testing');
      expect(result.content).toBe('Always write tests before implementation');
      expect(result.confidence).toBe(0.8);
    });

    it('persists the learning to disk', () => {
      const input = makeLearningInput();
      const captured = store.capture(input);

      const retrieved = store.get(captured.id);
      expect(retrieved).toEqual(captured);
    });

    it('handles learnings with evidence', () => {
      const input = makeLearningInput({
        evidence: [
          {
            pipelineId: crypto.randomUUID(),
            stageType: 'build',
            observation: 'Tests caught a regression',
            recordedAt: new Date().toISOString(),
          },
        ],
      });

      const result = store.capture(input);
      expect(result.evidence).toHaveLength(1);
      expect(result.evidence[0]!.observation).toBe('Tests caught a regression');
    });

    it('captures agent-tier learnings with agentId', () => {
      const input = makeLearningInput({
        tier: 'agent',
        agentId: 'agent-42',
        content: 'Prefers concise explanations',
      });

      const result = store.capture(input);
      expect(result.tier).toBe('agent');
      expect(result.agentId).toBe('agent-42');
    });

    it('captures category-tier learnings', () => {
      const input = makeLearningInput({
        tier: 'category',
        category: 'architecture',
        content: 'Prefer composition over inheritance',
      });

      const result = store.capture(input);
      expect(result.tier).toBe('category');
      expect(result.category).toBe('architecture');
    });

    it('sets default evidence to empty array and confidence to 0', () => {
      const input = {
        tier: 'stage' as const,
        category: 'testing',
        content: 'Minimal learning',
        stageType: 'build',
      };

      const result = store.capture(input);
      expect(result.evidence).toEqual([]);
      expect(result.confidence).toBe(0);
    });
  });

  describe('get', () => {
    it('retrieves a learning by ID', () => {
      const captured = store.capture(makeLearningInput());
      const retrieved = store.get(captured.id);
      expect(retrieved).toEqual(captured);
    });

    it('throws for non-existent ID', () => {
      expect(() => store.get('nonexistent-id')).toThrow();
    });
  });

  describe('query', () => {
    it('returns all learnings with empty filter', () => {
      store.capture(makeLearningInput({ content: 'Learning 1' }));
      store.capture(makeLearningInput({ content: 'Learning 2' }));

      const results = store.query({});
      expect(results).toHaveLength(2);
    });

    it('filters by tier', () => {
      store.capture(makeLearningInput({ tier: 'stage', content: 'stage learning' }));
      store.capture(makeLearningInput({ tier: 'category', content: 'category learning' }));
      store.capture(makeLearningInput({ tier: 'agent', content: 'agent learning', agentId: 'a1' }));

      const stageResults = store.query({ tier: 'stage' });
      expect(stageResults).toHaveLength(1);
      expect(stageResults[0]!.content).toBe('stage learning');

      const categoryResults = store.query({ tier: 'category' });
      expect(categoryResults).toHaveLength(1);
      expect(categoryResults[0]!.content).toBe('category learning');
    });

    it('filters by category', () => {
      store.capture(makeLearningInput({ category: 'testing' }));
      store.capture(makeLearningInput({ category: 'architecture' }));

      const results = store.query({ category: 'testing' });
      expect(results).toHaveLength(1);
      expect(results[0]!.category).toBe('testing');
    });

    it('filters by stageType', () => {
      store.capture(makeLearningInput({ stageType: 'build' }));
      store.capture(makeLearningInput({ stageType: 'review' }));

      const results = store.query({ stageType: 'build' });
      expect(results).toHaveLength(1);
      expect(results[0]!.stageType).toBe('build');
    });

    it('filters by agentId', () => {
      store.capture(makeLearningInput({ tier: 'agent', agentId: 'agent-1' }));
      store.capture(makeLearningInput({ tier: 'agent', agentId: 'agent-2' }));

      const results = store.query({ agentId: 'agent-1' });
      expect(results).toHaveLength(1);
      expect(results[0]!.agentId).toBe('agent-1');
    });

    it('filters by minConfidence', () => {
      store.capture(makeLearningInput({ confidence: 0.3 }));
      store.capture(makeLearningInput({ confidence: 0.7 }));
      store.capture(makeLearningInput({ confidence: 0.9 }));

      const results = store.query({ minConfidence: 0.5 });
      expect(results).toHaveLength(2);
      expect(results.every((l) => l.confidence >= 0.5)).toBe(true);
    });

    it('combines multiple filters', () => {
      store.capture(makeLearningInput({ tier: 'stage', category: 'testing', stageType: 'build', confidence: 0.9 }));
      store.capture(makeLearningInput({ tier: 'stage', category: 'testing', stageType: 'review', confidence: 0.9 }));
      store.capture(makeLearningInput({ tier: 'category', category: 'testing', confidence: 0.9 }));

      const results = store.query({ tier: 'stage', category: 'testing', stageType: 'build' });
      expect(results).toHaveLength(1);
      expect(results[0]!.stageType).toBe('build');
    });

    it('returns empty array when no learnings match', () => {
      store.capture(makeLearningInput({ category: 'testing' }));

      const results = store.query({ category: 'nonexistent' });
      expect(results).toEqual([]);
    });

    it('returns empty array when store is empty', () => {
      const results = store.query({});
      expect(results).toEqual([]);
    });
  });

  describe('loadForStage', () => {
    it('returns Tier 1 learnings for a specific stage type', () => {
      store.capture(makeLearningInput({ tier: 'stage', stageType: 'build' }));
      store.capture(makeLearningInput({ tier: 'stage', stageType: 'review' }));
      store.capture(makeLearningInput({ tier: 'category' }));

      const results = store.loadForStage('build');
      expect(results).toHaveLength(1);
      expect(results[0]!.tier).toBe('stage');
      expect(results[0]!.stageType).toBe('build');
    });

    it('returns empty array for unknown stage type', () => {
      store.capture(makeLearningInput({ tier: 'stage', stageType: 'build' }));

      const results = store.loadForStage('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('loadForSubscriptions', () => {
    it('returns Tier 2 learnings for subscribed categories', () => {
      // Set up subscriptions
      store.subscriptions.subscribe('agent-1', ['testing', 'architecture']);

      // Create learnings
      store.capture(makeLearningInput({ tier: 'category', category: 'testing', content: 'testing learning' }));
      store.capture(makeLearningInput({ tier: 'category', category: 'architecture', content: 'arch learning' }));
      store.capture(makeLearningInput({ tier: 'category', category: 'performance', content: 'perf learning' }));
      store.capture(makeLearningInput({ tier: 'stage', category: 'testing', content: 'stage learning' }));

      const results = store.loadForSubscriptions('agent-1');
      expect(results).toHaveLength(2);

      const contents = results.map((l) => l.content).sort();
      expect(contents).toEqual(['arch learning', 'testing learning']);
    });

    it('returns empty array for agent with no subscriptions', () => {
      store.capture(makeLearningInput({ tier: 'category', category: 'testing' }));

      const results = store.loadForSubscriptions('agent-no-subs');
      expect(results).toEqual([]);
    });

    it('returns empty array when subscribed categories have no learnings', () => {
      store.subscriptions.subscribe('agent-1', ['nonexistent-category']);

      const results = store.loadForSubscriptions('agent-1');
      expect(results).toEqual([]);
    });
  });

  describe('loadForAgent', () => {
    it('returns Tier 3 learnings for a specific agent', () => {
      store.capture(makeLearningInput({ tier: 'agent', agentId: 'agent-1', content: 'agent-1 learning' }));
      store.capture(makeLearningInput({ tier: 'agent', agentId: 'agent-2', content: 'agent-2 learning' }));
      store.capture(makeLearningInput({ tier: 'stage', content: 'stage learning' }));

      const results = store.loadForAgent('agent-1');
      expect(results).toHaveLength(1);
      expect(results[0]!.tier).toBe('agent');
      expect(results[0]!.agentId).toBe('agent-1');
    });

    it('returns empty array for unknown agent', () => {
      const results = store.loadForAgent('unknown-agent');
      expect(results).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates content of a learning', () => {
      const captured = store.capture(makeLearningInput({ content: 'Original content' }));

      const updated = store.update(captured.id, { content: 'Updated content' });
      expect(updated.content).toBe('Updated content');
      expect(updated.id).toBe(captured.id);

      // Verify persisted
      const retrieved = store.get(captured.id);
      expect(retrieved.content).toBe('Updated content');
    });

    it('updates confidence of a learning', () => {
      const captured = store.capture(makeLearningInput({ confidence: 0.5 }));

      const updated = store.update(captured.id, { confidence: 0.9 });
      expect(updated.confidence).toBe(0.9);
    });

    it('updates evidence array of a learning', () => {
      const captured = store.capture(makeLearningInput());

      const newEvidence = [
        {
          pipelineId: crypto.randomUUID(),
          stageType: 'build',
          observation: 'New observation',
          recordedAt: new Date().toISOString(),
        },
      ];

      const updated = store.update(captured.id, { evidence: newEvidence });
      expect(updated.evidence).toHaveLength(1);
      expect(updated.evidence[0]!.observation).toBe('New observation');
    });

    it('updates the updatedAt timestamp', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const captured = store.capture(makeLearningInput());

        // Advance time to ensure a different timestamp
        vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
        const updated = store.update(captured.id, { content: 'Changed' });

        expect(updated.updatedAt).not.toBe(captured.updatedAt);
        expect(updated.createdAt).toBe(captured.createdAt);
      } finally {
        vi.useRealTimers();
      }
    });

    it('preserves unchanged fields', () => {
      const captured = store.capture(makeLearningInput({
        content: 'Original',
        confidence: 0.8,
        tier: 'stage',
        category: 'testing',
      }));

      const updated = store.update(captured.id, { content: 'Changed' });
      expect(updated.confidence).toBe(0.8);
      expect(updated.tier).toBe('stage');
      expect(updated.category).toBe('testing');
    });

    it('throws for non-existent learning', () => {
      expect(() => store.update('nonexistent', { content: 'new' })).toThrow();
    });
  });

  describe('stats', () => {
    it('returns zero stats for empty store', () => {
      const result = store.stats();
      expect(result).toEqual({
        total: 0,
        byTier: { stage: 0, category: 0, agent: 0 },
        topCategories: [],
        averageConfidence: 0,
      });
    });

    it('counts total learnings', () => {
      store.capture(makeLearningInput());
      store.capture(makeLearningInput());
      store.capture(makeLearningInput());

      const result = store.stats();
      expect(result.total).toBe(3);
    });

    it('counts learnings by tier', () => {
      store.capture(makeLearningInput({ tier: 'stage' }));
      store.capture(makeLearningInput({ tier: 'stage' }));
      store.capture(makeLearningInput({ tier: 'category' }));
      store.capture(makeLearningInput({ tier: 'agent', agentId: 'a1' }));

      const result = store.stats();
      expect(result.byTier).toEqual({ stage: 2, category: 1, agent: 1 });
    });

    it('returns top categories sorted by count', () => {
      store.capture(makeLearningInput({ category: 'testing' }));
      store.capture(makeLearningInput({ category: 'testing' }));
      store.capture(makeLearningInput({ category: 'testing' }));
      store.capture(makeLearningInput({ category: 'architecture' }));
      store.capture(makeLearningInput({ category: 'architecture' }));
      store.capture(makeLearningInput({ category: 'performance' }));

      const result = store.stats();
      expect(result.topCategories).toEqual([
        { category: 'testing', count: 3 },
        { category: 'architecture', count: 2 },
        { category: 'performance', count: 1 },
      ]);
    });

    it('calculates average confidence', () => {
      store.capture(makeLearningInput({ confidence: 0.6 }));
      store.capture(makeLearningInput({ confidence: 0.8 }));
      store.capture(makeLearningInput({ confidence: 1.0 }));

      const result = store.stats();
      expect(result.averageConfidence).toBeCloseTo(0.8, 10);
    });
  });
});
