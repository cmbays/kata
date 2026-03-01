import type { SynthesisInput } from '@domain/types/synthesis.js';
import type { Observation } from '@domain/types/observation.js';
import type { Learning } from '@domain/types/learning.js';
import { filterForSynthesis } from './synthesis-filter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(timestamp: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id: crypto.randomUUID(),
    type: 'insight',
    timestamp,
    content: 'Test observation',
    ...overrides,
  } as Observation;
}

function makeLearning(confidence: number, archived = false, overrides: Partial<Learning> = {}): Learning {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    tier: 'stage',
    category: 'testing',
    content: 'Test learning',
    evidence: [],
    confidence,
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    usageCount: 0,
    versions: [],
    archived,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Learning;
}

function makeInput(
  depth: SynthesisInput['depth'],
  observations: Observation[],
  learnings: Learning[],
): SynthesisInput {
  return {
    id: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    depth,
    observations,
    learnings,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('filterForSynthesis', () => {
  describe('quick depth', () => {
    it('limits observations to top 10 by recency', () => {
      // Create 15 observations with different timestamps
      const observations: Observation[] = [];
      for (let i = 0; i < 15; i++) {
        const ts = new Date(2026, 0, i + 1).toISOString(); // Jan 1 through Jan 15
        observations.push(makeObservation(ts, { content: `Obs ${i + 1}` }));
      }

      const input = makeInput('quick', observations, []);
      const result = filterForSynthesis(input);

      expect(result.observations).toHaveLength(10);
      // Should have the 10 most recent (Jan 15 down to Jan 6)
      const timestamps = result.observations.map((o) => o.timestamp);
      const sorted = [...timestamps].sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
      expect(timestamps).toEqual(sorted);
    });

    it('returns all observations when 10 or fewer exist', () => {
      const observations = [
        makeObservation(new Date(2026, 0, 1).toISOString()),
        makeObservation(new Date(2026, 0, 2).toISOString()),
        makeObservation(new Date(2026, 0, 3).toISOString()),
      ];
      const input = makeInput('quick', observations, []);
      const result = filterForSynthesis(input);
      expect(result.observations).toHaveLength(3);
    });

    it('excludes archived learnings', () => {
      const learnings = [
        makeLearning(0.8, false),
        makeLearning(0.9, true), // archived — should be excluded
      ];
      const input = makeInput('quick', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(1);
      expect(result.learnings[0]!.archived).toBe(false);
    });

    it('excludes learnings with confidence <= 0.5', () => {
      const learnings = [
        makeLearning(0.3),  // below threshold
        makeLearning(0.5),  // at threshold — excluded (not strictly greater)
        makeLearning(0.6),  // above threshold — included
        makeLearning(0.9),  // above threshold — included
      ];
      const input = makeInput('quick', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(2);
      expect(result.learnings.every((l) => l.confidence > 0.5)).toBe(true);
    });

    it('excludes archived even if confidence is high', () => {
      const learnings = [
        makeLearning(1.0, true), // archived + high confidence — excluded
      ];
      const input = makeInput('quick', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(0);
    });

    it('returns empty arrays when no data provided', () => {
      const input = makeInput('quick', [], []);
      const result = filterForSynthesis(input);
      expect(result.observations).toHaveLength(0);
      expect(result.learnings).toHaveLength(0);
    });
  });

  describe('standard depth', () => {
    it('returns all observations without truncation', () => {
      const observations: Observation[] = [];
      for (let i = 0; i < 25; i++) {
        observations.push(makeObservation(new Date(2026, 0, i + 1).toISOString()));
      }
      const input = makeInput('standard', observations, []);
      const result = filterForSynthesis(input);
      expect(result.observations).toHaveLength(25);
    });

    it('excludes archived learnings', () => {
      const learnings = [
        makeLearning(0.8, false),
        makeLearning(0.9, true), // archived
      ];
      const input = makeInput('standard', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(1);
    });

    it('excludes learnings with confidence <= 0.3', () => {
      const learnings = [
        makeLearning(0.2),  // below — excluded
        makeLearning(0.3),  // at threshold — excluded (not strictly greater)
        makeLearning(0.31), // just above — included
        makeLearning(0.8),  // above — included
      ];
      const input = makeInput('standard', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(2);
      expect(result.learnings.every((l) => l.confidence > 0.3)).toBe(true);
    });

    it('includes more learnings than quick depth given same data', () => {
      const learnings = [
        makeLearning(0.35), // excluded by quick (<=0.5), included by standard (>0.3)
        makeLearning(0.6),
        makeLearning(0.9),
      ];
      const input = makeInput('standard', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(3);

      const quickInput = makeInput('quick', [], learnings);
      const quickResult = filterForSynthesis(quickInput);
      expect(quickResult.learnings).toHaveLength(2);
    });
  });

  describe('thorough depth', () => {
    it('returns all observations without truncation', () => {
      const observations: Observation[] = [];
      for (let i = 0; i < 30; i++) {
        observations.push(makeObservation(new Date(2026, 0, i + 1).toISOString()));
      }
      const input = makeInput('thorough', observations, []);
      const result = filterForSynthesis(input);
      expect(result.observations).toHaveLength(30);
    });

    it('includes archived learnings', () => {
      const learnings = [
        makeLearning(0.8, false),
        makeLearning(0.9, true),  // archived — included in thorough
        makeLearning(0.1, true),  // archived + low confidence — included in thorough
      ];
      const input = makeInput('thorough', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(3);
    });

    it('includes low-confidence learnings', () => {
      const learnings = [
        makeLearning(0.0),
        makeLearning(0.1),
        makeLearning(0.5),
      ];
      const input = makeInput('thorough', [], learnings);
      const result = filterForSynthesis(input);
      expect(result.learnings).toHaveLength(3);
    });

    it('returns more learnings than quick and standard for same data', () => {
      const learnings = [
        makeLearning(0.1, true),   // archived + low confidence
        makeLearning(0.4, false),  // not archived, medium confidence
        makeLearning(0.8, false),  // not archived, high confidence
      ];
      const thorough = filterForSynthesis(makeInput('thorough', [], learnings));
      const standard = filterForSynthesis(makeInput('standard', [], learnings));
      const quick = filterForSynthesis(makeInput('quick', [], learnings));

      expect(thorough.learnings).toHaveLength(3);
      expect(standard.learnings).toHaveLength(2); // excludes archived
      expect(quick.learnings).toHaveLength(1);     // excludes archived and confidence <= 0.5
    });
  });
});
