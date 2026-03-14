import { describe, expect, it } from 'vitest';
import {
  formatDurationMs,
  formatExplain,
  parseBetOption,
  parseHintFlags,
} from './execute.helpers.js';

describe('execute helpers', () => {
  describe('parseBetOption', () => {
    it('returns undefined when the flag is omitted', () => {
      expect(parseBetOption(undefined)).toEqual({ ok: true, value: undefined });
    });

    it('parses a valid JSON object', () => {
      expect(parseBetOption('{"title":"Add search","size":2}')).toEqual({
        ok: true,
        value: { title: 'Add search', size: 2 },
      });
    });

    it('rejects invalid JSON', () => {
      expect(parseBetOption('{broken}')).toEqual({
        ok: false,
        error: 'Error: --bet must be valid JSON',
      });
    });

    it('rejects non-object JSON payloads', () => {
      expect(parseBetOption('["a","b"]')).toEqual({
        ok: false,
        error: 'Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')',
      });
      expect(parseBetOption('null')).toEqual({
        ok: false,
        error: 'Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')',
      });
      expect(parseBetOption('"plain string"')).toEqual({
        ok: false,
        error: 'Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')',
      });
    });
  });

  describe('parseHintFlags', () => {
    it('returns undefined when no hints are provided', () => {
      expect(parseHintFlags(undefined)).toEqual({ ok: true, value: undefined });
      expect(parseHintFlags([])).toEqual({ ok: true, value: undefined });
    });

    it('parses valid hints and defaults strategy to prefer', () => {
      expect(parseHintFlags(['build:typescript-tdd, reviewer '])).toEqual({
        ok: true,
        value: {
          build: {
            recommended: ['typescript-tdd', 'reviewer'],
            strategy: 'prefer',
          },
        },
      });
    });

    it('parses an explicit restrict strategy', () => {
      expect(parseHintFlags(['review:reviewer,qa:restrict'])).toEqual({
        ok: true,
        value: {
          review: {
            recommended: ['reviewer', 'qa'],
            strategy: 'restrict',
          },
        },
      });
    });

    it('accepts an explicit prefer strategy', () => {
      expect(parseHintFlags(['build:typescript-tdd:prefer'])).toEqual({
        ok: true,
        value: {
          build: {
            recommended: ['typescript-tdd'],
            strategy: 'prefer',
          },
        },
      });
    });

    it('lets a later hint override an earlier entry for the same stage', () => {
      expect(parseHintFlags([
        'build:typescript-tdd',
        'build:quick-fix:restrict',
      ])).toEqual({
        ok: true,
        value: {
          build: {
            recommended: ['quick-fix'],
            strategy: 'restrict',
          },
        },
      });
    });

    it('rejects malformed hint segments', () => {
      expect(parseHintFlags(['build-only'])).toEqual({
        ok: false,
        error: 'Error: invalid --hint format "build-only". Expected: stage:flavor1,flavor2[:strategy]',
      });
      expect(parseHintFlags(['build:a:prefer:extra'])).toEqual({
        ok: false,
        error: 'Error: invalid --hint format "build:a:prefer:extra". Expected: stage:flavor1,flavor2[:strategy]',
      });
    });

    it('rejects invalid stage categories', () => {
      expect(parseHintFlags(['deploy:typescript-tdd'])).toEqual({
        ok: false,
        error: 'Error: invalid stage category "deploy" in --hint. Valid: research, plan, build, review',
      });
    });

    it('rejects hints with no flavor names after trimming', () => {
      expect(parseHintFlags(['build: , '])).toEqual({
        ok: false,
        error: 'Error: --hint "build: , " has no flavor names.',
      });
    });

    it('rejects invalid strategies', () => {
      expect(parseHintFlags(['build:typescript-tdd:avoid'])).toEqual({
        ok: false,
        error: 'Error: invalid strategy "avoid" in --hint. Valid: prefer, restrict',
      });
    });
  });

  describe('formatExplain', () => {
    it('renders the fallback message when scoring data is missing', () => {
      expect(formatExplain('build', ['typescript-tdd'])).toBe(
        'Flavor scoring for stage: build\n'
        + '  Selected: typescript-tdd (no scoring data — flavor was pinned or vocabulary unavailable)',
      );
    });

    it('sorts reports by score and marks selected flavors', () => {
      const output = formatExplain('build', ['typescript-tdd'], [
        {
          flavorName: 'quick-fix',
          score: 0.42,
          keywordHits: 1,
          ruleAdjustments: 0,
          learningBoost: 0,
          reasoning: 'fallback',
        },
        {
          flavorName: 'typescript-tdd',
          score: 0.87,
          keywordHits: 3,
          ruleAdjustments: 0,
          learningBoost: 0,
          reasoning: 'winner',
        },
      ]);

      expect(output.indexOf('typescript-tdd')).toBeLessThan(output.indexOf('quick-fix'));
      expect(output).toContain('<- selected');
      expect(output).toContain('Flavor scores:');
      expect(output).toContain('Scoring factors:');
      expect(output).toContain('keyword hits:      3');
      expect(output).toContain('reasoning:         winner');
      expect(output).not.toContain('learning boost');
      expect(output).not.toContain('rule adjustments');
    });

    it('includes learning and rule adjustments only when they are meaningful', () => {
      const output = formatExplain('build', ['typescript-tdd'], [
        {
          flavorName: 'typescript-tdd',
          score: 0.9,
          keywordHits: 2,
          ruleAdjustments: 0.15,
          learningBoost: 0.1,
          reasoning: 'boosted',
        },
      ]);

      expect(output).toContain('learning boost:    +0.10');
      expect(output).toContain('rule adjustments:  +0.15');
    });

    it('omits zero-score non-selected losers from the scoring-factor section when a winner has a positive score', () => {
      const output = formatExplain('build', ['typescript-tdd'], [
        {
          flavorName: 'typescript-tdd',
          score: 0.9,
          keywordHits: 3,
          ruleAdjustments: 0,
          learningBoost: 0,
          reasoning: 'winner',
        },
        {
          flavorName: 'zero-loser',
          score: 0,
          keywordHits: 0,
          ruleAdjustments: 0,
          learningBoost: 0,
          reasoning: 'filtered',
        },
      ]);

      expect(output).toContain('zero-loser');
      expect(output).toContain('score: 0.00');
      expect(output).not.toContain('zero-loser:');
    });
  });

  describe('formatDurationMs', () => {
    it('formats short durations in seconds', () => {
      expect(formatDurationMs(14_000)).toBe('14s');
    });

    it('formats minute durations with remainder seconds', () => {
      expect(formatDurationMs(125_000)).toBe('2m 5s');
    });

    it('formats hour durations with remainder minutes', () => {
      expect(formatDurationMs(7_440_000)).toBe('2h 4m');
    });
  });
});
