import { randomUUID } from 'node:crypto';
import { ReflectionSchema, FrictionResolutionPath } from './reflection.js';

const BASE = {
  id: randomUUID(),
  timestamp: '2024-01-01T00:00:00.000Z',
  observationIds: [],
};

const OBS_ID  = randomUUID();
const PRED_ID = randomUUID();
const OUT_ID  = randomUUID();
const FRIC_ID = randomUUID();

describe('ReflectionSchema — calibration', () => {
  it('parses a calibration reflection', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'calibration',
      domain: 'typescript',
      totalPredictions: 10,
      correctPredictions: 7,
      accuracyRate: 0.7,
    });
    expect(ref.type).toBe('calibration');
    if (ref.type === 'calibration') {
      expect(ref.domain).toBe('typescript');
      expect(ref.accuracyRate).toBe(0.7);
    }
  });

  it('accepts optional katakaId and bias', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'calibration',
      domain: 'react',
      katakaId: 'builder-ka',
      totalPredictions: 5,
      correctPredictions: 3,
      accuracyRate: 0.6,
      bias: 'overconfidence',
    });
    if (ref.type === 'calibration') {
      expect(ref.katakaId).toBe('builder-ka');
      expect(ref.bias).toBe('overconfidence');
    }
  });

  it('rejects accuracyRate > 1', () => {
    const result = ReflectionSchema.safeParse({
      ...BASE,
      type: 'calibration',
      domain: 'go',
      totalPredictions: 5,
      correctPredictions: 5,
      accuracyRate: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReflectionSchema — validation', () => {
  it('parses a correct prediction validation', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'validation',
      predictionId: PRED_ID,
      outcomeId: OUT_ID,
      correct: true,
    });
    expect(ref.type).toBe('validation');
    if (ref.type === 'validation') {
      expect(ref.correct).toBe(true);
    }
  });

  it('parses an incorrect prediction validation with notes', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'validation',
      predictionId: PRED_ID,
      outcomeId: OUT_ID,
      correct: false,
      notes: 'Build took much longer than predicted',
    });
    if (ref.type === 'validation') {
      expect(ref.correct).toBe(false);
      expect(ref.notes).toBe('Build took much longer than predicted');
    }
  });
});

describe('ReflectionSchema — resolution', () => {
  it('parses all 4 resolution paths', () => {
    const paths = FrictionResolutionPath.options;
    expect(paths).toHaveLength(4);

    for (const path of paths) {
      const ref = ReflectionSchema.parse({
        ...BASE,
        type: 'resolution',
        frictionId: FRIC_ID,
        path,
        summary: 'Friction was resolved',
      });
      expect(ref.type).toBe('resolution');
      if (ref.type === 'resolution') {
        expect(ref.path).toBe(path);
      }
    }
  });

  it('rejects missing summary', () => {
    const result = ReflectionSchema.safeParse({
      ...BASE,
      type: 'resolution',
      frictionId: FRIC_ID,
      path: 'invalidate',
    });
    expect(result.success).toBe(false);
  });
});

describe('ReflectionSchema — unmatched', () => {
  it('parses an unmatched reflection', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'unmatched',
      predictionId: PRED_ID,
    });
    expect(ref.type).toBe('unmatched');
    if (ref.type === 'unmatched') {
      expect(ref.predictionId).toBe(PRED_ID);
    }
  });

  it('accepts optional reason', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'unmatched',
      predictionId: PRED_ID,
      reason: 'Run ended before outcome could be measured',
    });
    if (ref.type === 'unmatched') {
      expect(ref.reason).toBeDefined();
    }
  });
});

describe('ReflectionSchema — synthesis', () => {
  it('parses a synthesis reflection', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'synthesis',
      sourceReflectionIds: [OBS_ID],
      insight: 'TDD calibration improves over time in this codebase',
    });
    expect(ref.type).toBe('synthesis');
    if (ref.type === 'synthesis') {
      expect(ref.insight).toContain('TDD');
      expect(ref.sourceReflectionIds).toHaveLength(1);
    }
  });

  it('defaults sourceReflectionIds to empty array', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      type: 'synthesis',
      insight: 'Some insight',
    });
    if (ref.type === 'synthesis') {
      expect(ref.sourceReflectionIds).toEqual([]);
    }
  });
});

describe('ReflectionSchema — shared fields', () => {
  it('defaults observationIds to empty array', () => {
    const ref = ReflectionSchema.parse({
      id: BASE.id,
      timestamp: BASE.timestamp,
      type: 'unmatched',
      predictionId: PRED_ID,
    });
    expect(ref.observationIds).toEqual([]);
  });

  it('accepts observationIds', () => {
    const ref = ReflectionSchema.parse({
      ...BASE,
      observationIds: [OBS_ID],
      type: 'unmatched',
      predictionId: PRED_ID,
    });
    expect(ref.observationIds).toEqual([OBS_ID]);
  });
});
