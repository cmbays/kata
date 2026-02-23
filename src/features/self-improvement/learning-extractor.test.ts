import { randomUUID } from 'node:crypto';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Learning } from '@domain/types/learning.js';
import type { Step } from '@domain/types/step.js';
import { LearningExtractor } from './learning-extractor.js';
import type { Pattern } from './learning-extractor.js';

function makeHistoryEntry(overrides: Partial<ExecutionHistoryEntry> = {}): ExecutionHistoryEntry {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    pipelineId: randomUUID(),
    stageType: 'build',
    stageIndex: 0,
    adapter: 'manual',
    artifactNames: [],
    learningIds: [],
    startedAt: now,
    completedAt: now,
    ...overrides,
  };
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tier: 'stage',
    category: 'testing',
    content: 'Test everything',
    evidence: [],
    confidence: 0.8,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeStage(overrides: Partial<Step> = {}): Step {
  return {
    type: 'build',
    artifacts: [],
    learningHooks: [],
    config: {},
    ...overrides,
  };
}

describe('LearningExtractor', () => {
  let extractor: LearningExtractor;

  beforeEach(() => {
    extractor = new LearningExtractor();
  });

  describe('analyze', () => {
    it('returns empty array for empty history', () => {
      expect(extractor.analyze([])).toEqual([]);
    });

    it('returns empty array when data is insufficient (below threshold)', () => {
      const history = [
        makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
        makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      ];
      const patterns = extractor.analyze(history);
      // 2 failures < threshold of 3
      const gatePatterns = patterns.filter((p) => p.id.startsWith('gate-'));
      expect(gatePatterns).toHaveLength(0);
    });

    describe('gate failure patterns', () => {
      it('detects entry gate failure pattern with 3+ observations', () => {
        const history = [
          makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'research', entryGatePassed: true }),
        ];
        const patterns = extractor.analyze(history);
        const entryFail = patterns.find((p) => p.id === 'gate-entry-fail-research');
        expect(entryFail).toBeDefined();
        expect(entryFail!.frequency).toBe(3);
        expect(entryFail!.consistency).toBe(3 / 4);
        expect(entryFail!.evidence).toHaveLength(3);
      });

      it('detects exit gate failure pattern with 3+ observations', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build', exitGatePassed: false }),
          makeHistoryEntry({ stageType: 'build', exitGatePassed: false }),
          makeHistoryEntry({ stageType: 'build', exitGatePassed: false }),
        ];
        const patterns = extractor.analyze(history);
        const exitFail = patterns.find((p) => p.id === 'gate-exit-fail-build');
        expect(exitFail).toBeDefined();
        expect(exitFail!.frequency).toBe(3);
        expect(exitFail!.consistency).toBe(1.0);
      });

      it('does not flag gate pattern when failures are below threshold', () => {
        const history = [
          makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'research', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'research', entryGatePassed: true }),
        ];
        const patterns = extractor.analyze(history);
        const entryFail = patterns.find((p) => p.id === 'gate-entry-fail-research');
        expect(entryFail).toBeUndefined();
      });
    });

    describe('high token usage patterns', () => {
      it('detects high token usage for a stage type', () => {
        const history = [
          // "build" stages with very high tokens
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 18000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 20000 } }),
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 20000, outputTokens: 5000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 25000 } }),
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 19000, outputTokens: 3000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 22000 } }),
          // Many "research" and "review" stages with low tokens to keep overall avg down
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 600, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 400, outputTokens: 600, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
        ];
        const patterns = extractor.analyze(history);
        const highTokens = patterns.find((p) => p.id === 'high-tokens-build');
        expect(highTokens).toBeDefined();
        expect(highTokens!.frequency).toBe(3);
        expect(highTokens!.description).toContain('high token counts');
      });

      it('does not flag stages with normal token usage', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 600, outputTokens: 400, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
          makeHistoryEntry({ stageType: 'research', tokenUsage: { inputTokens: 500, outputTokens: 500, cacheCreationTokens: 0, cacheReadTokens: 0, total: 1000 } }),
        ];
        const patterns = extractor.analyze(history);
        const highTokens = patterns.find((p) => p.id.startsWith('high-tokens'));
        expect(highTokens).toBeUndefined();
      });

      it('ignores entries without token usage', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build' }),
          makeHistoryEntry({ stageType: 'build' }),
          makeHistoryEntry({ stageType: 'build' }),
        ];
        const patterns = extractor.analyze(history);
        const highTokens = patterns.find((p) => p.id.startsWith('high-tokens'));
        expect(highTokens).toBeUndefined();
      });
    });

    describe('artifact patterns', () => {
      it('detects consistent artifact combinations', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build', artifactNames: ['bundle.js', 'types.d.ts'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['bundle.js', 'types.d.ts'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['bundle.js', 'types.d.ts'] }),
        ];
        const patterns = extractor.analyze(history);
        const artifactPattern = patterns.find((p) => p.id.startsWith('artifacts-build'));
        expect(artifactPattern).toBeDefined();
        expect(artifactPattern!.consistency).toBe(1.0);
        expect(artifactPattern!.description).toContain('bundle.js');
        expect(artifactPattern!.description).toContain('types.d.ts');
      });

      it('ignores entries with no artifacts', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build', artifactNames: [] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: [] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: [] }),
        ];
        const patterns = extractor.analyze(history);
        const artifactPattern = patterns.find((p) => p.id.startsWith('artifacts-'));
        expect(artifactPattern).toBeUndefined();
      });

      it('does not flag artifact patterns with low consistency', () => {
        const history = [
          makeHistoryEntry({ stageType: 'build', artifactNames: ['bundle.js'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['output.zip'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['result.json'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['bundle.js'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['output.zip'] }),
          makeHistoryEntry({ stageType: 'build', artifactNames: ['result.json'] }),
        ];
        const patterns = extractor.analyze(history);
        const artifactPattern = patterns.find((p) => p.id.startsWith('artifacts-'));
        // Each artifact set has only 2 occurrences < threshold of 3
        expect(artifactPattern).toBeUndefined();
      });
    });

    describe('skip patterns', () => {
      it('detects frequently skipped stages', () => {
        const history = [
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: false }),
        ];
        const patterns = extractor.analyze(history);
        const skipPattern = patterns.find((p) => p.id === 'skip-interview');
        expect(skipPattern).toBeDefined();
        expect(skipPattern!.frequency).toBe(4);
        expect(skipPattern!.consistency).toBe(1.0);
      });

      it('does not flag skip pattern when less than 50% are skipped', () => {
        const history = [
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: false }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
          makeHistoryEntry({ stageType: 'interview', entryGatePassed: true }),
        ];
        const patterns = extractor.analyze(history);
        const skipPattern = patterns.find((p) => p.id === 'skip-interview');
        expect(skipPattern).toBeUndefined();
      });
    });

    it('detects multiple pattern types simultaneously', () => {
      const history = [
        // Gate failures for research
        makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
        makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
        makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
        // Very high tokens for build
        makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 18000, outputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 20000 } }),
        makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 20000, outputTokens: 5000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 25000 } }),
        makeHistoryEntry({ stageType: 'build', tokenUsage: { inputTokens: 19000, outputTokens: 3000, cacheCreationTokens: 0, cacheReadTokens: 0, total: 22000 } }),
        // Many low-token entries (for average baseline)
        makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
        makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
        makeHistoryEntry({ stageType: 'review', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
        makeHistoryEntry({ stageType: 'shape', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
        makeHistoryEntry({ stageType: 'shape', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
        makeHistoryEntry({ stageType: 'shape', tokenUsage: { inputTokens: 200, outputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 0, total: 300 } }),
      ];
      const patterns = extractor.analyze(history);
      const types = patterns.map((p) => p.id);
      expect(types).toContain('gate-entry-fail-research');
      expect(types).toContain('high-tokens-build');
    });
  });

  describe('suggestLearnings', () => {
    it('returns empty array for no patterns', () => {
      expect(extractor.suggestLearnings([])).toEqual([]);
    });

    it('converts a gate failure pattern into a stage-tier learning', () => {
      const pattern: Pattern = {
        id: 'gate-entry-fail-research',
        stageType: 'research',
        description: 'Research frequently fails entry gate.',
        evidence: [
          { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Entry gate failed' },
          { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Entry gate failed' },
          { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Entry gate failed' },
        ],
        frequency: 3,
        consistency: 0.75,
      };

      const suggestions = extractor.suggestLearnings([pattern]);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].tier).toBe('stage');
      expect(suggestions[0].category).toBe('gate-management');
      expect(suggestions[0].stageType).toBe('research');
      expect(suggestions[0].evidenceCount).toBe(3);
      expect(suggestions[0].confidence).toBeGreaterThan(0);
      expect(suggestions[0].confidence).toBeLessThanOrEqual(1);
    });

    it('converts a token usage pattern into a stage-tier learning', () => {
      const pattern: Pattern = {
        id: 'high-tokens-build',
        stageType: 'build',
        description: 'Build uses high token counts.',
        evidence: [
          { historyEntryId: 'h1', pipelineId: 'p1', observation: 'High tokens' },
          { historyEntryId: 'h2', pipelineId: 'p2', observation: 'High tokens' },
          { historyEntryId: 'h3', pipelineId: 'p3', observation: 'High tokens' },
        ],
        frequency: 3,
        consistency: 0.9,
      };

      const suggestions = extractor.suggestLearnings([pattern]);
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].tier).toBe('stage');
      expect(suggestions[0].category).toBe('token-efficiency');
    });

    it('converts a skip pattern into a category-tier learning', () => {
      const pattern: Pattern = {
        id: 'skip-interview',
        stageType: 'interview',
        description: 'Interview is frequently skipped.',
        evidence: [
          { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Skipped' },
          { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Skipped' },
          { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Skipped' },
        ],
        frequency: 3,
        consistency: 0.8,
      };

      const suggestions = extractor.suggestLearnings([pattern]);
      expect(suggestions[0].tier).toBe('category');
      expect(suggestions[0].category).toBe('stage-relevance');
    });

    it('converts multiple patterns', () => {
      const patterns: Pattern[] = [
        {
          id: 'gate-entry-fail-research',
          stageType: 'research',
          description: 'Fails entry gate.',
          evidence: [
            { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Fail' },
            { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Fail' },
            { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Fail' },
          ],
          frequency: 3,
          consistency: 0.8,
        },
        {
          id: 'artifacts-build-bundle',
          stageType: 'build',
          description: 'Produces bundle.',
          evidence: [
            { historyEntryId: 'h4', pipelineId: 'p1', observation: 'Artifact' },
            { historyEntryId: 'h5', pipelineId: 'p2', observation: 'Artifact' },
            { historyEntryId: 'h6', pipelineId: 'p3', observation: 'Artifact' },
          ],
          frequency: 3,
          consistency: 1.0,
        },
      ];
      const suggestions = extractor.suggestLearnings(patterns);
      expect(suggestions).toHaveLength(2);
    });

    it('calculates confidence based on consistency and evidence', () => {
      const highConfidencePattern: Pattern = {
        id: 'gate-exit-fail-build',
        stageType: 'build',
        description: 'High confidence pattern.',
        evidence: Array.from({ length: 10 }, (_, i) => ({
          historyEntryId: `h${i}`,
          pipelineId: `p${i}`,
          observation: 'Fail',
        })),
        frequency: 10,
        consistency: 1.0,
      };

      const lowConfidencePattern: Pattern = {
        id: 'gate-entry-fail-shape',
        stageType: 'shape',
        description: 'Low confidence pattern.',
        evidence: [
          { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Fail' },
          { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Fail' },
          { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Fail' },
        ],
        frequency: 3,
        consistency: 0.3,
      };

      const [high] = extractor.suggestLearnings([highConfidencePattern]);
      const [low] = extractor.suggestLearnings([lowConfidencePattern]);

      expect(high.confidence).toBeGreaterThan(low.confidence);
    });
  });

  describe('suggestPromptUpdates', () => {
    it('returns empty array when no learnings have stageType', () => {
      const learnings = [makeLearning({ stageType: undefined })];
      const stages = [makeStage({ type: 'build' })];
      expect(extractor.suggestPromptUpdates(learnings, stages)).toEqual([]);
    });

    it('returns empty array when no stages match learnings', () => {
      const learnings = [makeLearning({ stageType: 'research' })];
      const stages = [makeStage({ type: 'build' })];
      expect(extractor.suggestPromptUpdates(learnings, stages)).toEqual([]);
    });

    it('suggests prompt update for a stage with learnings', () => {
      const learnings = [
        makeLearning({ stageType: 'build', category: 'testing', content: 'Always run tests first' }),
      ];
      const stages = [makeStage({ type: 'build', promptTemplate: 'prompts/build.md' })];

      const updates = extractor.suggestPromptUpdates(learnings, stages);
      expect(updates).toHaveLength(1);
      expect(updates[0].stageType).toBe('build');
      expect(updates[0].currentPromptPath).toBe('prompts/build.md');
      expect(updates[0].section).toBe('testing');
      expect(updates[0].suggestion).toContain('Always run tests first');
      expect(updates[0].rationale).toContain('1 learning');
      expect(updates[0].basedOnLearnings).toHaveLength(1);
    });

    it('groups learnings by category for the same stage', () => {
      const learnings = [
        makeLearning({ stageType: 'build', category: 'testing', content: 'Write tests first' }),
        makeLearning({ stageType: 'build', category: 'testing', content: 'Mock external services' }),
        makeLearning({ stageType: 'build', category: 'performance', content: 'Profile after building' }),
      ];
      const stages = [makeStage({ type: 'build' })];

      const updates = extractor.suggestPromptUpdates(learnings, stages);
      expect(updates).toHaveLength(2);

      const testingUpdate = updates.find((u) => u.section === 'testing');
      expect(testingUpdate).toBeDefined();
      expect(testingUpdate!.basedOnLearnings).toHaveLength(2);
      expect(testingUpdate!.suggestion).toContain('Write tests first');
      expect(testingUpdate!.suggestion).toContain('Mock external services');

      const perfUpdate = updates.find((u) => u.section === 'performance');
      expect(perfUpdate).toBeDefined();
      expect(perfUpdate!.basedOnLearnings).toHaveLength(1);
    });

    it('handles multiple stages with different learnings', () => {
      const learnings = [
        makeLearning({ stageType: 'build', category: 'testing', content: 'Test everything' }),
        makeLearning({ stageType: 'research', category: 'sources', content: 'Check primary sources' }),
      ];
      const stages = [
        makeStage({ type: 'build' }),
        makeStage({ type: 'research' }),
      ];

      const updates = extractor.suggestPromptUpdates(learnings, stages);
      expect(updates).toHaveLength(2);
      expect(updates.map((u) => u.stageType).sort()).toEqual(['build', 'research']);
    });

    it('includes currentPromptPath when stage has a prompt template', () => {
      const learnings = [
        makeLearning({ stageType: 'build', category: 'testing', content: 'Test it' }),
      ];
      const stages = [makeStage({ type: 'build', promptTemplate: 'prompts/build.md' })];

      const updates = extractor.suggestPromptUpdates(learnings, stages);
      expect(updates[0].currentPromptPath).toBe('prompts/build.md');
    });

    it('sets currentPromptPath to undefined when stage has no prompt template', () => {
      const learnings = [
        makeLearning({ stageType: 'build', category: 'testing', content: 'Test it' }),
      ];
      const stages = [makeStage({ type: 'build' })];

      const updates = extractor.suggestPromptUpdates(learnings, stages);
      expect(updates[0].currentPromptPath).toBeUndefined();
    });
  });
});
