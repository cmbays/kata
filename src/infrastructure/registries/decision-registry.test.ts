import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach } from 'vitest';
import type { Decision, DecisionOutcome } from '@domain/types/decision.js';
import { DecisionNotFoundError } from '@shared/lib/errors.js';
import { DecisionRegistry } from './decision-registry.js';

const VALID_DATETIME = '2026-01-15T10:00:00.000Z';
const LATER_DATETIME = '2026-01-16T10:00:00.000Z';

function makeInput(overrides: Partial<Omit<Decision, 'id'>> = {}): Omit<Decision, 'id'> {
  return {
    stageCategory: 'build',
    decisionType: 'flavor-selection',
    context: { betId: 'bet-123' },
    options: ['typescript-feature', 'bug-fix'],
    selection: 'typescript-feature',
    reasoning: 'The bet describes a new feature.',
    confidence: 0.85,
    decidedAt: VALID_DATETIME,
    ...overrides,
  };
}

describe('DecisionRegistry', () => {
  let basePath: string;
  let registry: DecisionRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'decision-registry-test-'));
    registry = new DecisionRegistry(basePath);
  });

  describe('record', () => {
    it('returns the persisted decision with a generated UUID id', () => {
      const decision = registry.record(makeInput());
      expect(decision.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(decision.stageCategory).toBe('build');
      expect(decision.selection).toBe('typescript-feature');
    });

    it('persists using dot-notation filename: {stageCategory}.{id}.json', () => {
      const decision = registry.record(makeInput({ stageCategory: 'research' }));
      const expectedFile = `research.${decision.id}.json`;
      expect(existsSync(join(basePath, expectedFile))).toBe(true);
    });

    it('generates a unique id for each call', () => {
      const d1 = registry.record(makeInput());
      const d2 = registry.record(makeInput());
      expect(d1.id).not.toBe(d2.id);
    });

    it('adds the decision to the in-memory cache', () => {
      const decision = registry.record(makeInput());
      const retrieved = registry.get(decision.id);
      expect(retrieved.id).toBe(decision.id);
    });

    it('throws on invalid input (empty options)', () => {
      expect(() => registry.record(makeInput({ options: [] }))).toThrow();
    });

    it('throws on invalid input (empty reasoning)', () => {
      expect(() => registry.record(makeInput({ reasoning: '' }))).toThrow();
    });

    it('throws on confidence out of range', () => {
      expect(() => registry.record(makeInput({ confidence: 1.5 }))).toThrow();
    });
  });

  describe('get', () => {
    it('retrieves a recorded decision by id', () => {
      const decision = registry.record(makeInput());
      const retrieved = registry.get(decision.id);
      expect(retrieved.id).toBe(decision.id);
      expect(retrieved.decisionType).toBe('flavor-selection');
    });

    it('throws DecisionNotFoundError for unknown id', () => {
      expect(() => registry.get('00000000-0000-4000-8000-000000000099')).toThrow(
        DecisionNotFoundError,
      );
    });

    it('loads from disk if not in cache (cross-instance retrieval)', () => {
      const registry1 = new DecisionRegistry(basePath);
      const decision = registry1.record(makeInput());

      const registry2 = new DecisionRegistry(basePath);
      const retrieved = registry2.get(decision.id);
      expect(retrieved.id).toBe(decision.id);
      expect(retrieved.selection).toBe('typescript-feature');
    });

    it('throws DecisionNotFoundError for empty-string id', () => {
      expect(() => registry.get('')).toThrow(DecisionNotFoundError);
    });
  });

  describe('list', () => {
    it('returns empty array when no decisions have been recorded', () => {
      expect(registry.list()).toEqual([]);
    });

    it('returns all recorded decisions in decidedAt order', () => {
      const d1 = registry.record(makeInput({ decidedAt: LATER_DATETIME }));
      const d2 = registry.record(makeInput({ decidedAt: VALID_DATETIME }));
      const results = registry.list();
      expect(results[0]!.id).toBe(d2.id); // older first
      expect(results[1]!.id).toBe(d1.id);
    });

    it('loads from disk when cache is empty', () => {
      const registry1 = new DecisionRegistry(basePath);
      registry1.record(makeInput());
      registry1.record(makeInput({ stageCategory: 'plan' }));

      const registry2 = new DecisionRegistry(basePath);
      expect(registry2.list()).toHaveLength(2);
    });

    it('filters by stageCategory', () => {
      registry.record(makeInput({ stageCategory: 'build' }));
      registry.record(makeInput({ stageCategory: 'build' }));
      registry.record(makeInput({ stageCategory: 'research' }));

      const buildDecisions = registry.list({ stageCategory: 'build' });
      expect(buildDecisions).toHaveLength(2);
      expect(buildDecisions.every((d) => d.stageCategory === 'build')).toBe(true);
    });

    it('filters by decisionType', () => {
      registry.record(makeInput({ decisionType: 'flavor-selection' }));
      registry.record(makeInput({ decisionType: 'execution-mode' }));
      registry.record(makeInput({ decisionType: 'flavor-selection' }));

      const results = registry.list({ decisionType: 'flavor-selection' });
      expect(results).toHaveLength(2);
    });

    it('filters by confidenceMin (inclusive)', () => {
      registry.record(makeInput({ confidence: 0.5 }));
      registry.record(makeInput({ confidence: 0.75 }));
      registry.record(makeInput({ confidence: 0.9 }));

      const results = registry.list({ confidenceMin: 0.75 });
      expect(results).toHaveLength(2);
      expect(results.every((d) => d.confidence >= 0.75)).toBe(true);
    });

    it('filters by confidenceMax (inclusive)', () => {
      registry.record(makeInput({ confidence: 0.5 }));
      registry.record(makeInput({ confidence: 0.75 }));
      registry.record(makeInput({ confidence: 0.9 }));

      const results = registry.list({ confidenceMax: 0.75 });
      expect(results).toHaveLength(2);
      expect(results.every((d) => d.confidence <= 0.75)).toBe(true);
    });

    it('filters by date range (from/to, inclusive)', () => {
      registry.record(makeInput({ decidedAt: '2026-01-01T00:00:00.000Z' }));
      registry.record(makeInput({ decidedAt: '2026-01-15T00:00:00.000Z' }));
      registry.record(makeInput({ decidedAt: '2026-01-31T00:00:00.000Z' }));

      const results = registry.list({
        from: '2026-01-10T00:00:00.000Z',
        to: '2026-01-20T00:00:00.000Z',
      });
      expect(results).toHaveLength(1);
      expect(results[0]!.decidedAt).toBe('2026-01-15T00:00:00.000Z');
    });

    it('combines multiple filters (AND semantics)', () => {
      registry.record(makeInput({ stageCategory: 'build', confidence: 0.9 }));
      registry.record(makeInput({ stageCategory: 'build', confidence: 0.5 }));
      registry.record(makeInput({ stageCategory: 'research', confidence: 0.9 }));

      const results = registry.list({ stageCategory: 'build', confidenceMin: 0.8 });
      expect(results).toHaveLength(1);
      expect(results[0]!.stageCategory).toBe('build');
      expect(results[0]!.confidence).toBe(0.9);
    });

    it('returns empty array when no decisions match filters', () => {
      registry.record(makeInput({ stageCategory: 'build' }));
      expect(registry.list({ stageCategory: 'wrapup' })).toEqual([]);
    });
  });

  describe('updateOutcome', () => {
    it('adds an outcome to a decision without one', () => {
      const decision = registry.record(makeInput());
      const outcome: DecisionOutcome = {
        artifactQuality: 'good',
        gateResult: 'passed',
        reworkRequired: false,
      };
      const updated = registry.updateOutcome(decision.id, outcome);
      expect(updated.outcome?.artifactQuality).toBe('good');
      expect(updated.outcome?.gateResult).toBe('passed');
      expect(updated.outcome?.reworkRequired).toBe(false);
    });

    it('merges new outcome fields with existing ones', () => {
      const decision = registry.record(
        makeInput({ outcome: { artifactQuality: 'partial' } } as Omit<Decision, 'id'>),
      );
      const updated = registry.updateOutcome(decision.id, {
        gateResult: 'failed',
        reworkRequired: true,
      });
      // Original field is preserved
      expect(updated.outcome?.artifactQuality).toBe('partial');
      // New fields are merged
      expect(updated.outcome?.gateResult).toBe('failed');
      expect(updated.outcome?.reworkRequired).toBe(true);
    });

    it('persists the updated decision to disk', () => {
      const decision = registry.record(makeInput());
      registry.updateOutcome(decision.id, { artifactQuality: 'poor' });

      const registry2 = new DecisionRegistry(basePath);
      const loaded = registry2.get(decision.id);
      expect(loaded.outcome?.artifactQuality).toBe('poor');
    });

    it('updates the in-memory cache', () => {
      const decision = registry.record(makeInput());
      registry.updateOutcome(decision.id, { artifactQuality: 'good' });
      const retrieved = registry.get(decision.id);
      expect(retrieved.outcome?.artifactQuality).toBe('good');
    });

    it('throws DecisionNotFoundError for unknown id', () => {
      expect(() =>
        registry.updateOutcome('00000000-0000-4000-8000-000000000099', { artifactQuality: 'good' }),
      ).toThrow(DecisionNotFoundError);
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no decisions recorded', () => {
      const stats = registry.getStats();
      expect(stats.count).toBe(0);
      expect(stats.avgConfidence).toBe(0);
      expect(stats.countByType).toEqual({});
      expect(stats.outcomeDistribution).toEqual({ good: 0, partial: 0, poor: 0, noOutcome: 0 });
    });

    it('computes correct avgConfidence', () => {
      registry.record(makeInput({ confidence: 0.5 }));
      registry.record(makeInput({ confidence: 1.0 }));
      const stats = registry.getStats();
      expect(stats.avgConfidence).toBeCloseTo(0.75);
    });

    it('computes countByType correctly', () => {
      registry.record(makeInput({ decisionType: 'flavor-selection' }));
      registry.record(makeInput({ decisionType: 'flavor-selection' }));
      registry.record(makeInput({ decisionType: 'retry' }));
      const stats = registry.getStats();
      expect(stats.countByType['flavor-selection']).toBe(2);
      expect(stats.countByType['retry']).toBe(1);
      expect(stats.countByType['execution-mode']).toBeUndefined();
    });

    it('computes outcomeDistribution correctly', () => {
      registry.record(
        makeInput({ outcome: { artifactQuality: 'good' } } as Omit<Decision, 'id'>),
      );
      registry.record(
        makeInput({ outcome: { artifactQuality: 'partial' } } as Omit<Decision, 'id'>),
      );
      registry.record(
        makeInput({ outcome: { artifactQuality: 'poor' } } as Omit<Decision, 'id'>),
      );
      registry.record(makeInput()); // no outcome

      const stats = registry.getStats();
      expect(stats.outcomeDistribution.good).toBe(1);
      expect(stats.outcomeDistribution.partial).toBe(1);
      expect(stats.outcomeDistribution.poor).toBe(1);
      expect(stats.outcomeDistribution.noOutcome).toBe(1);
    });

    it('filters stats by stageCategory when provided', () => {
      registry.record(makeInput({ stageCategory: 'build', confidence: 0.8 }));
      registry.record(makeInput({ stageCategory: 'build', confidence: 0.6 }));
      registry.record(makeInput({ stageCategory: 'research', confidence: 1.0 }));

      const stats = registry.getStats('build');
      expect(stats.count).toBe(2);
      expect(stats.avgConfidence).toBeCloseTo(0.7);
    });

    it('returns zero stats for stageCategory with no decisions', () => {
      registry.record(makeInput({ stageCategory: 'build' }));
      const stats = registry.getStats('wrapup');
      expect(stats.count).toBe(0);
      expect(stats.avgConfidence).toBe(0);
    });
  });

  describe('disk persistence integrity', () => {
    it('skips malformed JSON files with a warning (does not throw)', () => {
      writeFileSync(join(basePath, 'build.bad-file.json'), '{ this is not json }', 'utf-8');
      registry.record(makeInput());
      // list() should return the valid decision and skip the malformed file
      expect(registry.list()).toHaveLength(1);
    });

    it('skips invalid-schema JSON files with a warning (does not throw)', () => {
      writeFileSync(
        join(basePath, 'build.invalid.json'),
        JSON.stringify({ id: 'not-a-uuid', stageCategory: 'build' }),
        'utf-8',
      );
      registry.record(makeInput());
      expect(registry.list()).toHaveLength(1);
    });
  });
});
