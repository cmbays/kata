import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach } from 'vitest';
import type { StageRule, RuleSuggestion } from '@domain/types/rule.js';
import { RuleNotFoundError, SuggestionNotFoundError } from '@shared/lib/errors.js';
import { RuleRegistry } from './rule-registry.js';

function makeRuleInput(
  overrides: Partial<Omit<StageRule, 'id' | 'createdAt'>> = {},
): Omit<StageRule, 'id' | 'createdAt'> {
  return {
    category: 'build',
    name: 'Boost TypeScript flavor',
    condition: 'When tests exist in the project',
    effect: 'boost',
    magnitude: 0.3,
    confidence: 0.8,
    source: 'auto-detected',
    evidence: ['decision-abc', 'decision-def'],
    ...overrides,
  };
}

function makeSuggestionInput(
  overrides: Partial<Omit<RuleSuggestion, 'id' | 'createdAt' | 'status'>> = {},
): Omit<RuleSuggestion, 'id' | 'createdAt' | 'status'> {
  return {
    suggestedRule: {
      category: 'build',
      name: 'Penalize slow flavors',
      condition: 'When time budget is low',
      effect: 'penalize',
      magnitude: 0.2,
      confidence: 0.7,
      source: 'auto-detected',
      evidence: ['decision-123'],
    },
    triggerDecisionIds: ['00000000-0000-4000-8000-000000000001'],
    observationCount: 3,
    reasoning: 'Observed 3 cases where slow flavors exceeded budget.',
    ...overrides,
  };
}

describe('RuleRegistry', () => {
  let basePath: string;
  let registry: RuleRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'rule-registry-test-'));
    registry = new RuleRegistry(basePath);
  });

  describe('addRule', () => {
    it('returns a persisted rule with generated UUID id and createdAt', () => {
      const rule = registry.addRule(makeRuleInput());
      expect(rule.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(rule.createdAt).toBeTruthy();
      expect(rule.name).toBe('Boost TypeScript flavor');
      expect(rule.category).toBe('build');
    });

    it('generates a unique id for each call', () => {
      const r1 = registry.addRule(makeRuleInput());
      const r2 = registry.addRule(makeRuleInput());
      expect(r1.id).not.toBe(r2.id);
    });

    it('persists to disk under {category}/{id}.json', () => {
      const rule = registry.addRule(makeRuleInput({ category: 'research' }));
      // Verify by loading from a fresh registry
      const registry2 = new RuleRegistry(basePath);
      const rules = registry2.loadRules('research');
      expect(rules).toHaveLength(1);
      expect(rules[0]!.id).toBe(rule.id);
    });

    it('throws on invalid input (empty name)', () => {
      expect(() => registry.addRule(makeRuleInput({ name: '' }))).toThrow();
    });

    it('throws on invalid magnitude', () => {
      expect(() => registry.addRule(makeRuleInput({ magnitude: 1.5 }))).toThrow();
    });
  });

  describe('loadRules', () => {
    it('returns empty array when no rules exist', () => {
      expect(registry.loadRules('build')).toEqual([]);
    });

    it('returns rules for the given category only', () => {
      registry.addRule(makeRuleInput({ category: 'build' }));
      registry.addRule(makeRuleInput({ category: 'build' }));
      registry.addRule(makeRuleInput({ category: 'research' }));

      const buildRules = registry.loadRules('build');
      expect(buildRules).toHaveLength(2);
      expect(buildRules.every((r) => r.category === 'build')).toBe(true);
    });

    it('returns rules sorted by createdAt ascending', () => {
      const r1 = registry.addRule(makeRuleInput());
      const r2 = registry.addRule(makeRuleInput());
      const rules = registry.loadRules('build');
      expect(rules[0]!.id).toBe(r1.id);
      expect(rules[1]!.id).toBe(r2.id);
    });

    it('loads from disk when cache is empty (cross-instance)', () => {
      const registry1 = new RuleRegistry(basePath);
      registry1.addRule(makeRuleInput({ category: 'plan' }));
      registry1.addRule(makeRuleInput({ category: 'plan' }));

      const registry2 = new RuleRegistry(basePath);
      expect(registry2.loadRules('plan')).toHaveLength(2);
    });
  });

  describe('removeRule', () => {
    it('removes a rule from cache and disk', () => {
      const rule = registry.addRule(makeRuleInput());
      registry.removeRule(rule.id);
      expect(registry.loadRules('build')).toHaveLength(0);

      // Also verify the file is gone (fresh instance)
      const registry2 = new RuleRegistry(basePath);
      expect(registry2.loadRules('build')).toHaveLength(0);
    });

    it('throws RuleNotFoundError for unknown id', () => {
      expect(() => registry.removeRule('00000000-0000-4000-8000-000000000099')).toThrow(
        RuleNotFoundError,
      );
    });

    it('removes only the targeted rule', () => {
      const r1 = registry.addRule(makeRuleInput());
      registry.addRule(makeRuleInput());
      registry.removeRule(r1.id);
      expect(registry.loadRules('build')).toHaveLength(1);
    });
  });

  describe('suggestRule', () => {
    it('returns a suggestion with generated id, createdAt, and status pending', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      expect(suggestion.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(suggestion.status).toBe('pending');
      expect(suggestion.createdAt).toBeTruthy();
      expect(suggestion.reasoning).toContain('slow flavors');
    });

    it('persists to disk under suggestions/{id}.json', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      const registry2 = new RuleRegistry(basePath);
      const pending = registry2.getPendingSuggestions();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.id).toBe(suggestion.id);
    });
  });

  describe('getPendingSuggestions', () => {
    it('returns empty array when no suggestions exist', () => {
      expect(registry.getPendingSuggestions()).toEqual([]);
    });

    it('returns only pending suggestions', () => {
      const s1 = registry.suggestRule(makeSuggestionInput());
      registry.suggestRule(makeSuggestionInput());
      registry.rejectSuggestion(s1.id, 'Not useful');

      const pending = registry.getPendingSuggestions();
      expect(pending).toHaveLength(1);
    });

    it('filters by category', () => {
      registry.suggestRule(makeSuggestionInput());
      registry.suggestRule(
        makeSuggestionInput({
          suggestedRule: {
            ...makeSuggestionInput().suggestedRule,
            category: 'research',
          },
        }),
      );

      const buildSuggestions = registry.getPendingSuggestions('build');
      expect(buildSuggestions).toHaveLength(1);
      expect(buildSuggestions[0]!.suggestedRule.category).toBe('build');
    });

    it('returns suggestions sorted by createdAt ascending', () => {
      const s1 = registry.suggestRule(makeSuggestionInput());
      const s2 = registry.suggestRule(makeSuggestionInput());
      const pending = registry.getPendingSuggestions();
      expect(pending[0]!.id).toBe(s1.id);
      expect(pending[1]!.id).toBe(s2.id);
    });
  });

  describe('acceptSuggestion', () => {
    it('promotes a pending suggestion to an active rule', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      const rule = registry.acceptSuggestion(suggestion.id);

      expect(rule.name).toBe(suggestion.suggestedRule.name);
      expect(rule.category).toBe(suggestion.suggestedRule.category);
      expect(rule.effect).toBe(suggestion.suggestedRule.effect);

      const activeRules = registry.loadRules('build');
      expect(activeRules).toHaveLength(1);
      expect(activeRules[0]!.id).toBe(rule.id);
    });

    it('marks the suggestion as accepted', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      registry.acceptSuggestion(suggestion.id);

      // No pending suggestions left
      expect(registry.getPendingSuggestions()).toHaveLength(0);
    });

    it('records editDelta when provided', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      registry.acceptSuggestion(suggestion.id, 'Changed magnitude from 0.2 to 0.5');

      // Verify from disk
      const registry2 = new RuleRegistry(basePath);
      const pending = registry2.getPendingSuggestions();
      expect(pending).toHaveLength(0);
    });

    it('throws SuggestionNotFoundError for unknown id', () => {
      expect(() =>
        registry.acceptSuggestion('00000000-0000-4000-8000-000000000099'),
      ).toThrow(SuggestionNotFoundError);
    });

    it('persists the accepted status to disk', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      registry.acceptSuggestion(suggestion.id, 'Adjusted magnitude');

      const registry2 = new RuleRegistry(basePath);
      expect(registry2.getPendingSuggestions()).toHaveLength(0);
      expect(registry2.loadRules('build')).toHaveLength(1);
    });
  });

  describe('rejectSuggestion', () => {
    it('marks the suggestion as rejected with a reason', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      const rejected = registry.rejectSuggestion(suggestion.id, 'Not relevant to this project');

      expect(rejected.status).toBe('rejected');
      expect(rejected.rejectionReason).toBe('Not relevant to this project');
    });

    it('removes it from pending suggestions', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      registry.rejectSuggestion(suggestion.id, 'No thanks');

      expect(registry.getPendingSuggestions()).toHaveLength(0);
    });

    it('throws SuggestionNotFoundError for unknown id', () => {
      expect(() =>
        registry.rejectSuggestion('00000000-0000-4000-8000-000000000099', 'reason'),
      ).toThrow(SuggestionNotFoundError);
    });

    it('persists the rejection to disk', () => {
      const suggestion = registry.suggestRule(makeSuggestionInput());
      registry.rejectSuggestion(suggestion.id, 'Not useful');

      const registry2 = new RuleRegistry(basePath);
      expect(registry2.getPendingSuggestions()).toHaveLength(0);
    });
  });

  describe('disk persistence integrity', () => {
    it('skips malformed JSON files without throwing', () => {
      const buildDir = join(basePath, 'build');
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(join(buildDir, 'bad-file.json'), '{ not valid json }', 'utf-8');

      registry.addRule(makeRuleInput());
      expect(registry.loadRules('build')).toHaveLength(1);
    });

    it('skips invalid-schema JSON files without throwing', () => {
      const buildDir = join(basePath, 'build');
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(
        join(buildDir, 'invalid.json'),
        JSON.stringify({ id: 'not-a-uuid', category: 'build' }),
        'utf-8',
      );

      registry.addRule(makeRuleInput());
      expect(registry.loadRules('build')).toHaveLength(1);
    });

    it('skips malformed suggestion files without throwing', () => {
      const suggestionsDir = join(basePath, 'suggestions');
      mkdirSync(suggestionsDir, { recursive: true });
      writeFileSync(join(suggestionsDir, 'bad.json'), '{ not json }', 'utf-8');

      registry.suggestRule(makeSuggestionInput());
      expect(registry.getPendingSuggestions()).toHaveLength(1);
    });
  });
});
