import type { SuggestedLearning, PromptUpdate, Pattern } from '@features/self-improvement/learning-extractor.js';
import {
  formatSuggestedLearning,
  formatPromptUpdateDiff,
  formatReviewSummary,
  formatSuggestedLearningJson,
} from './learning-formatter.js';

function makePattern(overrides: Partial<Pattern> = {}): Pattern {
  return {
    id: 'gate-entry-fail-build',
    stageType: 'build',
    description: 'Build frequently fails entry gate.',
    evidence: [
      { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Entry gate failed at stage index 0' },
      { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Entry gate failed at stage index 0' },
      { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Entry gate failed at stage index 0' },
    ],
    frequency: 3,
    consistency: 0.75,
    ...overrides,
  };
}

function makeSuggestion(overrides: Partial<SuggestedLearning> = {}): SuggestedLearning {
  return {
    tier: 'stage',
    category: 'gate-management',
    content: 'Build frequently fails entry gate.',
    stageType: 'build',
    confidence: 0.8,
    evidenceCount: 3,
    pattern: makePattern(),
    ...overrides,
  };
}

function makePromptUpdate(overrides: Partial<PromptUpdate> = {}): PromptUpdate {
  return {
    stageType: 'build',
    currentPromptPath: 'prompts/build.md',
    section: 'testing',
    suggestion: '## Learned Patterns (testing)\n\n- Always run tests first',
    rationale: '1 learning accumulated for "testing" in the "build" stage.',
    basedOnLearnings: ['learning-1'],
    ...overrides,
  };
}

describe('formatSuggestedLearning', () => {
  it('displays tier, category, confidence, and content', () => {
    const result = formatSuggestedLearning(makeSuggestion());
    expect(result).toContain('=== Suggested Learning ===');
    expect(result).toContain('Tier:       stage');
    expect(result).toContain('Category:   gate-management');
    expect(result).toContain('Confidence: 0.80');
    expect(result).toContain('Evidence:   3 observation(s)');
    expect(result).toContain('Build frequently fails entry gate.');
  });

  it('shows stageType when present (plain)', () => {
    const result = formatSuggestedLearning(makeSuggestion({ stageType: 'research' }), true);
    expect(result).toContain('Stage:      research');
  });

  it('uses thematic stage label by default', () => {
    const result = formatSuggestedLearning(makeSuggestion({ stageType: 'research' }));
    expect(result).toContain('Gyo:      research');
  });

  it('omits stageType when undefined', () => {
    const result = formatSuggestedLearning(makeSuggestion({ stageType: undefined }));
    expect(result).not.toContain('Stage:');
  });

  it('shows evidence samples', () => {
    const result = formatSuggestedLearning(makeSuggestion());
    expect(result).toContain('Evidence samples:');
    expect(result).toContain('- Entry gate failed at stage index 0');
  });

  it('shows "and N more" when evidence exceeds 3', () => {
    const pattern = makePattern({
      evidence: [
        { historyEntryId: 'h1', pipelineId: 'p1', observation: 'Obs 1' },
        { historyEntryId: 'h2', pipelineId: 'p2', observation: 'Obs 2' },
        { historyEntryId: 'h3', pipelineId: 'p3', observation: 'Obs 3' },
        { historyEntryId: 'h4', pipelineId: 'p4', observation: 'Obs 4' },
        { historyEntryId: 'h5', pipelineId: 'p5', observation: 'Obs 5' },
      ],
    });
    const result = formatSuggestedLearning(makeSuggestion({ pattern, evidenceCount: 5 }));
    expect(result).toContain('... and 2 more');
  });
});

describe('formatPromptUpdateDiff', () => {
  it('displays stage, section, and file (plain)', () => {
    const result = formatPromptUpdateDiff(makePromptUpdate(), true);
    expect(result).toContain('=== Prompt Update ===');
    expect(result).toContain('Stage:   build');
    expect(result).toContain('Section: testing');
    expect(result).toContain('File:    prompts/build.md');
  });

  it('uses thematic stage label by default', () => {
    const result = formatPromptUpdateDiff(makePromptUpdate());
    expect(result).toContain('Gyo:   build');
  });

  it('shows diff-style additions', () => {
    const result = formatPromptUpdateDiff(makePromptUpdate());
    expect(result).toContain('+ ## Learned Patterns (testing)');
    expect(result).toContain('+ - Always run tests first');
  });

  it('shows rationale and learning count', () => {
    const result = formatPromptUpdateDiff(makePromptUpdate());
    expect(result).toContain('Rationale: 1 learning accumulated');
    expect(result).toContain('Based on 1 learning(s)');
  });

  it('omits file when currentPromptPath is undefined', () => {
    const result = formatPromptUpdateDiff(makePromptUpdate({ currentPromptPath: undefined }));
    expect(result).not.toContain('File:');
  });

  it('handles multi-line suggestions', () => {
    const update = makePromptUpdate({
      suggestion: 'Line 1\nLine 2\nLine 3',
    });
    const result = formatPromptUpdateDiff(update);
    expect(result).toContain('+ Line 1');
    expect(result).toContain('+ Line 2');
    expect(result).toContain('+ Line 3');
  });
});

describe('formatReviewSummary', () => {
  it('shows accepted, rejected, and prompts updated (plain)', () => {
    const result = formatReviewSummary(5, 3, 2, true);
    expect(result).toContain('=== Knowledge Review Summary ===');
    expect(result).toContain('Learnings accepted:  5');
    expect(result).toContain('Learnings rejected:  3');
    expect(result).toContain('Prompts updated:     2');
  });

  it('uses thematic knowledge label by default', () => {
    const result = formatReviewSummary(5, 3, 2);
    expect(result).toContain('=== Bunkai Review Summary ===');
  });

  it('calculates acceptance rate', () => {
    const result = formatReviewSummary(3, 1, 1);
    expect(result).toContain('Acceptance rate:     75%');
  });

  it('shows 100% acceptance rate when all accepted', () => {
    const result = formatReviewSummary(10, 0, 5);
    expect(result).toContain('Acceptance rate:     100%');
  });

  it('shows 0% acceptance rate when none accepted', () => {
    const result = formatReviewSummary(0, 5, 0);
    expect(result).toContain('Acceptance rate:     0%');
  });

  it('omits acceptance rate when no learnings reviewed', () => {
    const result = formatReviewSummary(0, 0, 0);
    expect(result).not.toContain('Acceptance rate');
  });
});

describe('formatSuggestedLearningJson', () => {
  it('returns valid JSON array', () => {
    const suggestions = [makeSuggestion()];
    const result = formatSuggestedLearningJson(suggestions);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].tier).toBe('stage');
    expect(parsed[0].category).toBe('gate-management');
    expect(parsed[0].patternId).toBe('gate-entry-fail-build');
  });

  it('returns empty array for no suggestions', () => {
    const result = formatSuggestedLearningJson([]);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([]);
  });

  it('includes all key fields in JSON output', () => {
    const suggestions = [makeSuggestion({ stageType: 'research', confidence: 0.65, evidenceCount: 7 })];
    const result = formatSuggestedLearningJson(suggestions);
    const parsed = JSON.parse(result);
    expect(parsed[0].stageType).toBe('research');
    expect(parsed[0].confidence).toBe(0.65);
    expect(parsed[0].evidenceCount).toBe(7);
  });

  it('handles multiple suggestions', () => {
    const suggestions = [
      makeSuggestion({ category: 'gate-management' }),
      makeSuggestion({ category: 'token-efficiency', pattern: makePattern({ id: 'high-tokens-build' }) }),
    ];
    const result = formatSuggestedLearningJson(suggestions);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].category).toBe('gate-management');
    expect(parsed[1].category).toBe('token-efficiency');
  });
});
