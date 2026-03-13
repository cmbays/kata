import { KataAgentConfidenceProfileSchema } from './kata-agent-confidence.js';
import { randomUUID } from 'node:crypto';

function validProfile(overrides: Record<string, unknown> = {}) {
  return {
    katakaId: randomUUID(),
    katakaName: 'test-agent',
    computedAt: new Date().toISOString(),
    domainScores: {},
    overallConfidence: 0.75,
    observationCount: 10,
    learningCount: 3,
    ...overrides,
  };
}

describe('KataAgentConfidenceProfileSchema', () => {
  it('parses a valid profile', () => {
    const data = validProfile();
    const result = KataAgentConfidenceProfileSchema.parse(data);
    expect(result.katakaId).toBe(data.katakaId);
    expect(result.katakaName).toBe('test-agent');
    expect(result.overallConfidence).toBe(0.75);
  });

  it('requires katakaId to be UUID format', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ katakaId: 'not-a-uuid' })),
    ).toThrow();
  });

  it('requires katakaName', () => {
    const data = validProfile();
    delete (data as Record<string, unknown>).katakaName;
    expect(() => KataAgentConfidenceProfileSchema.parse(data)).toThrow();
  });

  it('requires computedAt to be ISO datetime', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ computedAt: 'not-a-date' })),
    ).toThrow();
  });

  it('accepts overallConfidence of 0', () => {
    const result = KataAgentConfidenceProfileSchema.parse(validProfile({ overallConfidence: 0 }));
    expect(result.overallConfidence).toBe(0);
  });

  it('accepts overallConfidence of 1', () => {
    const result = KataAgentConfidenceProfileSchema.parse(validProfile({ overallConfidence: 1 }));
    expect(result.overallConfidence).toBe(1);
  });

  it('rejects overallConfidence greater than 1', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ overallConfidence: 1.5 })),
    ).toThrow();
  });

  it('rejects overallConfidence less than 0', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ overallConfidence: -0.1 })),
    ).toThrow();
  });

  it('allows empty domainScores record', () => {
    const result = KataAgentConfidenceProfileSchema.parse(validProfile({ domainScores: {} }));
    expect(result.domainScores).toEqual({});
  });

  it('parses domainScores entries matching DomainConfidenceScoreSchema', () => {
    const result = KataAgentConfidenceProfileSchema.parse(
      validProfile({
        domainScores: {
          'web-backend': {
            familiarity: 0.8,
            risk: 0.2,
            historical: 0.9,
            composite: 0.7,
            sampleSize: 5,
          },
        },
      }),
    );
    expect(result.domainScores['web-backend']?.composite).toBe(0.7);
  });

  it('rejects domainScores with invalid entries', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(
        validProfile({ domainScores: { bad: { familiarity: 'not-a-number' } } }),
      ),
    ).toThrow();
  });

  it('requires observationCount to be a non-negative integer', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ observationCount: -1 })),
    ).toThrow();
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ observationCount: 2.5 })),
    ).toThrow();
  });

  it('requires learningCount to be a non-negative integer', () => {
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ learningCount: -1 })),
    ).toThrow();
    expect(() =>
      KataAgentConfidenceProfileSchema.parse(validProfile({ learningCount: 1.5 })),
    ).toThrow();
  });
});
