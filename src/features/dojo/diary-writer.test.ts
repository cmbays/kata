import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import type { BetOutcomeRecord } from '@features/cycle-management/cooldown-session.js';
import type { CycleProposal } from '@features/cycle-management/proposal-generator.js';
import type { RunSummary } from '@features/cycle-management/types.js';
import { DiaryWriter, type DiaryWriterInput } from './diary-writer.js';

let tempDir: string;
let store: DiaryStore;
let writer: DiaryWriter;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-diary-writer-test-'));
  store = new DiaryStore(tempDir);
  writer = new DiaryWriter(store);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeProposal(overrides: Partial<CycleProposal> = {}): CycleProposal {
  return {
    id: crypto.randomUUID(),
    description: 'Improve gate evaluation',
    rationale: 'Gate failures were frequent',
    suggestedAppetite: 30,
    priority: 'medium',
    source: 'unfinished',
    ...overrides,
  };
}

function makeRunSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    betId: crypto.randomUUID(),
    runId: crypto.randomUUID(),
    stagesCompleted: 2,
    gapCount: 1,
    gapsBySeverity: { low: 1, medium: 0, high: 0 },
    avgConfidence: 0.8,
    artifactPaths: [],
    stageDetails: [
      { category: 'build', selectedFlavors: ['typescript-feature'], gaps: [] },
    ],
    yoloDecisionCount: 0,
    ...overrides,
  };
}

function makeBetOutcome(overrides: Partial<BetOutcomeRecord> = {}): BetOutcomeRecord {
  return {
    betId: crypto.randomUUID(),
    outcome: 'complete',
    ...overrides,
  };
}

function makeInput(overrides: Partial<DiaryWriterInput> = {}): DiaryWriterInput {
  return {
    cycleId: crypto.randomUUID(),
    betOutcomes: [],
    proposals: [],
    learningsCaptured: 0,
    ...overrides,
  };
}

describe('DiaryWriter', () => {
  describe('write() with rich narrative', () => {
    it('uses the provided narrative instead of generating one', () => {
      const input = makeInput({
        narrative: 'This was a great cycle!',
        betOutcomes: [makeBetOutcome()],
      });

      const entry = writer.write(input);

      expect(entry.narrative).toBe('This was a great cycle!');
    });

    it('returns a valid DojoDiaryEntry with all fields', () => {
      const input = makeInput({
        narrative: 'Custom narrative',
        cycleName: 'Sprint Alpha',
        betOutcomes: [makeBetOutcome()],
      });

      const entry = writer.write(input);

      expect(entry.id).toBeDefined();
      expect(entry.cycleId).toBe(input.cycleId);
      expect(entry.cycleName).toBe('Sprint Alpha');
      expect(entry.narrative).toBe('Custom narrative');
      expect(entry.createdAt).toBeDefined();
    });
  });

  describe('write() with fallback narrative', () => {
    it('generates a narrative when none is provided', () => {
      const input = makeInput({
        cycleName: 'Wave F',
        betOutcomes: [
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'partial' }),
        ],
        learningsCaptured: 3,
        proposals: [makeProposal()],
      });

      const entry = writer.write(input);

      expect(entry.narrative).toContain("Cycle 'Wave F'");
      expect(entry.narrative).toContain('1/2 bets fully delivered');
      expect(entry.narrative).toContain('1 bet(s) partially completed');
      expect(entry.narrative).toContain('3 learning(s) captured');
      expect(entry.narrative).toContain('1 proposal(s) generated');
    });

    it('uses cycleId when cycleName is absent', () => {
      const cycleId = crypto.randomUUID();
      const input = makeInput({
        cycleId,
        betOutcomes: [makeBetOutcome({ outcome: 'complete' })],
      });

      const entry = writer.write(input);

      expect(entry.narrative).toContain(`Cycle ${cycleId}`);
    });

    it('includes abandoned count in the narrative', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'abandoned' }),
          makeBetOutcome({ outcome: 'abandoned' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.narrative).toContain('2 bet(s) abandoned');
    });
  });

  describe('extractWins', () => {
    it('only includes complete bets as wins', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'complete', notes: 'Shipped feature X' }),
          makeBetOutcome({ outcome: 'partial' }),
          makeBetOutcome({ outcome: 'abandoned' }),
          makeBetOutcome({ outcome: 'complete' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.wins).toHaveLength(2);
      expect(entry.wins[0]).toContain('Shipped feature X');
      expect(entry.wins[1]).toBe('Completed bet');
    });

    it('returns empty wins when no bets are complete', () => {
      const input = makeInput({
        betOutcomes: [makeBetOutcome({ outcome: 'partial' })],
      });

      const entry = writer.write(input);

      expect(entry.wins).toEqual([]);
    });
  });

  describe('extractPainPoints', () => {
    it('includes abandoned bets as pain points', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'abandoned', notes: 'Scope too large' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.painPoints).toContain('Abandoned bet: Scope too large');
    });

    it('includes partial bets as pain points', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'partial', notes: 'Ran out of time' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.painPoints).toContain('Partial completion: Ran out of time');
    });

    it('includes high-severity gaps from run summaries', () => {
      const runId = crypto.randomUUID();
      const input = makeInput({
        runSummaries: [
          makeRunSummary({
            runId,
            gapsBySeverity: { low: 0, medium: 0, high: 2 },
          }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.painPoints).toContainEqual(
        expect.stringContaining(`High-severity gaps in run ${runId.slice(0, 8)}`),
      );
    });

    it('omits run summaries with no high-severity gaps', () => {
      const input = makeInput({
        runSummaries: [
          makeRunSummary({ gapsBySeverity: { low: 3, medium: 1, high: 0 } }),
        ],
      });

      const entry = writer.write(input);

      const gapPoints = entry.painPoints.filter((p) => p.includes('High-severity'));
      expect(gapPoints).toHaveLength(0);
    });
  });

  describe('extractOpenQuestions', () => {
    it('extracts descriptions from high and medium priority proposals', () => {
      const input = makeInput({
        proposals: [
          makeProposal({ priority: 'high', description: 'Fix auth flow' }),
          makeProposal({ priority: 'medium', description: 'Improve logging' }),
          makeProposal({ priority: 'low', description: 'Update docs' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.openQuestions).toContain('Fix auth flow');
      expect(entry.openQuestions).toContain('Improve logging');
      expect(entry.openQuestions).not.toContain('Update docs');
    });

    it('limits to 5 open questions', () => {
      const proposals = Array.from({ length: 8 }, (_, i) =>
        makeProposal({ priority: 'high', description: `Question ${i + 1}` }),
      );
      const input = makeInput({ proposals });

      const entry = writer.write(input);

      expect(entry.openQuestions).toHaveLength(5);
    });

    it('returns empty when all proposals are low priority', () => {
      const input = makeInput({
        proposals: [
          makeProposal({ priority: 'low' }),
          makeProposal({ priority: 'low' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.openQuestions).toEqual([]);
    });
  });

  describe('inferMood', () => {
    it('returns energized when >80% bets complete', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'complete' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.mood).toBe('energized');
    });

    it('returns steady when 50-80% bets complete', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'complete' }),
          makeBetOutcome({ outcome: 'partial' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.mood).toBe('steady');
    });

    it('returns frustrated when <50% bets complete', () => {
      const input = makeInput({
        betOutcomes: [
          makeBetOutcome({ outcome: 'abandoned' }),
          makeBetOutcome({ outcome: 'abandoned' }),
          makeBetOutcome({ outcome: 'complete' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.mood).toBe('frustrated');
    });

    it('returns reflective when no bets exist', () => {
      const input = makeInput({ betOutcomes: [] });

      const entry = writer.write(input);

      expect(entry.mood).toBe('reflective');
    });

    it('returns energized when above 80% completion', () => {
      // 5 out of 6 = 83.3% > 80%
      const input = makeInput({
        betOutcomes: [
          ...Array.from({ length: 5 }, () => makeBetOutcome({ outcome: 'complete' })),
          makeBetOutcome({ outcome: 'partial' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.mood).toBe('energized');
    });

    it('returns steady at exactly 80% (boundary)', () => {
      // 4 out of 5 = 80% — ratio is NOT > 0.8, so steady
      const input = makeInput({
        betOutcomes: [
          ...Array.from({ length: 4 }, () => makeBetOutcome({ outcome: 'complete' })),
          makeBetOutcome({ outcome: 'partial' }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.mood).toBe('steady');
    });
  });

  describe('extractTags', () => {
    it('extracts stage categories from run summaries', () => {
      const input = makeInput({
        runSummaries: [
          makeRunSummary({
            stageDetails: [
              { category: 'build', selectedFlavors: [], gaps: [] },
              { category: 'review', selectedFlavors: [], gaps: [] },
            ],
          }),
        ],
      });

      const entry = writer.write(input);

      expect(entry.tags).toContain('build');
      expect(entry.tags).toContain('review');
    });

    it('adds abandoned-bets tag when bets are abandoned', () => {
      const input = makeInput({
        betOutcomes: [makeBetOutcome({ outcome: 'abandoned' })],
      });

      const entry = writer.write(input);

      expect(entry.tags).toContain('abandoned-bets');
    });

    it('adds learnings tag when learnings were captured', () => {
      const input = makeInput({ learningsCaptured: 5 });

      const entry = writer.write(input);

      expect(entry.tags).toContain('learnings');
    });

    it('returns tags sorted alphabetically', () => {
      const input = makeInput({
        learningsCaptured: 1,
        betOutcomes: [makeBetOutcome({ outcome: 'abandoned' })],
        runSummaries: [
          makeRunSummary({
            stageDetails: [
              { category: 'research', selectedFlavors: [], gaps: [] },
              { category: 'build', selectedFlavors: [], gaps: [] },
            ],
          }),
        ],
      });

      const entry = writer.write(input);

      const sorted = [...entry.tags].sort();
      expect(entry.tags).toEqual(sorted);
    });

    it('deduplicates stage categories across multiple summaries', () => {
      const input = makeInput({
        runSummaries: [
          makeRunSummary({
            stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [] }],
          }),
          makeRunSummary({
            stageDetails: [{ category: 'build', selectedFlavors: [], gaps: [] }],
          }),
        ],
      });

      const entry = writer.write(input);

      const buildCount = entry.tags.filter((t) => t === 'build').length;
      expect(buildCount).toBe(1);
    });
  });

  describe('store persistence', () => {
    it('persists the entry to DiaryStore and can be read back', () => {
      const input = makeInput({
        cycleName: 'Persistent Cycle',
        narrative: 'Stored narrative',
        betOutcomes: [makeBetOutcome({ outcome: 'complete' })],
      });

      const entry = writer.write(input);

      const readBack = store.readByCycleId(input.cycleId);
      expect(readBack).not.toBeNull();
      expect(readBack!.id).toBe(entry.id);
      expect(readBack!.narrative).toBe('Stored narrative');
      expect(readBack!.cycleName).toBe('Persistent Cycle');
    });
  });

  describe('full round-trip', () => {
    it('produces a valid DojoDiaryEntry with all computed fields', () => {
      const input = makeInput({
        cycleName: 'Full Cycle',
        betOutcomes: [
          makeBetOutcome({ outcome: 'complete', notes: 'Feature shipped' }),
          makeBetOutcome({ outcome: 'partial', notes: 'Needs polish' }),
          makeBetOutcome({ outcome: 'abandoned', notes: 'Descoped' }),
        ],
        proposals: [
          makeProposal({ priority: 'high', description: 'Finish polish' }),
          makeProposal({ priority: 'low', description: 'Nice to have' }),
        ],
        runSummaries: [
          makeRunSummary({
            gapsBySeverity: { low: 1, medium: 2, high: 1 },
            stageDetails: [
              { category: 'build', selectedFlavors: ['ts'], gaps: [{ description: 'missing tests', severity: 'high' }] },
              { category: 'review', selectedFlavors: ['code-review'], gaps: [] },
            ],
          }),
        ],
        learningsCaptured: 2,
      });

      const entry = writer.write(input);

      // Validate structure
      expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(entry.cycleId).toBe(input.cycleId);
      expect(entry.cycleName).toBe('Full Cycle');
      expect(entry.narrative).toBeDefined();
      expect(entry.wins).toHaveLength(1);
      expect(entry.painPoints.length).toBeGreaterThan(0);
      expect(entry.openQuestions).toContain('Finish polish');
      expect(entry.openQuestions).not.toContain('Nice to have');
      expect(entry.mood).toBe('frustrated'); // 1/3 = 33%
      expect(entry.tags).toContain('build');
      expect(entry.tags).toContain('review');
      expect(entry.tags).toContain('abandoned-bets');
      expect(entry.tags).toContain('learnings');
      expect(entry.createdAt).toBeDefined();
    });
  });
});
