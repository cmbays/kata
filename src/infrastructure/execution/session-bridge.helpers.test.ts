import {
  computeBudgetPercent,
  countJsonlContent,
  extractHistoryTokenTotal,
  findEarliestTimestamp,
  hasBridgeRunMetadataChanged,
  isJsonFile,
  resolveAgentId,
} from '@infra/execution/session-bridge.helpers.js';

// canTransitionCycleState tests moved to domain/rules/cycle-rules.test.ts
// matchesCycleRef removed — functionality now in CycleManager.get()

describe('session-bridge helpers', () => {
  describe('hasBridgeRunMetadataChanged', () => {
    it('returns false when both fields match', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'A', cycleName: 'C1' },
      )).toBe(false);
    });

    it('returns true when betName differs', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'B', cycleName: 'C1' },
      )).toBe(true);
    });

    it('returns true when cycleName differs', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'A', cycleName: 'C2' },
      )).toBe(true);
    });

    it('returns true when both differ', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'B', cycleName: 'C2' },
      )).toBe(true);
    });
  });

  describe('isJsonFile (re-exported from shared)', () => {
    it('is re-exported and callable', () => {
      expect(isJsonFile('data.json')).toBe(true);
      expect(isJsonFile('readme.md')).toBe(false);
    });
  });

  describe('findEarliestTimestamp', () => {
    it('returns the earliest ISO timestamp from the list', () => {
      expect(findEarliestTimestamp([
        '2026-03-16T12:00:00.000Z',
        '2026-03-15T08:00:00.000Z',
        '2026-03-16T06:00:00.000Z',
      ])).toBe('2026-03-15T08:00:00.000Z');
    });

    it('returns undefined for empty input', () => {
      expect(findEarliestTimestamp([])).toBeUndefined();
    });

    it('returns the only element for single-item arrays', () => {
      expect(findEarliestTimestamp(['2026-03-16T12:00:00.000Z'])).toBe('2026-03-16T12:00:00.000Z');
    });
  });

  describe('resolveAgentId', () => {
    it('returns agentId when present', () => {
      expect(resolveAgentId('agent-1', 'kataka-1')).toBe('agent-1');
    });

    it('falls back to katakaId when agentId is undefined', () => {
      expect(resolveAgentId(undefined, 'kataka-1')).toBe('kataka-1');
    });

    it('returns undefined when both are undefined', () => {
      expect(resolveAgentId(undefined, undefined)).toBeUndefined();
    });
  });

  describe('computeBudgetPercent', () => {
    it('returns null when tokenBudget is 0 or undefined', () => {
      expect(computeBudgetPercent(500, undefined)).toBeNull();
      expect(computeBudgetPercent(500, 0)).toBeNull();
    });

    it('computes percent and returns token estimate', () => {
      expect(computeBudgetPercent(500, 1000)).toEqual({ percent: 50, tokenEstimate: 500 });
      expect(computeBudgetPercent(1500, 1000)).toEqual({ percent: 150, tokenEstimate: 1500 });
    });

    it('rounds percent to nearest integer', () => {
      expect(computeBudgetPercent(333, 1000)).toEqual({ percent: 33, tokenEstimate: 333 });
    });
  });

  describe('extractHistoryTokenTotal', () => {
    it('returns token total for matching cycle', () => {
      expect(extractHistoryTokenTotal(
        { cycleId: 'c1', tokenUsage: { total: 500 } },
        'c1',
      )).toBe(500);
    });

    it('returns null for non-matching cycle', () => {
      expect(extractHistoryTokenTotal(
        { cycleId: 'c2', tokenUsage: { total: 500 } },
        'c1',
      )).toBeNull();
    });

    it('returns null when tokenUsage is missing', () => {
      expect(extractHistoryTokenTotal({ cycleId: 'c1' }, 'c1')).toBeNull();
    });

    it('returns null when tokenUsage.total is undefined', () => {
      expect(extractHistoryTokenTotal(
        { cycleId: 'c1', tokenUsage: {} },
        'c1',
      )).toBeNull();
    });
  });

  describe('countJsonlContent', () => {
    it('counts lines in non-empty JSONL content', () => {
      expect(countJsonlContent('{"a":1}\n{"b":2}\n{"c":3}')).toBe(3);
      expect(countJsonlContent('{"a":1}')).toBe(1);
    });

    it('returns 0 for empty or whitespace-only content', () => {
      expect(countJsonlContent('')).toBe(0);
      expect(countJsonlContent('   ')).toBe(0);
      expect(countJsonlContent('\n')).toBe(0);
    });

    it('handles trailing newlines correctly', () => {
      expect(countJsonlContent('{"a":1}\n{"b":2}\n')).toBe(2);
    });
  });
});
