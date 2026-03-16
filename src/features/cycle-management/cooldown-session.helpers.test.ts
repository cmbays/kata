import { join } from 'node:path';
import {
  buildBeltAdvancementMessage,
  buildAgentPerspectiveFromProposals,
  buildCooldownBudgetUsage,
  buildExpiryCheckMessages,
  buildCooldownLearningDrafts,
  buildDiaryBetOutcomesFromCycleBets,
  buildDojoSessionBuildRequest,
  buildSynthesisInputRecord,
  clampConfidenceWithDelta,
  collectBridgeRunIds,
  filterExecutionHistoryForCycle,
  hasFailedCaptures,
  hasMethod,
  hasObservations,
  isJsonFile,
  isSyncableBet,
  isSynthesisPendingFile,
  listCompletedBetDescriptions,
  mapBridgeRunStatusToIncompleteStatus,
  mapBridgeRunStatusToSyncedOutcome,
  resolveAppliedProposalIds,
  selectEffectiveBetOutcomes,
  shouldRecordBetOutcomes,
  shouldSyncOutcomes,
  shouldWarnOnIncompleteRuns,
  shouldWriteDojoDiary,
  shouldWriteDojoSession,
} from './cooldown-session.helpers.js';

describe('cooldown-session helpers', () => {
  describe('shouldWarnOnIncompleteRuns', () => {
    it('warns only when there are incomplete runs and force is false', () => {
      expect(shouldWarnOnIncompleteRuns(0, false)).toBe(false);
      expect(shouldWarnOnIncompleteRuns(1, true)).toBe(false);
      expect(shouldWarnOnIncompleteRuns(2, false)).toBe(true);
    });
  });

  describe('shouldRecordBetOutcomes', () => {
    it('returns true only for non-empty explicit outcomes', () => {
      expect(shouldRecordBetOutcomes([])).toBe(false);
      expect(shouldRecordBetOutcomes([{ betId: 'bet-1', outcome: 'complete' }])).toBe(true);
    });
  });

  describe('selectEffectiveBetOutcomes', () => {
    it('prefers explicit outcomes over auto-synced outcomes', () => {
      expect(selectEffectiveBetOutcomes(
        [{ betId: 'bet-1', outcome: 'abandoned' }],
        [{ betId: 'bet-1', outcome: 'complete' }],
      )).toEqual([{ betId: 'bet-1', outcome: 'abandoned' }]);
    });

    it('falls back to synced outcomes when no explicit outcomes were provided', () => {
      expect(selectEffectiveBetOutcomes(
        [],
        [{ betId: 'bet-1', outcome: 'partial', notes: 'auto-synced' }],
      )).toEqual([{ betId: 'bet-1', outcome: 'partial', notes: 'auto-synced' }]);
    });
  });

  describe('buildDiaryBetOutcomesFromCycleBets', () => {
    it('filters pending bets and maps descriptions into diary outcomes', () => {
      expect(buildDiaryBetOutcomesFromCycleBets([
        { id: 'bet-1', outcome: 'pending', description: 'Pending bet' },
        { id: 'bet-2', outcome: 'complete', outcomeNotes: 'done', description: 'Done bet' },
        { id: 'bet-3', outcome: 'partial', description: 'Partial bet' },
      ])).toEqual([
        { betId: 'bet-2', outcome: 'complete', notes: 'done', betDescription: 'Done bet' },
        { betId: 'bet-3', outcome: 'partial', notes: undefined, betDescription: 'Partial bet' },
      ]);
    });
  });

  describe('dojo helpers', () => {
    it('requires dojoDir to write diary and session outputs', () => {
      expect(shouldWriteDojoDiary(undefined)).toBe(false);
      expect(shouldWriteDojoDiary('/tmp/dojo')).toBe(true);
      expect(shouldWriteDojoSession(undefined, { build: vi.fn() })).toBe(false);
      expect(shouldWriteDojoSession('/tmp/dojo', undefined)).toBe(false);
      expect(shouldWriteDojoSession('/tmp/dojo', { build: vi.fn() })).toBe(true);
    });
  });

  describe('clampConfidenceWithDelta', () => {
    it('clamps confidence updates to the valid 0..1 range', () => {
      expect(clampConfidenceWithDelta(0.9, 0.2)).toBe(1);
      expect(clampConfidenceWithDelta(0.1, -0.3)).toBe(0);
      expect(clampConfidenceWithDelta(0.4, 0.2)).toBeCloseTo(0.6);
    });
  });

  describe('buildCooldownBudgetUsage', () => {
    it('reports zero utilization when token budget is missing or zero', () => {
      expect(buildCooldownBudgetUsage(undefined, 500, 'info')).toEqual({
        utilizationPercent: 0,
        alertLevel: 'info',
      });
      expect(buildCooldownBudgetUsage(0, 500, undefined)).toEqual({
        utilizationPercent: 0,
        alertLevel: undefined,
      });
    });

    it('derives alert levels from utilization thresholds', () => {
      expect(buildCooldownBudgetUsage(100, 110, undefined).utilizationPercent).toBeCloseTo(110);
      expect(buildCooldownBudgetUsage(100, 110, undefined).alertLevel).toBe('critical');
      expect(buildCooldownBudgetUsage(100, 90, undefined).utilizationPercent).toBeCloseTo(90);
      expect(buildCooldownBudgetUsage(100, 90, undefined).alertLevel).toBe('warning');
      expect(buildCooldownBudgetUsage(100, 75, undefined).utilizationPercent).toBeCloseTo(75);
      expect(buildCooldownBudgetUsage(100, 75, undefined).alertLevel).toBe('info');
      expect(buildCooldownBudgetUsage(100, 50, 'warning')).toEqual({
        utilizationPercent: 50,
        alertLevel: undefined,
      });
    });
  });

  describe('bridge-run status mapping', () => {
    it('maps terminal bridge statuses to cooldown outcomes only when they are actionable', () => {
      expect(mapBridgeRunStatusToSyncedOutcome('complete')).toBe('complete');
      expect(mapBridgeRunStatusToSyncedOutcome('failed')).toBe('partial');
      expect(mapBridgeRunStatusToSyncedOutcome('in-progress')).toBeUndefined();
      expect(mapBridgeRunStatusToSyncedOutcome(undefined)).toBeUndefined();
    });

    it('maps only in-progress bridge statuses to incomplete-run warnings', () => {
      expect(mapBridgeRunStatusToIncompleteStatus('in-progress')).toBe('running');
      expect(mapBridgeRunStatusToIncompleteStatus('complete')).toBeUndefined();
      expect(mapBridgeRunStatusToIncompleteStatus('failed')).toBeUndefined();
    });
  });

  describe('filterExecutionHistoryForCycle', () => {
    it('keeps only entries for the requested cycle', () => {
      expect(filterExecutionHistoryForCycle([
        { id: 'one', cycleId: 'cycle-a' },
        { id: 'two', cycleId: 'cycle-b' },
        { id: 'three', cycleId: 'cycle-a' },
      ] as Parameters<typeof filterExecutionHistoryForCycle>[0], 'cycle-a').map((entry) => entry.id)).toEqual(['one', 'three']);
    });
  });

  describe('buildCooldownLearningDrafts', () => {
    it('builds an exact low-completion learning draft with the cycle name when completion is below 50%', () => {
      expect(buildCooldownLearningDrafts({
        cycleId: 'cycle-123',
        cycleName: 'Hard Cycle',
        completionRate: 25,
        betCount: 4,
        tokenBudget: 1000,
        utilizationPercent: 25,
        tokensUsed: 250,
      })).toContainEqual({
        category: 'cycle-management',
        content: 'Cycle "Hard Cycle" had low completion rate (25.0%). Consider reducing scope or breaking bets into smaller chunks.',
        confidence: 0.6,
        observation: '4 bets, 25.0% completion',
      });
    });

    it('omits boundary drafts at exactly 50% completion and 30% utilization', () => {
      expect(buildCooldownLearningDrafts({
        cycleId: 'cycle-123',
        cycleName: 'Boundary Cycle',
        completionRate: 50,
        betCount: 2,
        tokenBudget: 1000,
        utilizationPercent: 30,
        tokensUsed: 300,
      })).toEqual([]);
    });

    it('builds over-budget and under-utilization drafts with exact budget wording', () => {
      expect(buildCooldownLearningDrafts({
        cycleId: 'cycle-123',
        completionRate: 100,
        betCount: 1,
        tokenBudget: 1000,
        utilizationPercent: 150,
        tokensUsed: 1500,
      })).toContainEqual({
        category: 'budget-management',
        content: 'Cycle "cycle-123" exceeded token budget (150.0% utilization). Consider more conservative estimates.',
        confidence: 0.7,
        observation: '1500 tokens used of 1000 budget',
      });

      expect(buildCooldownLearningDrafts({
        cycleId: 'cycle-999',
        cycleName: 'Under Cycle',
        completionRate: 100,
        betCount: 3,
        tokenBudget: 1000,
        utilizationPercent: 20,
        tokensUsed: 200,
      })).toContainEqual({
        category: 'budget-management',
        content: 'Cycle "Under Cycle" significantly under-utilized token budget (20.0%). Could have taken on more work.',
        confidence: 0.5,
        observation: '200 tokens used of 1000 budget',
      });
    });
  });

  describe('buildExpiryCheckMessages', () => {
    it('returns only the non-zero expiry summary lines', () => {
      expect(buildExpiryCheckMessages({
        archived: { length: 2 },
        flaggedStale: { length: 1 },
      })).toEqual([
        'Expiry check: auto-archived 2 expired operational learnings',
        'Expiry check: flagged 1 stale strategic learnings for review',
      ]);

      expect(buildExpiryCheckMessages({
        archived: { length: 0 },
        flaggedStale: { length: 0 },
      })).toEqual([]);
    });
  });

  describe('buildBeltAdvancementMessage', () => {
    it('formats the advancement message only when the belt leveled up', () => {
      expect(buildBeltAdvancementMessage({
        previous: 'go-kyu',
        belt: 'yon-kyu',
        leveledUp: true,
      })).toBe('Belt advanced: go-kyu → yon-kyu');

      expect(buildBeltAdvancementMessage({
        previous: 'go-kyu',
        belt: 'go-kyu',
        leveledUp: false,
      })).toBeUndefined();
    });
  });

  describe('buildDojoSessionBuildRequest', () => {
    it('uses the provided runsDir and cycle name when available', () => {
      expect(buildDojoSessionBuildRequest({
        dojoDir: '/tmp/dojo',
        cycleId: 'cycle-12345678',
        cycleName: 'Session Cycle',
        runsDir: '/tmp/runs',
      })).toEqual({
        diaryDir: join('/tmp/dojo', 'diary'),
        runsDir: '/tmp/runs',
        title: 'Cooldown — Session Cycle',
      });
    });

    it('falls back to the dojo-adjacent runsDir and truncated cycle id title', () => {
      expect(buildDojoSessionBuildRequest({
        dojoDir: '/tmp/dojo',
        cycleId: 'abcdef1234567890',
      })).toEqual({
        diaryDir: join('/tmp/dojo', 'diary'),
        runsDir: join('/tmp/dojo', '..', 'runs'),
        title: 'Cooldown — abcdef12',
      });
    });
  });

  describe('buildSynthesisInputRecord', () => {
    it('preserves the provided synthesis payload exactly', () => {
      expect(buildSynthesisInputRecord({
        id: 'synth-1',
        cycleId: 'cycle-1',
        createdAt: '2026-03-16T12:00:00.000Z',
        depth: 'standard',
        observations: [],
        learnings: [],
        cycleName: 'Synthesis Cycle',
        tokenBudget: 4000,
        tokensUsed: 1200,
      })).toEqual({
        id: 'synth-1',
        cycleId: 'cycle-1',
        createdAt: '2026-03-16T12:00:00.000Z',
        depth: 'standard',
        observations: [],
        learnings: [],
        cycleName: 'Synthesis Cycle',
        tokenBudget: 4000,
        tokensUsed: 1200,
      });
    });
  });

  describe('buildAgentPerspectiveFromProposals', () => {
    it('returns undefined when there are no accepted proposals', () => {
      expect(buildAgentPerspectiveFromProposals([])).toBeUndefined();
    });

    it('formats positive and negative confidence deltas distinctly', () => {
      const perspective = buildAgentPerspectiveFromProposals([
        {
          id: 'positive',
          type: 'update-learning',
          confidenceDelta: 0.15,
          proposedContent: 'Increase confidence',
        },
        {
          id: 'negative',
          type: 'update-learning',
          confidenceDelta: -0.2,
          proposedContent: 'Decrease confidence',
        },
      ] as Parameters<typeof buildAgentPerspectiveFromProposals>[0]);

      expect(perspective).toContain('+0.15');
      expect(perspective).toContain('-0.20');
    });

    it('formats each synthesis proposal variant with its expected wording', () => {
      const perspective = buildAgentPerspectiveFromProposals([
        {
          id: 'new-learning',
          type: 'new-learning',
          proposedTier: 'operational',
          proposedCategory: 'cadence',
          confidence: 0.82,
          proposedContent: 'Keep cooldown reports short and explicit.',
          basedOnObservations: [],
          rationale: 'Short reports travel better.',
        },
        {
          id: 'promote',
          type: 'promote',
          learningId: 'learning-1',
          toTier: 'strategic',
          rationale: 'Shows up every cycle.',
        },
        {
          id: 'archive',
          type: 'archive',
          learningId: 'learning-2',
          reason: 'Superseded by new process',
        },
        {
          id: 'method',
          type: 'methodology-recommendation',
          area: 'testing',
          recommendation: 'Keep extracting pure helpers before adding orchestration tests.',
          rationale: 'Preserves logical boundaries.',
        },
      ] as Parameters<typeof buildAgentPerspectiveFromProposals>[0]);

      expect(perspective).toContain('## Agent Perspective (Synthesis)');
      expect(perspective).toContain('**New learning** [operational/cadence] (confidence: 0.82):');
      expect(perspective).toContain('Keep cooldown reports short and explicit.');
      expect(perspective).toContain('**Promoted learning** to strategic tier.');
      expect(perspective).toContain('**Archived learning**: Superseded by new process');
      expect(perspective).toContain('**Methodology recommendation** (testing):');
      expect(perspective).toContain('Keep extracting pure helpers before adding orchestration tests.');
    });
  });

  describe('resolveAppliedProposalIds', () => {
    it('uses explicit accepted ids when provided and otherwise falls back to every proposal id', () => {
      expect(resolveAppliedProposalIds(
        [{ id: 'p-1' }, { id: 'p-2' }],
        ['p-2'],
      )).toEqual(new Set(['p-2']));

      expect(resolveAppliedProposalIds(
        [{ id: 'p-1' }, { id: 'p-2' }],
      )).toEqual(new Set(['p-1', 'p-2']));
    });
  });

  describe('listCompletedBetDescriptions', () => {
    it('includes only complete and partial bets', () => {
      expect(listCompletedBetDescriptions([
        { outcome: 'complete', description: 'Complete bet' },
        { outcome: 'partial', description: 'Partial bet' },
        { outcome: 'abandoned', description: 'Abandoned bet' },
      ])).toEqual(['Complete bet', 'Partial bet']);
    });
  });

  describe('isJsonFile', () => {
    it('returns true for .json files', () => {
      expect(isJsonFile('run.json')).toBe(true);
      expect(isJsonFile('pending-abc.json')).toBe(true);
    });

    it('returns false for non-.json files', () => {
      expect(isJsonFile('readme.md')).toBe(false);
      expect(isJsonFile('json')).toBe(false);
      expect(isJsonFile('')).toBe(false);
    });
  });

  describe('isSynthesisPendingFile', () => {
    it('returns true for pending-*.json files', () => {
      expect(isSynthesisPendingFile('pending-abc.json')).toBe(true);
      expect(isSynthesisPendingFile('pending-123-456.json')).toBe(true);
    });

    it('returns false when prefix or suffix is wrong', () => {
      expect(isSynthesisPendingFile('result-abc.json')).toBe(false);
      expect(isSynthesisPendingFile('pending-abc.txt')).toBe(false);
      expect(isSynthesisPendingFile('pending-.md')).toBe(false);
      expect(isSynthesisPendingFile('')).toBe(false);
    });
  });

  describe('hasFailedCaptures', () => {
    it('returns true when failed count is positive', () => {
      expect(hasFailedCaptures(1)).toBe(true);
      expect(hasFailedCaptures(5)).toBe(true);
    });

    it('returns false when failed count is zero', () => {
      expect(hasFailedCaptures(0)).toBe(false);
    });
  });

  describe('isSyncableBet', () => {
    it('returns true only when outcome is pending AND runId is present', () => {
      expect(isSyncableBet({ outcome: 'pending', runId: 'run-1' })).toBe(true);
    });

    it('returns false when outcome is not pending', () => {
      expect(isSyncableBet({ outcome: 'complete', runId: 'run-1' })).toBe(false);
      expect(isSyncableBet({ outcome: 'partial', runId: 'run-1' })).toBe(false);
      expect(isSyncableBet({ outcome: 'abandoned', runId: 'run-1' })).toBe(false);
    });

    it('returns false when runId is missing or undefined', () => {
      expect(isSyncableBet({ outcome: 'pending' })).toBe(false);
      expect(isSyncableBet({ outcome: 'pending', runId: undefined })).toBe(false);
    });

    it('returns false when runId is empty string', () => {
      expect(isSyncableBet({ outcome: 'pending', runId: '' })).toBe(false);
    });
  });

  describe('collectBridgeRunIds', () => {
    it('collects betId→runId pairs for matching cycleId', () => {
      const result = collectBridgeRunIds([
        { cycleId: 'c1', betId: 'b1', runId: 'r1' },
        { cycleId: 'c2', betId: 'b2', runId: 'r2' },
        { cycleId: 'c1', betId: 'b3', runId: 'r3' },
      ], 'c1');

      expect(result.size).toBe(2);
      expect(result.get('b1')).toBe('r1');
      expect(result.get('b3')).toBe('r3');
    });

    it('skips records with missing betId or runId', () => {
      const result = collectBridgeRunIds([
        { cycleId: 'c1', betId: 'b1' },
        { cycleId: 'c1', runId: 'r2' },
        { cycleId: 'c1' },
      ], 'c1');

      expect(result.size).toBe(0);
    });

    it('returns empty map when no records match', () => {
      const result = collectBridgeRunIds([
        { cycleId: 'c2', betId: 'b1', runId: 'r1' },
      ], 'c1');

      expect(result.size).toBe(0);
    });

    it('returns empty map for empty input', () => {
      expect(collectBridgeRunIds([], 'c1').size).toBe(0);
    });
  });

  describe('hasObservations', () => {
    it('returns true for non-empty arrays', () => {
      expect(hasObservations([{ id: '1' }])).toBe(true);
      expect(hasObservations([1, 2, 3])).toBe(true);
    });

    it('returns false for empty arrays', () => {
      expect(hasObservations([])).toBe(false);
    });
  });

  describe('shouldSyncOutcomes', () => {
    it('returns true when there are outcomes to sync', () => {
      expect(shouldSyncOutcomes([{ betId: 'b1', outcome: 'complete' }])).toBe(true);
    });

    it('returns false when there are no outcomes to sync', () => {
      expect(shouldSyncOutcomes([])).toBe(false);
    });
  });

  describe('hasMethod', () => {
    it('returns true when the target has the named method', () => {
      expect(hasMethod({ checkExpiry: () => {} }, 'checkExpiry')).toBe(true);
    });

    it('returns false when the target does not have the named method', () => {
      expect(hasMethod({}, 'checkExpiry')).toBe(false);
      expect(hasMethod({ checkExpiry: 42 }, 'checkExpiry')).toBe(false);
    });

    it('returns false for null and undefined targets', () => {
      expect(hasMethod(null, 'checkExpiry')).toBe(false);
      expect(hasMethod(undefined, 'checkExpiry')).toBe(false);
    });
  });
});
