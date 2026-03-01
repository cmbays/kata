import { randomUUID } from 'node:crypto';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Learning } from '@domain/types/learning.js';
import type { Observation, FrictionTaxonomy, GapSeverity } from '@domain/types/observation.js';
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

// ---------------------------------------------------------------------------
// Helper for analyzeObservations tests
// ---------------------------------------------------------------------------

function makeObs(
  type: Observation['type'],
  content: string,
  extra: Record<string, unknown> = {},
): Observation {
  const base = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    content,
    ...extra,
  };

  switch (type) {
    case 'friction':
      return { ...base, type: 'friction', taxonomy: (extra['taxonomy'] as FrictionTaxonomy) ?? 'config-drift' };
    case 'gap':
      return { ...base, type: 'gap', severity: (extra['severity'] as GapSeverity) ?? 'major' };
    case 'assumption':
      return { ...base, type: 'assumption' };
    case 'prediction':
      return { ...base, type: 'prediction' };
    case 'decision':
      return { ...base, type: 'decision' };
    case 'outcome':
      return { ...base, type: 'outcome' };
    case 'insight':
      return { ...base, type: 'insight' };
    default:
      throw new Error(`Unknown type: ${type}`);
  }
}

describe('LearningExtractor.analyzeObservations', () => {
  let extractor: LearningExtractor;

  beforeEach(() => {
    extractor = new LearningExtractor();
  });

  it('returns empty array for empty observations input', () => {
    expect(extractor.analyzeObservations([])).toEqual([]);
  });

  // ---- Friction clustering ------------------------------------------------

  describe('friction clustering', () => {
    it('detects recurring friction pattern when 3+ observations share the same taxonomy', () => {
      const observations: Observation[] = [
        makeObs('friction', 'config drift causing problems', { taxonomy: 'config-drift' }),
        makeObs('friction', 'another config drift issue', { taxonomy: 'config-drift' }),
        makeObs('friction', 'config drift still present', { taxonomy: 'config-drift' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'recurring-friction-config-drift');
      expect(pattern).toBeDefined();
      expect(pattern!.frequency).toBe(3);
      expect(pattern!.stageType).toBe('friction');
      expect(pattern!.evidence).toHaveLength(3);
    });

    it('does not detect friction pattern when only 2 observations of same taxonomy', () => {
      const observations: Observation[] = [
        makeObs('friction', 'config drift causing problems', { taxonomy: 'config-drift' }),
        makeObs('friction', 'another config drift issue', { taxonomy: 'config-drift' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'recurring-friction-config-drift');
      expect(pattern).toBeUndefined();
    });

    it('groups friction observations by taxonomy independently', () => {
      const observations: Observation[] = [
        makeObs('friction', 'config drift 1', { taxonomy: 'config-drift' }),
        makeObs('friction', 'config drift 2', { taxonomy: 'config-drift' }),
        makeObs('friction', 'config drift 3', { taxonomy: 'config-drift' }),
        makeObs('friction', 'scope creep 1', { taxonomy: 'scope-creep' }),
        makeObs('friction', 'scope creep 2', { taxonomy: 'scope-creep' }),
        makeObs('friction', 'scope creep 3', { taxonomy: 'scope-creep' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'recurring-friction-config-drift')).toBeDefined();
      expect(patterns.find((p) => p.id === 'recurring-friction-scope-creep')).toBeDefined();
    });

    it('maps friction evidence with pipelineId set to "observation"', () => {
      const observations: Observation[] = [
        makeObs('friction', 'config drift 1', { taxonomy: 'config-drift' }),
        makeObs('friction', 'config drift 2', { taxonomy: 'config-drift' }),
        makeObs('friction', 'config drift 3', { taxonomy: 'config-drift' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'recurring-friction-config-drift');
      expect(pattern).toBeDefined();
      for (const e of pattern!.evidence) {
        expect(e.pipelineId).toBe('observation');
        expect(e.historyEntryId).toBeDefined();
      }
    });
  });

  // ---- Gap recurrence -----------------------------------------------------

  describe('gap recurrence', () => {
    it('detects recurring gap pattern when 3+ gaps share the same severity', () => {
      const observations: Observation[] = [
        makeObs('gap', 'missing test coverage', { severity: 'major' }),
        makeObs('gap', 'another major gap found', { severity: 'major' }),
        makeObs('gap', 'third major gap detected', { severity: 'major' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'recurring-gaps-major');
      expect(pattern).toBeDefined();
      expect(pattern!.frequency).toBe(3);
      expect(pattern!.stageType).toBe('gap');
    });

    it('does not detect gap pattern when only 2 gaps share severity', () => {
      const observations: Observation[] = [
        makeObs('gap', 'missing test coverage', { severity: 'critical' }),
        makeObs('gap', 'another critical gap', { severity: 'critical' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'recurring-gaps-critical')).toBeUndefined();
    });

    it('detects different severities independently', () => {
      const observations: Observation[] = [
        makeObs('gap', 'critical 1', { severity: 'critical' }),
        makeObs('gap', 'critical 2', { severity: 'critical' }),
        makeObs('gap', 'critical 3', { severity: 'critical' }),
        makeObs('gap', 'minor 1', { severity: 'minor' }),
        makeObs('gap', 'minor 2', { severity: 'minor' }),
        makeObs('gap', 'minor 3', { severity: 'minor' }),
      ];
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'recurring-gaps-critical')).toBeDefined();
      expect(patterns.find((p) => p.id === 'recurring-gaps-minor')).toBeDefined();
    });
  });

  // ---- Assumption density -------------------------------------------------

  describe('assumption density', () => {
    it('detects assumption-heavy-run when 5+ assumptions recorded', () => {
      const observations: Observation[] = Array.from({ length: 5 }, (_, i) =>
        makeObs('assumption', `assumption ${i + 1}`),
      );
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'assumption-heavy-run');
      expect(pattern).toBeDefined();
      expect(pattern!.frequency).toBe(5);
      expect(pattern!.stageType).toBe('assumptions');
      expect(pattern!.evidence).toHaveLength(5);
    });

    it('does not detect assumption-heavy-run when only 4 assumptions', () => {
      const observations: Observation[] = Array.from({ length: 4 }, (_, i) =>
        makeObs('assumption', `assumption ${i + 1}`),
      );
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'assumption-heavy-run')).toBeUndefined();
    });

    it('includes description mentioning count when 5+ assumptions', () => {
      const observations: Observation[] = Array.from({ length: 7 }, (_, i) =>
        makeObs('assumption', `assumption ${i + 1}`),
      );
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'assumption-heavy-run');
      expect(pattern!.description).toContain('7');
    });
  });

  // ---- Prediction rate ----------------------------------------------------

  describe('prediction rate', () => {
    it('detects low-prediction-discipline when total >= 10 and predictions < total/5', () => {
      // 10 total, 1 prediction (1/10 = 0.1 < 0.2 threshold)
      const observations: Observation[] = [
        makeObs('prediction', 'one prediction made'),
        ...Array.from({ length: 9 }, (_, i) => makeObs('decision', `decision ${i + 1}`)),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'low-prediction-discipline');
      expect(pattern).toBeDefined();
      expect(pattern!.stageType).toBe('predictions');
      expect(pattern!.evidence).toHaveLength(0);
    });

    it('does not detect low-prediction-discipline when predictions >= total/5', () => {
      // 10 total, 3 predictions (3/10 = 0.3 > 0.2 threshold)
      const observations: Observation[] = [
        makeObs('prediction', 'prediction 1'),
        makeObs('prediction', 'prediction 2'),
        makeObs('prediction', 'prediction 3'),
        ...Array.from({ length: 7 }, (_, i) => makeObs('decision', `decision ${i + 1}`)),
      ];
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'low-prediction-discipline')).toBeUndefined();
    });

    it('does not detect low-prediction-discipline when total < 10', () => {
      // 9 total, 0 predictions — not enough total observations
      const observations: Observation[] = Array.from({ length: 9 }, (_, i) =>
        makeObs('decision', `decision ${i + 1}`),
      );
      const patterns = extractor.analyzeObservations(observations);
      expect(patterns.find((p) => p.id === 'low-prediction-discipline')).toBeUndefined();
    });

    it('includes count in description', () => {
      const observations: Observation[] = [
        makeObs('prediction', 'one prediction'),
        ...Array.from({ length: 9 }, (_, i) => makeObs('outcome', `outcome ${i + 1}`)),
      ];
      const patterns = extractor.analyzeObservations(observations);
      const pattern = patterns.find((p) => p.id === 'low-prediction-discipline');
      expect(pattern).toBeDefined();
      expect(pattern!.description).toContain('1');
      expect(pattern!.description).toContain('10');
    });
  });

  // ---- Combined / edge cases ---------------------------------------------

  it('returns multiple pattern types simultaneously', () => {
    const observations: Observation[] = [
      makeObs('friction', 'config drift 1', { taxonomy: 'config-drift' }),
      makeObs('friction', 'config drift 2', { taxonomy: 'config-drift' }),
      makeObs('friction', 'config drift 3', { taxonomy: 'config-drift' }),
      makeObs('assumption', 'assumption 1'),
      makeObs('assumption', 'assumption 2'),
      makeObs('assumption', 'assumption 3'),
      makeObs('assumption', 'assumption 4'),
      makeObs('assumption', 'assumption 5'),
      makeObs('decision', 'decision 1'),
      makeObs('outcome', 'outcome 1'),
    ];
    const patterns = extractor.analyzeObservations(observations);
    const ids = patterns.map((p) => p.id);
    expect(ids).toContain('recurring-friction-config-drift');
    expect(ids).toContain('assumption-heavy-run');
  });

  it('consistency is computed as count divided by total', () => {
    const observations: Observation[] = [
      makeObs('friction', 'f1', { taxonomy: 'config-drift' }),
      makeObs('friction', 'f2', { taxonomy: 'config-drift' }),
      makeObs('friction', 'f3', { taxonomy: 'config-drift' }),
      makeObs('decision', 'd1'),
    ];
    const patterns = extractor.analyzeObservations(observations);
    const pattern = patterns.find((p) => p.id === 'recurring-friction-config-drift');
    expect(pattern).toBeDefined();
    expect(pattern!.consistency).toBeCloseTo(3 / 4, 5);
  });
});
