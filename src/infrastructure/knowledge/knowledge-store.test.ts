import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Learning, LearningPermanence } from '@domain/types/learning.js';
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
        byTier: { step: 0, flavor: 0, stage: 0, category: 0, agent: 0 },
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
      expect(result.byTier).toEqual({ step: 0, flavor: 0, stage: 2, category: 1, agent: 1 });
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

  describe('archiveLearning', () => {
    it('archives a learning by setting archived=true', () => {
      const captured = store.capture(makeLearningInput({ content: 'To be archived' }));
      const archived = store.archiveLearning(captured.id, 'no longer relevant');

      expect(archived.archived).toBe(true);
      expect(archived.id).toBe(captured.id);
    });

    it('pushes a version snapshot with the provided reason', () => {
      const captured = store.capture(makeLearningInput({ content: 'Archive me', confidence: 0.7 }));
      const archived = store.archiveLearning(captured.id, 'test-reason');

      expect(archived.versions).toHaveLength(1);
      expect(archived.versions[0]!.changeReason).toBe('test-reason');
      expect(archived.versions[0]!.content).toBe('Archive me');
      expect(archived.versions[0]!.confidence).toBe(0.7);
    });

    it('uses default reason "archived" when no reason provided', () => {
      const captured = store.capture(makeLearningInput());
      const archived = store.archiveLearning(captured.id);

      expect(archived.versions[0]!.changeReason).toBe('archived');
    });

    it('is idempotent — returns already-archived learning without error', () => {
      const captured = store.capture(makeLearningInput());
      const firstArchive = store.archiveLearning(captured.id, 'first');
      // Call again on already-archived learning
      const secondArchive = store.archiveLearning(captured.id, 'second');

      // Should return unchanged (versions still only has 1 entry from first archive)
      expect(secondArchive.archived).toBe(true);
      expect(secondArchive.versions).toHaveLength(firstArchive.versions.length);
    });

    it('persists the archived state to disk', () => {
      const captured = store.capture(makeLearningInput());
      store.archiveLearning(captured.id);

      const retrieved = store.get(captured.id);
      expect(retrieved.archived).toBe(true);
    });

    it('allows archiving constitutional learnings', () => {
      const captured = store.capture(makeLearningInput({ permanence: 'constitutional' as LearningPermanence }));
      const archived = store.archiveLearning(captured.id, 'overridden');

      expect(archived.archived).toBe(true);
      expect(archived.permanence).toBe('constitutional');
    });
  });

  describe('resurrectedBy', () => {
    it('sets archived=false on an archived learning', () => {
      const captured = store.capture(makeLearningInput());
      store.archiveLearning(captured.id);

      const observationId = crypto.randomUUID();
      const citedAt = new Date().toISOString();
      const resurrected = store.resurrectedBy(captured.id, observationId, citedAt);

      expect(resurrected.archived).toBe(false);
    });

    it('appends a citation with the provided observationId and citedAt', () => {
      const captured = store.capture(makeLearningInput());
      store.archiveLearning(captured.id);

      const observationId = crypto.randomUUID();
      const citedAt = new Date().toISOString();
      const resurrected = store.resurrectedBy(captured.id, observationId, citedAt);

      expect(resurrected.citations).toHaveLength(1);
      expect(resurrected.citations[0]!.observationId).toBe(observationId);
      expect(resurrected.citations[0]!.citedAt).toBe(citedAt);
    });

    it('pushes a version snapshot with changeReason=resurrected', () => {
      const captured = store.capture(makeLearningInput());
      store.archiveLearning(captured.id);

      const previousVersionCount = store.get(captured.id).versions.length;
      const resurrected = store.resurrectedBy(captured.id, crypto.randomUUID(), new Date().toISOString());

      expect(resurrected.versions).toHaveLength(previousVersionCount + 1);
      expect(resurrected.versions[resurrected.versions.length - 1]!.changeReason).toBe('resurrected');
    });

    it('persists the resurrected state to disk', () => {
      const captured = store.capture(makeLearningInput());
      store.archiveLearning(captured.id);
      store.resurrectedBy(captured.id, crypto.randomUUID(), new Date().toISOString());

      const retrieved = store.get(captured.id);
      expect(retrieved.archived).toBe(false);
    });
  });

  describe('promote', () => {
    it('promotes operational to strategic: sets permanence, refreshBy in future, clears expiresAt', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
        const captured = store.capture(makeLearningInput({
          permanence: 'operational' as LearningPermanence,
          expiresAt: new Date('2026-06-01').toISOString(),
        }));

        const promoted = store.promote(captured.id, 'strategic');

        expect(promoted.permanence).toBe('strategic');
        expect(promoted.refreshBy).toBeDefined();
        expect(new Date(promoted.refreshBy!).getTime()).toBeGreaterThan(new Date('2026-01-01').getTime());
        expect(promoted.expiresAt).toBeUndefined();
      } finally {
        vi.useRealTimers();
      }
    });

    it('refreshBy is approximately 90 days from now when promoting to strategic', () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2026-01-01T00:00:00.000Z');
        vi.setSystemTime(now);

        const captured = store.capture(makeLearningInput({ permanence: 'operational' as LearningPermanence }));
        const promoted = store.promote(captured.id, 'strategic');

        const expectedRefreshBy = new Date('2026-04-01T00:00:00.000Z'); // 90 days from Jan 1
        const actualRefreshBy = new Date(promoted.refreshBy!);
        // Allow 1 day tolerance
        expect(Math.abs(actualRefreshBy.getTime() - expectedRefreshBy.getTime())).toBeLessThan(24 * 60 * 60 * 1000 + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('promotes strategic to constitutional: clears refreshBy and expiresAt', () => {
      const captured = store.capture(makeLearningInput({
        permanence: 'strategic' as LearningPermanence,
        refreshBy: new Date('2026-06-01').toISOString(),
      }));

      const promoted = store.promote(captured.id, 'constitutional');

      expect(promoted.permanence).toBe('constitutional');
      expect(promoted.refreshBy).toBeUndefined();
      expect(promoted.expiresAt).toBeUndefined();
    });

    it('promotes operational to constitutional: clears both refreshBy and expiresAt', () => {
      const captured = store.capture(makeLearningInput({
        permanence: 'operational' as LearningPermanence,
        expiresAt: new Date('2026-06-01').toISOString(),
      }));

      const promoted = store.promote(captured.id, 'constitutional');

      expect(promoted.permanence).toBe('constitutional');
      expect(promoted.refreshBy).toBeUndefined();
      expect(promoted.expiresAt).toBeUndefined();
    });

    it('throws when trying to change permanence of a constitutional learning', () => {
      const captured = store.capture(makeLearningInput({ permanence: 'constitutional' as LearningPermanence }));

      expect(() => store.promote(captured.id, 'strategic')).toThrow('INVALID_PROMOTION: Cannot change permanence of a constitutional learning');
      expect(() => store.promote(captured.id, 'operational')).toThrow('INVALID_PROMOTION: Cannot change permanence of a constitutional learning');
    });

    it('throws on demotion: strategic to operational', () => {
      const captured = store.capture(makeLearningInput({ permanence: 'strategic' as LearningPermanence }));

      expect(() => store.promote(captured.id, 'operational')).toThrow('INVALID_PROMOTION: Downgrade not allowed');
    });

    it('pushes a version snapshot with changeReason=promoted', () => {
      const captured = store.capture(makeLearningInput({ permanence: 'operational' as LearningPermanence }));
      const promoted = store.promote(captured.id, 'strategic');

      expect(promoted.versions).toHaveLength(1);
      expect(promoted.versions[0]!.changeReason).toBe('promoted');
    });
  });

  describe('computeDecayedConfidence', () => {
    it('returns exact confidence for constitutional learnings (no decay)', () => {
      vi.useFakeTimers();
      try {
        const createdAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
        vi.setSystemTime(new Date('2026-12-01T00:00:00.000Z')); // 11 months later
        const captured = store.capture(makeLearningInput({
          permanence: 'constitutional' as LearningPermanence,
          confidence: 0.95,
        }));
        // Override createdAt for the test by using a captured object directly
        const learning = { ...captured, createdAt, lastUsedAt: undefined };
        const result = store.computeDecayedConfidence(learning);
        expect(result).toBe(0.95);
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies 50% decay per 30 days for operational learnings', () => {
      vi.useFakeTimers();
      try {
        const createdAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
        vi.setSystemTime(new Date('2026-01-31T00:00:00.000Z')); // 30 days later

        const captured = store.capture(makeLearningInput({
          permanence: 'operational' as LearningPermanence,
          confidence: 1.0,
        }));
        const learning = { ...captured, createdAt, lastUsedAt: undefined };
        const result = store.computeDecayedConfidence(learning);
        // 30 days elapsed, 50% decay per 30 days → confidence * (1 - 0.5 * 30/30) = 1.0 * 0.5 = 0.5
        expect(result).toBeCloseTo(0.5, 5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('applies 20% decay per 90 days for strategic learnings', () => {
      vi.useFakeTimers();
      try {
        const createdAt = new Date('2026-01-01T00:00:00.000Z').toISOString();
        vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z')); // ~90 days later

        const captured = store.capture(makeLearningInput({
          permanence: 'strategic' as LearningPermanence,
          confidence: 1.0,
        }));
        const learning = { ...captured, createdAt, lastUsedAt: undefined };
        const result = store.computeDecayedConfidence(learning);
        // 90 days elapsed, 20% decay per 90 days → confidence * (1 - 0.2 * 90/90) = 1.0 * 0.8 = 0.8
        expect(result).toBeCloseTo(0.8, 3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('returns original confidence for zero days elapsed', () => {
      vi.useFakeTimers();
      try {
        const now = new Date('2026-01-01T00:00:00.000Z');
        vi.setSystemTime(now);

        const captured = store.capture(makeLearningInput({
          permanence: 'operational' as LearningPermanence,
          confidence: 0.8,
        }));
        const result = store.computeDecayedConfidence(captured);
        expect(result).toBeCloseTo(0.8, 5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses lastUsedAt as reference date when available', () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z')); // 31 days after lastUsedAt
        const captured = store.capture(makeLearningInput({
          permanence: 'operational' as LearningPermanence,
          confidence: 1.0,
        }));
        // Set lastUsedAt to 31 days ago (Jan 1) — createdAt would be Feb 1
        const learning = {
          ...captured,
          createdAt: new Date('2025-12-01T00:00:00.000Z').toISOString(), // way back
          lastUsedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(), // 31 days ago
        };
        const result = store.computeDecayedConfidence(learning);
        // 31 days, 50% per 30 days → 1.0 * (1 - 0.5 * 31/30)
        const expected = 1.0 * Math.max(0, 1 - (0.5 * 31 / 30));
        expect(result).toBeCloseTo(expected, 5);
      } finally {
        vi.useRealTimers();
      }
    });

    it('clamps result to 0 when fully decayed', () => {
      vi.useFakeTimers();
      try {
        const createdAt = new Date('2024-01-01T00:00:00.000Z').toISOString();
        vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z')); // 2 years later
        const captured = store.capture(makeLearningInput({
          permanence: 'operational' as LearningPermanence,
          confidence: 0.5,
        }));
        const learning = { ...captured, createdAt, lastUsedAt: undefined };
        const result = store.computeDecayedConfidence(learning);
        expect(result).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('checkExpiry', () => {
    it('auto-archives expired operational learnings', () => {
      const pastDate = new Date('2020-01-01').toISOString();
      const captured = store.capture(makeLearningInput({
        permanence: 'operational' as LearningPermanence,
        expiresAt: pastDate,
      }));

      const { archived, flaggedStale } = store.checkExpiry(new Date());

      expect(archived).toHaveLength(1);
      expect(archived[0]!.id).toBe(captured.id);
      expect(archived[0]!.archived).toBe(true);
      expect(flaggedStale).toHaveLength(0);

      // Verify persisted to disk
      const retrieved = store.get(captured.id);
      expect(retrieved.archived).toBe(true);
    });

    it('flags stale strategic learnings without archiving', () => {
      const pastDate = new Date('2020-01-01').toISOString();
      const captured = store.capture(makeLearningInput({
        permanence: 'strategic' as LearningPermanence,
        refreshBy: pastDate,
      }));

      const { archived, flaggedStale } = store.checkExpiry(new Date());

      expect(flaggedStale).toHaveLength(1);
      expect(flaggedStale[0]!.id).toBe(captured.id);
      expect(archived).toHaveLength(0);

      // Strategic learnings should NOT be auto-archived
      const retrieved = store.get(captured.id);
      expect(retrieved.archived).toBe(false);
    });

    it('does not archive non-expired operational learnings', () => {
      const futureDate = new Date('2099-01-01').toISOString();
      store.capture(makeLearningInput({
        permanence: 'operational' as LearningPermanence,
        expiresAt: futureDate,
      }));

      const { archived, flaggedStale } = store.checkExpiry(new Date());

      expect(archived).toHaveLength(0);
      expect(flaggedStale).toHaveLength(0);
    });

    it('does not flag non-stale strategic learnings', () => {
      const futureDate = new Date('2099-01-01').toISOString();
      store.capture(makeLearningInput({
        permanence: 'strategic' as LearningPermanence,
        refreshBy: futureDate,
      }));

      const { archived, flaggedStale } = store.checkExpiry(new Date());

      expect(archived).toHaveLength(0);
      expect(flaggedStale).toHaveLength(0);
    });

    it('skips already-archived learnings when checking operational expiry', () => {
      const pastDate = new Date('2020-01-01').toISOString();
      const captured = store.capture(makeLearningInput({
        permanence: 'operational' as LearningPermanence,
        expiresAt: pastDate,
      }));
      store.archiveLearning(captured.id, 'pre-archived');

      const { archived } = store.checkExpiry(new Date());

      // The already-archived learning should not appear in the archived list again
      expect(archived).toHaveLength(0);
    });

    it('handles empty store gracefully', () => {
      const { archived, flaggedStale } = store.checkExpiry(new Date());
      expect(archived).toHaveLength(0);
      expect(flaggedStale).toHaveLength(0);
    });
  });

  describe('loadForStep', () => {
    it('returns step-tier learnings matching the stepId category', () => {
      store.capture(makeLearningInput({ tier: 'step', category: 'write-tests', content: 'step learning for write-tests' }));
      store.capture(makeLearningInput({ tier: 'step', category: 'other-step', content: 'step learning for other-step' }));
      store.capture(makeLearningInput({ tier: 'stage', category: 'write-tests', content: 'stage learning — should be excluded' }));

      const results = store.loadForStep('write-tests');

      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('step learning for write-tests');
      expect(results[0]!.tier).toBe('step');
    });

    it('excludes archived learnings', () => {
      const captured = store.capture(makeLearningInput({ tier: 'step', category: 'write-tests' }));
      store.archiveLearning(captured.id);

      const results = store.loadForStep('write-tests');
      expect(results).toHaveLength(0);
    });

    it('returns empty array when no step learnings exist for stepId', () => {
      const results = store.loadForStep('nonexistent-step');
      expect(results).toHaveLength(0);
    });
  });

  describe('loadForFlavor', () => {
    it('returns flavor-tier learnings matching the flavorId category', () => {
      store.capture(makeLearningInput({ tier: 'flavor', category: 'tdd-flow', content: 'flavor learning for tdd-flow' }));
      store.capture(makeLearningInput({ tier: 'flavor', category: 'other-flavor', content: 'flavor learning for other-flavor' }));
      store.capture(makeLearningInput({ tier: 'stage', category: 'tdd-flow', content: 'stage learning — should be excluded' }));

      const results = store.loadForFlavor('tdd-flow');

      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('flavor learning for tdd-flow');
      expect(results[0]!.tier).toBe('flavor');
    });

    it('excludes archived learnings', () => {
      const captured = store.capture(makeLearningInput({ tier: 'flavor', category: 'tdd-flow' }));
      store.archiveLearning(captured.id);

      const results = store.loadForFlavor('tdd-flow');
      expect(results).toHaveLength(0);
    });

    it('returns empty array when no flavor learnings exist for flavorId', () => {
      const results = store.loadForFlavor('nonexistent-flavor');
      expect(results).toHaveLength(0);
    });
  });

  describe('query — archived filtering', () => {
    it('excludes archived learnings by default', () => {
      store.capture(makeLearningInput({ content: 'active learning' }));
      const archived = store.capture(makeLearningInput({ content: 'archived learning' }));
      store.archiveLearning(archived.id);

      const results = store.query({});
      expect(results).toHaveLength(1);
      expect(results[0]!.content).toBe('active learning');
    });

    it('includes archived learnings when includeArchived=true', () => {
      store.capture(makeLearningInput({ content: 'active learning' }));
      const archived = store.capture(makeLearningInput({ content: 'archived learning' }));
      store.archiveLearning(archived.id);

      const results = store.query({ includeArchived: true });
      expect(results).toHaveLength(2);
    });

    it('returns only archived learnings when filtering by archived flag via includeArchived', () => {
      store.capture(makeLearningInput({ content: 'active' }));
      const archived = store.capture(makeLearningInput({ content: 'archived' }));
      store.archiveLearning(archived.id);

      const all = store.query({ includeArchived: true });
      const archivedOnly = all.filter((l) => l.archived);
      expect(archivedOnly).toHaveLength(1);
      expect(archivedOnly[0]!.content).toBe('archived');
    });
  });
});
