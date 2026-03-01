import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Learning } from '@domain/types/learning.js';
import { KnowledgeStore } from './knowledge-store.js';

let tempDir: string;
let store: KnowledgeStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-promote-tier-test-'));
  store = new KnowledgeStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeLearningInput(overrides: Partial<Omit<Learning, 'id' | 'createdAt' | 'updatedAt'>> = {}) {
  return {
    tier: 'step' as const,
    category: 'write-tests',
    content: 'Always write tests for new functions',
    evidence: [],
    confidence: 0.7,
    ...overrides,
  };
}

describe('KnowledgeStore.promoteTier', () => {
  it('promotes a step-tier learning to flavor tier', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    const promoted = store.promoteTier(captured.id, 'flavor');

    expect(promoted.tier).toBe('flavor');
    expect(promoted.id).toBe(captured.id);
  });

  it('promotes step to stage', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    const promoted = store.promoteTier(captured.id, 'stage');

    expect(promoted.tier).toBe('stage');
  });

  it('promotes step to category', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    const promoted = store.promoteTier(captured.id, 'category');

    expect(promoted.tier).toBe('category');
  });

  it('promotes step to agent', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    const promoted = store.promoteTier(captured.id, 'agent');

    expect(promoted.tier).toBe('agent');
  });

  it('promotes flavor to stage', () => {
    const captured = store.capture(makeLearningInput({ tier: 'flavor', category: 'tdd-flow' }));
    const promoted = store.promoteTier(captured.id, 'stage');

    expect(promoted.tier).toBe('stage');
  });

  it('promotes stage to category', () => {
    const captured = store.capture(makeLearningInput({ tier: 'stage', category: 'build' }));
    const promoted = store.promoteTier(captured.id, 'category');

    expect(promoted.tier).toBe('category');
  });

  it('promotes category to agent', () => {
    const captured = store.capture(makeLearningInput({ tier: 'category', category: 'architecture' }));
    const promoted = store.promoteTier(captured.id, 'agent');

    expect(promoted.tier).toBe('agent');
  });

  it('updates category when newCategory is provided', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step', category: 'write-tests' }));
    const promoted = store.promoteTier(captured.id, 'flavor', 'tdd-flow');

    expect(promoted.tier).toBe('flavor');
    expect(promoted.category).toBe('tdd-flow');
  });

  it('keeps existing category when newCategory is not provided', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step', category: 'write-tests' }));
    const promoted = store.promoteTier(captured.id, 'flavor');

    expect(promoted.category).toBe('write-tests');
  });

  it('pushes a version snapshot with changeReason=tier-promoted', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    const promoted = store.promoteTier(captured.id, 'flavor');

    expect(promoted.versions).toHaveLength(1);
    expect(promoted.versions[0]!.changeReason).toBe('tier-promoted');
    expect(promoted.versions[0]!.content).toBe(captured.content);
    expect(promoted.versions[0]!.confidence).toBe(captured.confidence);
  });

  it('persists the promotion to disk', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    store.promoteTier(captured.id, 'flavor');

    const retrieved = store.get(captured.id);
    expect(retrieved.tier).toBe('flavor');
  });

  it('updates the updatedAt timestamp', () => {
    const captured = store.capture(makeLearningInput({ tier: 'step' }));
    // Tiny sleep to ensure timestamp differs
    const beforeUpdate = new Date().toISOString();
    const promoted = store.promoteTier(captured.id, 'flavor');

    expect(promoted.updatedAt >= beforeUpdate).toBe(true);
  });

  describe('invalid promotions', () => {
    it('throws when trying to promote to the same tier', () => {
      const captured = store.capture(makeLearningInput({ tier: 'step' }));

      expect(() => store.promoteTier(captured.id, 'step')).toThrow('INVALID_TIER_PROMOTION');
    });

    it('throws when trying to demote: flavor to step', () => {
      const captured = store.capture(makeLearningInput({ tier: 'flavor', category: 'tdd-flow' }));

      expect(() => store.promoteTier(captured.id, 'step')).toThrow('INVALID_TIER_PROMOTION');
    });

    it('throws when trying to demote: stage to flavor', () => {
      const captured = store.capture(makeLearningInput({ tier: 'stage' }));

      expect(() => store.promoteTier(captured.id, 'flavor')).toThrow('INVALID_TIER_PROMOTION');
    });

    it('throws when trying to demote: category to stage', () => {
      const captured = store.capture(makeLearningInput({ tier: 'category' }));

      expect(() => store.promoteTier(captured.id, 'stage')).toThrow('INVALID_TIER_PROMOTION');
    });

    it('throws when trying to demote: agent to category', () => {
      const captured = store.capture(makeLearningInput({ tier: 'agent', agentId: 'agent-1' }));

      expect(() => store.promoteTier(captured.id, 'category')).toThrow('INVALID_TIER_PROMOTION');
    });

    it('error message includes the from and to tier names', () => {
      const captured = store.capture(makeLearningInput({ tier: 'flavor', category: 'tdd-flow' }));

      expect(() => store.promoteTier(captured.id, 'step')).toThrow(/flavor.*step|step.*flavor/);
    });

    it('throws for non-existent learning', () => {
      expect(() => store.promoteTier('nonexistent-id', 'flavor')).toThrow();
    });
  });

  describe('stacking multiple version snapshots', () => {
    it('accumulates version history across multiple promotions', () => {
      const captured = store.capture(makeLearningInput({ tier: 'step' }));
      store.promoteTier(captured.id, 'flavor');
      store.promoteTier(captured.id, 'stage');
      const final = store.promoteTier(captured.id, 'category');

      expect(final.versions).toHaveLength(3);
      expect(final.versions.every((v) => v.changeReason === 'tier-promoted')).toBe(true);
    });
  });
});
