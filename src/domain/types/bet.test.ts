import { describe, it, expect } from 'vitest';
import { BetOutcome, BetSchema } from './bet.js';

const uuid = () => crypto.randomUUID();

describe('BetOutcome', () => {
  it('accepts all outcomes', () => {
    for (const o of ['pending', 'complete', 'partial', 'abandoned']) {
      expect(BetOutcome.parse(o)).toBe(o);
    }
  });
});

describe('BetSchema', () => {
  it('parses minimal bet with defaults', () => {
    const result = BetSchema.parse({
      id: uuid(),
      description: 'Build methodology engine',
      appetite: 60,
    });
    expect(result.outcome).toBe('pending');
    expect(result.issueRefs).toEqual([]);
  });

  it('parses full bet', () => {
    const result = BetSchema.parse({
      id: uuid(),
      description: 'Implement learning memory system',
      appetite: 25,
      projectRef: 'cmbays/kata',
      issueRefs: ['#5', '#6'],
      outcome: 'complete',
      outcomeNotes: 'Shipped in 3 sessions',
    });
    expect(result.projectRef).toBe('cmbays/kata');
    expect(result.issueRefs).toHaveLength(2);
    expect(result.outcomeNotes).toBe('Shipped in 3 sessions');
  });

  it('rejects appetite over 100', () => {
    expect(() =>
      BetSchema.parse({ id: uuid(), description: 'test', appetite: 101 })
    ).toThrow();
  });

  it('rejects negative appetite', () => {
    expect(() =>
      BetSchema.parse({ id: uuid(), description: 'test', appetite: -1 })
    ).toThrow();
  });

  it('rejects empty description', () => {
    expect(() =>
      BetSchema.parse({ id: uuid(), description: '', appetite: 50 })
    ).toThrow();
  });
});
