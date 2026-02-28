import { randomUUID } from 'node:crypto';
import { ObservationSchema, FrictionTaxonomy, GapSeverity } from './observation.js';

const BASE = {
  id: randomUUID(),
  timestamp: '2024-01-01T00:00:00.000Z',
  content: 'test content',
};

describe('ObservationSchema — decision', () => {
  it('parses a minimal decision observation', () => {
    const obs = ObservationSchema.parse({ ...BASE, type: 'decision' });
    expect(obs.type).toBe('decision');
    expect(obs.katakaId).toBeUndefined();
  });

  it('accepts optional katakaId', () => {
    const obs = ObservationSchema.parse({ ...BASE, type: 'decision', katakaId: 'scout-ka' });
    expect(obs.katakaId).toBe('scout-ka');
  });
});

describe('ObservationSchema — prediction', () => {
  it('parses a prediction with quantitative fields', () => {
    const obs = ObservationSchema.parse({
      ...BASE,
      type: 'prediction',
      quantitative: { metric: 'test failures', predicted: 50, unit: 'percent reduction' },
      timeframe: '1 sprint',
    });
    expect(obs.type).toBe('prediction');
    if (obs.type === 'prediction') {
      expect(obs.quantitative?.metric).toBe('test failures');
      expect(obs.quantitative?.predicted).toBe(50);
      expect(obs.timeframe).toBe('1 sprint');
    }
  });

  it('parses a prediction with qualitative fields', () => {
    const obs = ObservationSchema.parse({
      ...BASE,
      type: 'prediction',
      qualitative: { expected: 'tests will pass more reliably' },
    });
    expect(obs.type).toBe('prediction');
    if (obs.type === 'prediction') {
      expect(obs.qualitative?.expected).toBe('tests will pass more reliably');
    }
  });

  it('parses a prediction with no type-specific fields (minimal)', () => {
    const obs = ObservationSchema.parse({ ...BASE, type: 'prediction' });
    expect(obs.type).toBe('prediction');
    if (obs.type === 'prediction') {
      expect(obs.quantitative).toBeUndefined();
      expect(obs.qualitative).toBeUndefined();
    }
  });
});

describe('ObservationSchema — friction', () => {
  it('parses a friction with all 5 taxonomy values', () => {
    const taxonomies = FrictionTaxonomy.options;
    expect(taxonomies).toHaveLength(5);

    for (const taxonomy of taxonomies) {
      const obs = ObservationSchema.parse({ ...BASE, type: 'friction', taxonomy });
      expect(obs.type).toBe('friction');
      if (obs.type === 'friction') {
        expect(obs.taxonomy).toBe(taxonomy);
      }
    }
  });

  it('accepts optional contradicts field', () => {
    const obs = ObservationSchema.parse({
      ...BASE,
      type: 'friction',
      taxonomy: 'stale-learning',
      contradicts: 'learning-uuid-123',
    });
    expect(obs.type).toBe('friction');
    if (obs.type === 'friction') {
      expect(obs.contradicts).toBe('learning-uuid-123');
    }
  });

  it('rejects missing taxonomy', () => {
    const result = ObservationSchema.safeParse({ ...BASE, type: 'friction' });
    expect(result.success).toBe(false);
  });
});

describe('ObservationSchema — gap', () => {
  it('parses a gap with all 3 severity values', () => {
    const severities = GapSeverity.options;
    expect(severities).toHaveLength(3);

    for (const severity of severities) {
      const obs = ObservationSchema.parse({ ...BASE, type: 'gap', severity });
      expect(obs.type).toBe('gap');
      if (obs.type === 'gap') {
        expect(obs.severity).toBe(severity);
      }
    }
  });

  it('rejects missing severity', () => {
    const result = ObservationSchema.safeParse({ ...BASE, type: 'gap' });
    expect(result.success).toBe(false);
  });
});

describe('ObservationSchema — outcome, assumption, insight', () => {
  it('parses all simple variants', () => {
    for (const type of ['outcome', 'assumption', 'insight'] as const) {
      const obs = ObservationSchema.parse({ ...BASE, type });
      expect(obs.type).toBe(type);
    }
  });
});

describe('ObservationSchema — validation', () => {
  it('rejects empty content', () => {
    const result = ObservationSchema.safeParse({ ...BASE, content: '', type: 'insight' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid UUID', () => {
    const result = ObservationSchema.safeParse({ ...BASE, id: 'not-a-uuid', type: 'insight' });
    expect(result.success).toBe(false);
  });

  it('rejects unknown type', () => {
    const result = ObservationSchema.safeParse({ ...BASE, type: 'unknown-type' });
    expect(result.success).toBe(false);
  });
});
