import { describe, it, expect } from 'vitest';
import {
  RuleEffectSchema,
  RuleSourceSchema,
  StageRuleSchema,
  RuleSuggestionStatusSchema,
  RuleSuggestionSchema,
} from './rule.js';

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';
const VALID_DATETIME = '2026-01-15T10:00:00.000Z';

function makeRule(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    category: 'build',
    name: 'Boost TDD flavor',
    condition: 'When test files exist in the project',
    effect: 'boost',
    magnitude: 0.3,
    confidence: 0.8,
    source: 'auto-detected',
    evidence: ['decision-1', 'decision-2'],
    createdAt: VALID_DATETIME,
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    suggestedRule: {
      category: 'build',
      name: 'Penalize legacy flavor',
      condition: 'When project uses ESM modules',
      effect: 'penalize',
      magnitude: 0.5,
      confidence: 0.7,
      source: 'auto-detected',
      evidence: ['Observed poor outcomes with legacy flavor'],
    },
    triggerDecisionIds: [VALID_UUID_2],
    observationCount: 3,
    reasoning: 'Legacy flavor produced rework in 3 out of 4 ESM projects.',
    status: 'pending',
    createdAt: VALID_DATETIME,
    ...overrides,
  };
}

describe('RuleEffectSchema', () => {
  it('accepts all four effects', () => {
    for (const effect of ['boost', 'penalize', 'require', 'exclude'] as const) {
      expect(RuleEffectSchema.parse(effect)).toBe(effect);
    }
  });

  it('rejects unknown effect', () => {
    expect(() => RuleEffectSchema.parse('amplify')).toThrow();
  });
});

describe('RuleSourceSchema', () => {
  it('accepts all three sources', () => {
    for (const source of ['auto-detected', 'user-created', 'imported'] as const) {
      expect(RuleSourceSchema.parse(source)).toBe(source);
    }
  });

  it('rejects unknown source', () => {
    expect(() => RuleSourceSchema.parse('generated')).toThrow();
  });
});

describe('RuleSuggestionStatusSchema', () => {
  it('accepts all three statuses', () => {
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      expect(RuleSuggestionStatusSchema.parse(status)).toBe(status);
    }
  });

  it('rejects unknown status', () => {
    expect(() => RuleSuggestionStatusSchema.parse('deferred')).toThrow();
  });
});

describe('StageRuleSchema', () => {
  it('parses a valid rule', () => {
    const result = StageRuleSchema.parse(makeRule());
    expect(result.id).toBe(VALID_UUID);
    expect(result.category).toBe('build');
    expect(result.name).toBe('Boost TDD flavor');
    expect(result.effect).toBe('boost');
    expect(result.magnitude).toBe(0.3);
    expect(result.confidence).toBe(0.8);
    expect(result.source).toBe('auto-detected');
    expect(result.evidence).toHaveLength(2);
    expect(result.createdAt).toBe(VALID_DATETIME);
  });

  it('accepts all four effects', () => {
    for (const effect of ['boost', 'penalize', 'require', 'exclude'] as const) {
      const result = StageRuleSchema.parse(makeRule({ effect }));
      expect(result.effect).toBe(effect);
    }
  });

  it('accepts all three sources', () => {
    for (const source of ['auto-detected', 'user-created', 'imported'] as const) {
      const result = StageRuleSchema.parse(makeRule({ source }));
      expect(result.source).toBe(source);
    }
  });

  it('accepts all four stage categories', () => {
    for (const category of ['research', 'plan', 'build', 'review'] as const) {
      const result = StageRuleSchema.parse(makeRule({ category }));
      expect(result.category).toBe(category);
    }
  });

  it('accepts magnitude boundary values 0 and 1', () => {
    expect(StageRuleSchema.parse(makeRule({ magnitude: 0 })).magnitude).toBe(0);
    expect(StageRuleSchema.parse(makeRule({ magnitude: 1 })).magnitude).toBe(1);
  });

  it('accepts confidence boundary values 0 and 1', () => {
    expect(StageRuleSchema.parse(makeRule({ confidence: 0 })).confidence).toBe(0);
    expect(StageRuleSchema.parse(makeRule({ confidence: 1 })).confidence).toBe(1);
  });

  it('accepts empty evidence array', () => {
    const result = StageRuleSchema.parse(makeRule({ evidence: [] }));
    expect(result.evidence).toEqual([]);
  });

  it('rejects non-UUID id', () => {
    expect(() => StageRuleSchema.parse(makeRule({ id: 'not-a-uuid' }))).toThrow();
  });

  it('rejects missing id', () => {
    const { id: _id, ...rest } = makeRule() as { id: string } & Record<string, unknown>;
    expect(() => StageRuleSchema.parse(rest)).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => StageRuleSchema.parse(makeRule({ name: '' }))).toThrow();
  });

  it('rejects empty condition', () => {
    expect(() => StageRuleSchema.parse(makeRule({ condition: '' }))).toThrow();
  });

  it('rejects magnitude below 0', () => {
    expect(() => StageRuleSchema.parse(makeRule({ magnitude: -0.1 }))).toThrow();
  });

  it('rejects magnitude above 1', () => {
    expect(() => StageRuleSchema.parse(makeRule({ magnitude: 1.1 }))).toThrow();
  });

  it('rejects confidence below 0', () => {
    expect(() => StageRuleSchema.parse(makeRule({ confidence: -0.1 }))).toThrow();
  });

  it('rejects confidence above 1', () => {
    expect(() => StageRuleSchema.parse(makeRule({ confidence: 1.1 }))).toThrow();
  });

  it('rejects invalid stage category', () => {
    expect(() => StageRuleSchema.parse(makeRule({ category: 'deploy' }))).toThrow();
  });

  it('rejects invalid effect', () => {
    expect(() => StageRuleSchema.parse(makeRule({ effect: 'amplify' }))).toThrow();
  });

  it('rejects invalid source', () => {
    expect(() => StageRuleSchema.parse(makeRule({ source: 'generated' }))).toThrow();
  });

  it('rejects invalid datetime', () => {
    expect(() => StageRuleSchema.parse(makeRule({ createdAt: 'not-a-date' }))).toThrow();
  });
});

describe('RuleSuggestionSchema', () => {
  it('parses a valid suggestion', () => {
    const result = RuleSuggestionSchema.parse(makeSuggestion());
    expect(result.id).toBe(VALID_UUID);
    expect(result.suggestedRule.name).toBe('Penalize legacy flavor');
    expect(result.suggestedRule.effect).toBe('penalize');
    expect(result.triggerDecisionIds).toEqual([VALID_UUID_2]);
    expect(result.observationCount).toBe(3);
    expect(result.reasoning).toBe('Legacy flavor produced rework in 3 out of 4 ESM projects.');
    expect(result.status).toBe('pending');
    expect(result.editDelta).toBeUndefined();
    expect(result.rejectionReason).toBeUndefined();
  });

  it('accepts all three statuses', () => {
    for (const status of ['pending', 'accepted', 'rejected'] as const) {
      const result = RuleSuggestionSchema.parse(makeSuggestion({ status }));
      expect(result.status).toBe(status);
    }
  });

  it('accepts optional editDelta', () => {
    const result = RuleSuggestionSchema.parse(
      makeSuggestion({ editDelta: 'Adjusted magnitude from 0.5 to 0.3' }),
    );
    expect(result.editDelta).toBe('Adjusted magnitude from 0.5 to 0.3');
  });

  it('accepts optional rejectionReason', () => {
    const result = RuleSuggestionSchema.parse(
      makeSuggestion({ status: 'rejected', rejectionReason: 'Not enough evidence yet.' }),
    );
    expect(result.rejectionReason).toBe('Not enough evidence yet.');
  });

  it('suggestedRule omits id and createdAt', () => {
    // Providing id or createdAt in suggestedRule should fail or be stripped
    const suggestion = makeSuggestion();
    // The suggestedRule should not have id or createdAt
    expect(suggestion.suggestedRule).not.toHaveProperty('id');
    expect(suggestion.suggestedRule).not.toHaveProperty('createdAt');
  });

  it('rejects non-UUID id', () => {
    expect(() => RuleSuggestionSchema.parse(makeSuggestion({ id: 'bad-id' }))).toThrow();
  });

  it('rejects non-UUID triggerDecisionIds', () => {
    expect(() =>
      RuleSuggestionSchema.parse(makeSuggestion({ triggerDecisionIds: ['not-uuid'] })),
    ).toThrow();
  });

  it('rejects observationCount of zero', () => {
    expect(() =>
      RuleSuggestionSchema.parse(makeSuggestion({ observationCount: 0 })),
    ).toThrow();
  });

  it('rejects negative observationCount', () => {
    expect(() =>
      RuleSuggestionSchema.parse(makeSuggestion({ observationCount: -1 })),
    ).toThrow();
  });

  it('rejects empty reasoning', () => {
    expect(() => RuleSuggestionSchema.parse(makeSuggestion({ reasoning: '' }))).toThrow();
  });

  it('rejects invalid status', () => {
    expect(() => RuleSuggestionSchema.parse(makeSuggestion({ status: 'deferred' }))).toThrow();
  });

  it('rejects invalid datetime', () => {
    expect(() =>
      RuleSuggestionSchema.parse(makeSuggestion({ createdAt: 'not-a-date' })),
    ).toThrow();
  });

  it('rejects empty triggerDecisionIds if array is provided', () => {
    // Empty array is valid — no trigger decisions required
    const result = RuleSuggestionSchema.parse(makeSuggestion({ triggerDecisionIds: [] }));
    expect(result.triggerDecisionIds).toEqual([]);
  });
});
