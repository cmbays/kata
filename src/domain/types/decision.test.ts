import { describe, it, expect } from 'vitest';
import { DecisionTypeSchema, DecisionOutcomeSchema, DecisionSchema } from './decision.js';

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_DATETIME = '2026-01-15T10:00:00.000Z';

function makeDecision(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: VALID_UUID,
    stageCategory: 'build',
    decisionType: 'flavor-selection',
    context: { betId: 'bet-123', availableArtifacts: [] },
    options: ['typescript-feature', 'bug-fix'],
    selection: 'typescript-feature',
    reasoning: 'The bet describes a new feature, not a bug fix.',
    confidence: 0.85,
    decidedAt: VALID_DATETIME,
    ...overrides,
  };
}

describe('DecisionTypeSchema', () => {
  const validTypes = [
    'flavor-selection',
    'execution-mode',
    'synthesis-approach',
    'retry',
    'confidence-gate',
  ] as const;

  it('accepts all five decision types', () => {
    for (const type of validTypes) {
      expect(DecisionTypeSchema.parse(type)).toBe(type);
    }
  });

  it('rejects unknown decision type', () => {
    expect(() => DecisionTypeSchema.parse('unknown-type')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => DecisionTypeSchema.parse('')).toThrow();
  });
});

describe('DecisionOutcomeSchema', () => {
  it('parses with only one field set — all individual fields are optional', () => {
    // Each field is individually optional, but at least one must be present.
    const result = DecisionOutcomeSchema.parse({ notes: 'Looked good.' });
    expect(result.notes).toBe('Looked good.');
    expect(result.artifactQuality).toBeUndefined();
    expect(result.gateResult).toBeUndefined();
    expect(result.reworkRequired).toBeUndefined();
  });

  it('accepts all valid artifactQuality values', () => {
    for (const q of ['good', 'partial', 'poor'] as const) {
      expect(DecisionOutcomeSchema.parse({ artifactQuality: q }).artifactQuality).toBe(q);
    }
  });

  it('accepts all valid gateResult values', () => {
    for (const r of ['passed', 'failed', 'skipped'] as const) {
      expect(DecisionOutcomeSchema.parse({ gateResult: r }).gateResult).toBe(r);
    }
  });

  it('accepts reworkRequired boolean', () => {
    expect(DecisionOutcomeSchema.parse({ reworkRequired: true }).reworkRequired).toBe(true);
    expect(DecisionOutcomeSchema.parse({ reworkRequired: false }).reworkRequired).toBe(false);
  });

  it('accepts notes string', () => {
    const result = DecisionOutcomeSchema.parse({ notes: 'Needed two rounds of review.' });
    expect(result.notes).toBe('Needed two rounds of review.');
  });

  it('accepts a fully-specified outcome', () => {
    const result = DecisionOutcomeSchema.parse({
      artifactQuality: 'partial',
      gateResult: 'failed',
      reworkRequired: true,
      notes: 'Confidence was too high for this context.',
    });
    expect(result.artifactQuality).toBe('partial');
    expect(result.gateResult).toBe('failed');
    expect(result.reworkRequired).toBe(true);
    expect(result.notes).toBe('Confidence was too high for this context.');
  });

  it('rejects empty object — at least one field must be set', () => {
    expect(() => DecisionOutcomeSchema.parse({})).toThrow(/At least one outcome field must be set/);
  });

  it('rejects invalid artifactQuality', () => {
    expect(() => DecisionOutcomeSchema.parse({ artifactQuality: 'excellent' })).toThrow();
  });

  it('rejects invalid gateResult', () => {
    expect(() => DecisionOutcomeSchema.parse({ gateResult: 'maybe' })).toThrow();
  });
});

describe('DecisionSchema', () => {
  it('parses a minimal valid decision', () => {
    const result = DecisionSchema.parse(makeDecision());
    expect(result.id).toBe(VALID_UUID);
    expect(result.stageCategory).toBe('build');
    expect(result.decisionType).toBe('flavor-selection');
    expect(result.selection).toBe('typescript-feature');
    expect(result.confidence).toBe(0.85);
    expect(result.outcome).toBeUndefined();
  });

  it('parses decision with all fields including outcome', () => {
    const result = DecisionSchema.parse(
      makeDecision({
        outcome: {
          artifactQuality: 'good',
          gateResult: 'passed',
          reworkRequired: false,
        },
      }),
    );
    expect(result.outcome?.artifactQuality).toBe('good');
    expect(result.outcome?.gateResult).toBe('passed');
    expect(result.outcome?.reworkRequired).toBe(false);
  });

  it('accepts all valid stage categories', () => {
    for (const cat of ['research', 'plan', 'build', 'review', 'wrapup'] as const) {
      expect(DecisionSchema.parse(makeDecision({ stageCategory: cat })).stageCategory).toBe(cat);
    }
  });

  it('accepts all valid decision types', () => {
    for (const type of [
      'flavor-selection',
      'execution-mode',
      'synthesis-approach',
      'retry',
      'confidence-gate',
    ] as const) {
      expect(
        DecisionSchema.parse(makeDecision({ decisionType: type })).decisionType,
      ).toBe(type);
    }
  });

  it('accepts context with arbitrary keys', () => {
    const result = DecisionSchema.parse(
      makeDecision({
        context: { betId: 'b1', artifacts: ['a.md'], nested: { count: 3 } },
      }),
    );
    expect(result.context['betId']).toBe('b1');
    expect(result.context['nested']).toEqual({ count: 3 });
  });

  it('accepts options with multiple entries', () => {
    const result = DecisionSchema.parse(
      makeDecision({ options: ['a', 'b', 'c'], selection: 'b' }),
    );
    expect(result.options).toHaveLength(3);
    expect(result.selection).toBe('b');
  });

  it('accepts confidence of exactly 0', () => {
    expect(DecisionSchema.parse(makeDecision({ confidence: 0 })).confidence).toBe(0);
  });

  it('accepts confidence of exactly 1', () => {
    expect(DecisionSchema.parse(makeDecision({ confidence: 1 })).confidence).toBe(1);
  });

  it('rejects missing id', () => {
    const { id: _id, ...rest } = makeDecision() as { id: string } & Record<string, unknown>;
    expect(() => DecisionSchema.parse(rest)).toThrow();
  });

  it('rejects non-UUID id', () => {
    expect(() => DecisionSchema.parse(makeDecision({ id: 'not-a-uuid' }))).toThrow();
  });

  it('rejects invalid stageCategory', () => {
    expect(() => DecisionSchema.parse(makeDecision({ stageCategory: 'deploy' }))).toThrow();
  });

  it('rejects invalid decisionType', () => {
    expect(() => DecisionSchema.parse(makeDecision({ decisionType: 'guess' }))).toThrow();
  });

  it('rejects empty options array', () => {
    expect(() => DecisionSchema.parse(makeDecision({ options: [] }))).toThrow();
  });

  it('rejects empty selection string', () => {
    expect(() => DecisionSchema.parse(makeDecision({ selection: '' }))).toThrow();
  });

  it('rejects empty reasoning string', () => {
    expect(() => DecisionSchema.parse(makeDecision({ reasoning: '' }))).toThrow();
  });

  it('rejects confidence below 0', () => {
    expect(() => DecisionSchema.parse(makeDecision({ confidence: -0.01 }))).toThrow();
  });

  it('rejects confidence above 1', () => {
    expect(() => DecisionSchema.parse(makeDecision({ confidence: 1.01 }))).toThrow();
  });

  it('rejects invalid datetime format', () => {
    expect(() => DecisionSchema.parse(makeDecision({ decidedAt: 'not-a-date' }))).toThrow();
  });

  it('rejects missing required field (stageCategory)', () => {
    const d = makeDecision();
    delete (d as Record<string, unknown>)['stageCategory'];
    expect(() => DecisionSchema.parse(d)).toThrow();
  });

  it('rejects selection not in options', () => {
    expect(() =>
      DecisionSchema.parse(makeDecision({ options: ['a', 'b'], selection: 'c' })),
    ).toThrow(/must be one of the available options/);
  });

  it('accepts selection when it exactly matches one of the options', () => {
    const result = DecisionSchema.parse(
      makeDecision({ options: ['typescript-feature', 'bug-fix'], selection: 'bug-fix' }),
    );
    expect(result.selection).toBe('bug-fix');
  });
});
