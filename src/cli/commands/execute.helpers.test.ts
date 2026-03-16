import {
  assertValidKataName,
  buildPreparedCycleOutputLines,
  buildPreparedRunOutputLines,
  formatDurationMs,
  formatAgentLoadError,
  formatExplain,
  mergePinnedFlavors,
  parseBetOption,
  parseCompletedRunArtifacts,
  parseCompletedRunTokenUsage,
  parseHintFlags,
} from '@cli/commands/execute.helpers.js';

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

    it('rejects an explicitly empty JSON payload', () => {
      expect(parseBetOption('')).toEqual({
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
      expect(parseHintFlags(['build:typescript-tdd:'])).toEqual({
        ok: false,
        error: 'Error: invalid strategy "" in --hint. Valid: prefer, restrict',
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

  describe('parseCompletedRunArtifacts', () => {
    it('returns undefined when artifacts are omitted', () => {
      expect(parseCompletedRunArtifacts(undefined)).toEqual({ ok: true, value: undefined });
    });

    it('parses a valid artifact array', () => {
      expect(parseCompletedRunArtifacts('[{"name":"report.md","path":"reports/report.md"}]')).toEqual({
        ok: true,
        value: [{ name: 'report.md', path: 'reports/report.md' }],
      });
    });

    it('rejects non-array JSON payloads', () => {
      expect(parseCompletedRunArtifacts('{"name":"report.md"}')).toEqual({
        ok: false,
        error: 'Error: --artifacts must be a JSON array',
      });
    });

    it('rejects array items without a string name', () => {
      expect(parseCompletedRunArtifacts('[null]')).toEqual({
        ok: false,
        error: 'Error: each artifact must have a "name" string property',
      });
    });

    it('rejects invalid JSON', () => {
      expect(parseCompletedRunArtifacts('{broken}')).toEqual({
        ok: false,
        error: 'Error: --artifacts must be valid JSON',
      });
    });
  });

  describe('parseCompletedRunTokenUsage', () => {
    it('returns no token usage when both values are omitted', () => {
      expect(parseCompletedRunTokenUsage(undefined, undefined)).toEqual({
        ok: true,
        value: {
          hasTokens: false,
          tokenUsage: undefined,
          totalTokens: undefined,
        },
      });
    });

    it('sums partial token usage and defaults the missing side to zero', () => {
      expect(parseCompletedRunTokenUsage(7, undefined)).toEqual({
        ok: true,
        value: {
          hasTokens: true,
          tokenUsage: { inputTokens: 7, outputTokens: undefined, total: 7 },
          totalTokens: 7,
        },
      });
      expect(parseCompletedRunTokenUsage(undefined, 3)).toEqual({
        ok: true,
        value: {
          hasTokens: true,
          tokenUsage: { inputTokens: undefined, outputTokens: 3, total: 3 },
          totalTokens: 3,
        },
      });
    });

    it('preserves explicit zero counts', () => {
      expect(parseCompletedRunTokenUsage(0, 0)).toEqual({
        ok: true,
        value: {
          hasTokens: true,
          tokenUsage: { inputTokens: 0, outputTokens: 0, total: 0 },
          totalTokens: 0,
        },
      });
    });

    it('rejects negative or invalid values', () => {
      expect(parseCompletedRunTokenUsage(-1, undefined)).toEqual({
        ok: false,
        error: 'Error: --input-tokens must be a non-negative integer',
      });
      expect(parseCompletedRunTokenUsage(undefined, Number.NaN)).toEqual({
        ok: false,
        error: 'Error: --output-tokens must be a non-negative integer',
      });
    });
  });

  describe('assertValidKataName', () => {
    it('accepts letters, digits, hyphens, and underscores', () => {
      expect(() => assertValidKataName('my_kata-1')).not.toThrow();
    });

    it('rejects names with traversal or path separators', () => {
      expect(() => assertValidKataName('../evil')).toThrow('Invalid kata name "../evil"');
      expect(() => assertValidKataName('safe/')).toThrow('Invalid kata name "safe/"');
    });
  });

  describe('formatAgentLoadError', () => {
    it('maps missing agents to the not-found guidance', () => {
      expect(formatAgentLoadError(
        '1234',
        'Agent "1234" not found.',
      )).toBe('Error: agent "1234" not found. Use "kata agent list" to see registered agents.');
    });

    it('preserves wrapped registry load failures without duplicating the prefix', () => {
      expect(formatAgentLoadError(
        '1234',
        'Failed to load agent "1234": Invalid input: expected string, received undefined',
      )).toBe('Error: Failed to load agent "1234": Invalid input: expected string, received undefined');
    });

    it('wraps raw load failures with agent context', () => {
      expect(formatAgentLoadError(
        '1234',
        'Invalid agent ID: "1234"',
      )).toBe('Error: Failed to load agent "1234": Invalid agent ID: "1234"');
    });
  });

  describe('mergePinnedFlavors', () => {
    it('returns undefined when neither flag provided any values', () => {
      expect(mergePinnedFlavors(undefined, undefined)).toBeUndefined();
      expect(mergePinnedFlavors([], [])).toBeUndefined();
    });

    it('merges primary and fallback pins in order', () => {
      expect(mergePinnedFlavors(['typescript-tdd'], ['legacy-build'])).toEqual([
        'typescript-tdd',
        'legacy-build',
      ]);
    });
  });

  describe('buildPreparedCycleOutputLines', () => {
    it('renders a readable summary for each prepared cycle run', () => {
      expect(buildPreparedCycleOutputLines({
        cycleName: 'Dispatch Cycle',
        preparedRuns: [
          {
            betName: 'Bet A',
            runId: 'run-1',
            stages: ['build', 'review'],
            isolation: 'worktree',
          },
        ],
      })).toEqual([
        'Prepared 1 run(s) for cycle "Dispatch Cycle"',
        '  Bet A',
        '    Run ID: run-1',
        '    Stages: build, review',
        '    Isolation: worktree',
      ]);
    });
  });

  describe('buildPreparedRunOutputLines', () => {
    it('renders the plain-text prepare output with the agent context block', () => {
      expect(buildPreparedRunOutputLines({
        betName: 'Prepared bet',
        runId: 'run-1',
        cycleName: 'Cycle A',
        stages: ['build'],
        isolation: 'worktree',
      }, '**Run ID**: run-1')).toEqual([
        'Prepared run for bet: "Prepared bet"',
        '  Run ID: run-1',
        '  Cycle: Cycle A',
        '  Stages: build',
        '  Isolation: worktree',
        '',
        'Agent context block (use "kata kiai context <run-id>" to fetch at dispatch time):',
        '**Run ID**: run-1',
      ]);
    });
  });
});
