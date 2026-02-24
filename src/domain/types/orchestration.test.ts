import { describe, it, expect } from 'vitest';
import {
  CapabilityProfileSchema,
  MatchReportSchema,
  GapReportSchema,
  ExecutionPlanSchema,
  ReflectionResultSchema,
} from './orchestration.js';

const VALID_UUID = '00000000-0000-4000-8000-000000000001';
const VALID_UUID_2 = '00000000-0000-4000-8000-000000000002';

describe('CapabilityProfileSchema', () => {
  it('parses a full profile with all fields', () => {
    const result = CapabilityProfileSchema.parse({
      betContext: { betId: 'bet-1', description: 'Add auth' },
      availableArtifacts: ['research-summary.md', 'shape-document.md'],
      activeRules: [VALID_UUID],
      learnings: ['TDD works well for auth features'],
      stageCategory: 'build',
    });
    expect(result.stageCategory).toBe('build');
    expect(result.availableArtifacts).toHaveLength(2);
    expect(result.activeRules).toHaveLength(1);
    expect(result.learnings).toHaveLength(1);
    expect(result.betContext).toEqual({ betId: 'bet-1', description: 'Add auth' });
  });

  it('parses a minimal profile without betContext', () => {
    const result = CapabilityProfileSchema.parse({
      availableArtifacts: [],
      activeRules: [],
      learnings: [],
      stageCategory: 'research',
    });
    expect(result.betContext).toBeUndefined();
    expect(result.availableArtifacts).toEqual([]);
    expect(result.stageCategory).toBe('research');
  });

  it('accepts all four stage categories', () => {
    for (const cat of ['research', 'plan', 'build', 'review'] as const) {
      const result = CapabilityProfileSchema.parse({
        availableArtifacts: [],
        activeRules: [],
        learnings: [],
        stageCategory: cat,
      });
      expect(result.stageCategory).toBe(cat);
    }
  });

  it('rejects invalid stage category', () => {
    expect(() =>
      CapabilityProfileSchema.parse({
        availableArtifacts: [],
        activeRules: [],
        learnings: [],
        stageCategory: 'deploy',
      }),
    ).toThrow();
  });

  it('rejects missing required field (availableArtifacts)', () => {
    expect(() =>
      CapabilityProfileSchema.parse({
        activeRules: [],
        learnings: [],
        stageCategory: 'build',
      }),
    ).toThrow();
  });
});

describe('MatchReportSchema', () => {
  it('parses a valid match report', () => {
    const result = MatchReportSchema.parse({
      flavorName: 'typescript-feature',
      score: 0.85,
      keywordHits: 3,
      ruleAdjustments: 0.1,
      learningBoost: 0.05,
      reasoning: 'High keyword match with TDD rule boost.',
    });
    expect(result.flavorName).toBe('typescript-feature');
    expect(result.score).toBe(0.85);
    expect(result.keywordHits).toBe(3);
    expect(result.ruleAdjustments).toBe(0.1);
    expect(result.learningBoost).toBe(0.05);
  });

  it('accepts score boundary values 0 and 1', () => {
    expect(
      MatchReportSchema.parse({
        flavorName: 'f',
        score: 0,
        keywordHits: 0,
        ruleAdjustments: 0,
        learningBoost: 0,
        reasoning: 'No match.',
      }).score,
    ).toBe(0);
    expect(
      MatchReportSchema.parse({
        flavorName: 'f',
        score: 1,
        keywordHits: 5,
        ruleAdjustments: 0.2,
        learningBoost: 0.1,
        reasoning: 'Perfect match.',
      }).score,
    ).toBe(1);
  });

  it('accepts negative ruleAdjustments (penalize)', () => {
    const result = MatchReportSchema.parse({
      flavorName: 'legacy-flavor',
      score: 0.2,
      keywordHits: 1,
      ruleAdjustments: -0.3,
      learningBoost: 0,
      reasoning: 'Penalized by ESM rule.',
    });
    expect(result.ruleAdjustments).toBe(-0.3);
  });

  it('rejects score below 0', () => {
    expect(() =>
      MatchReportSchema.parse({
        flavorName: 'f',
        score: -0.1,
        keywordHits: 0,
        ruleAdjustments: 0,
        learningBoost: 0,
        reasoning: 'Invalid.',
      }),
    ).toThrow();
  });

  it('rejects score above 1', () => {
    expect(() =>
      MatchReportSchema.parse({
        flavorName: 'f',
        score: 1.1,
        keywordHits: 0,
        ruleAdjustments: 0,
        learningBoost: 0,
        reasoning: 'Invalid.',
      }),
    ).toThrow();
  });

  it('rejects negative keywordHits', () => {
    expect(() =>
      MatchReportSchema.parse({
        flavorName: 'f',
        score: 0.5,
        keywordHits: -1,
        ruleAdjustments: 0,
        learningBoost: 0,
        reasoning: 'Invalid.',
      }),
    ).toThrow();
  });

  it('rejects negative learningBoost', () => {
    expect(() =>
      MatchReportSchema.parse({
        flavorName: 'f',
        score: 0.5,
        keywordHits: 0,
        ruleAdjustments: 0,
        learningBoost: -0.1,
        reasoning: 'Invalid.',
      }),
    ).toThrow();
  });

  it('rejects empty flavorName', () => {
    expect(() =>
      MatchReportSchema.parse({
        flavorName: '',
        score: 0.5,
        keywordHits: 0,
        ruleAdjustments: 0,
        learningBoost: 0,
        reasoning: 'Missing name.',
      }),
    ).toThrow();
  });
});

describe('GapReportSchema', () => {
  it('parses a valid gap report', () => {
    const result = GapReportSchema.parse({
      description: 'No security review flavor selected',
      severity: 'high',
      suggestedFlavors: ['security-review', 'dependency-audit'],
    });
    expect(result.description).toBe('No security review flavor selected');
    expect(result.severity).toBe('high');
    expect(result.suggestedFlavors).toHaveLength(2);
  });

  it('accepts all three severities', () => {
    for (const severity of ['low', 'medium', 'high'] as const) {
      const result = GapReportSchema.parse({
        description: 'A gap',
        severity,
        suggestedFlavors: [],
      });
      expect(result.severity).toBe(severity);
    }
  });

  it('accepts empty suggestedFlavors', () => {
    const result = GapReportSchema.parse({
      description: 'Minor gap with no known fix',
      severity: 'low',
      suggestedFlavors: [],
    });
    expect(result.suggestedFlavors).toEqual([]);
  });

  it('rejects empty description', () => {
    expect(() =>
      GapReportSchema.parse({
        description: '',
        severity: 'low',
        suggestedFlavors: [],
      }),
    ).toThrow();
  });

  it('rejects invalid severity', () => {
    expect(() =>
      GapReportSchema.parse({
        description: 'A gap',
        severity: 'critical',
        suggestedFlavors: [],
      }),
    ).toThrow();
  });
});

describe('ExecutionPlanSchema', () => {
  it('parses a valid execution plan', () => {
    const result = ExecutionPlanSchema.parse({
      selectedFlavors: ['typescript-feature', 'api-integration'],
      executionMode: 'parallel',
      reasoning: 'Both flavors are independent and can run concurrently.',
      gaps: [],
    });
    expect(result.selectedFlavors).toHaveLength(2);
    expect(result.executionMode).toBe('parallel');
    expect(result.gaps).toEqual([]);
  });

  it('accepts sequential execution mode', () => {
    const result = ExecutionPlanSchema.parse({
      selectedFlavors: ['data-model'],
      executionMode: 'sequential',
      reasoning: 'Single flavor — sequential by default.',
      gaps: [],
    });
    expect(result.executionMode).toBe('sequential');
  });

  it('accepts plan with gaps', () => {
    const result = ExecutionPlanSchema.parse({
      selectedFlavors: ['typescript-feature'],
      executionMode: 'sequential',
      reasoning: 'Best match for current context.',
      gaps: [
        {
          description: 'No testing flavor included',
          severity: 'medium',
          suggestedFlavors: ['tdd-feature'],
        },
      ],
    });
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].severity).toBe('medium');
  });

  it('rejects empty selectedFlavors', () => {
    expect(() =>
      ExecutionPlanSchema.parse({
        selectedFlavors: [],
        executionMode: 'sequential',
        reasoning: 'No flavors selected.',
        gaps: [],
      }),
    ).toThrow();
  });

  it('rejects invalid execution mode', () => {
    expect(() =>
      ExecutionPlanSchema.parse({
        selectedFlavors: ['a'],
        executionMode: 'batch',
        reasoning: 'Invalid mode.',
        gaps: [],
      }),
    ).toThrow();
  });

  it('rejects empty reasoning', () => {
    expect(() =>
      ExecutionPlanSchema.parse({
        selectedFlavors: ['a'],
        executionMode: 'sequential',
        reasoning: '',
        gaps: [],
      }),
    ).toThrow();
  });
});

describe('ReflectionResultSchema', () => {
  it('parses a valid reflection result', () => {
    const result = ReflectionResultSchema.parse({
      decisionOutcomes: [
        {
          decisionId: VALID_UUID,
          outcome: { artifactQuality: 'good', gateResult: 'passed' },
        },
      ],
      learnings: ['TDD approach worked well for this feature.'],
      ruleSuggestions: [VALID_UUID_2],
      overallQuality: 'good',
    });
    expect(result.decisionOutcomes).toHaveLength(1);
    expect(result.decisionOutcomes[0].outcome.artifactQuality).toBe('good');
    expect(result.learnings).toHaveLength(1);
    expect(result.ruleSuggestions).toEqual([VALID_UUID_2]);
    expect(result.overallQuality).toBe('good');
  });

  it('accepts all three quality levels', () => {
    for (const quality of ['good', 'partial', 'poor'] as const) {
      const result = ReflectionResultSchema.parse({
        decisionOutcomes: [],
        learnings: [],
        ruleSuggestions: [],
        overallQuality: quality,
      });
      expect(result.overallQuality).toBe(quality);
    }
  });

  it('accepts empty arrays', () => {
    const result = ReflectionResultSchema.parse({
      decisionOutcomes: [],
      learnings: [],
      ruleSuggestions: [],
      overallQuality: 'partial',
    });
    expect(result.decisionOutcomes).toEqual([]);
    expect(result.learnings).toEqual([]);
    expect(result.ruleSuggestions).toEqual([]);
  });

  it('rejects invalid overallQuality', () => {
    expect(() =>
      ReflectionResultSchema.parse({
        decisionOutcomes: [],
        learnings: [],
        ruleSuggestions: [],
        overallQuality: 'excellent',
      }),
    ).toThrow();
  });

  it('rejects non-UUID decisionId', () => {
    expect(() =>
      ReflectionResultSchema.parse({
        decisionOutcomes: [
          {
            decisionId: 'bad-id',
            outcome: { artifactQuality: 'good' },
          },
        ],
        learnings: [],
        ruleSuggestions: [],
        overallQuality: 'good',
      }),
    ).toThrow();
  });

  it('rejects non-UUID ruleSuggestion IDs', () => {
    expect(() =>
      ReflectionResultSchema.parse({
        decisionOutcomes: [],
        learnings: [],
        ruleSuggestions: ['not-a-uuid'],
        overallQuality: 'good',
      }),
    ).toThrow();
  });

  it('rejects outcome with no fields set', () => {
    expect(() =>
      ReflectionResultSchema.parse({
        decisionOutcomes: [
          {
            decisionId: VALID_UUID,
            outcome: {},
          },
        ],
        learnings: [],
        ruleSuggestions: [],
        overallQuality: 'good',
      }),
    ).toThrow();
  });

  it('accepts multiple decision outcomes', () => {
    const result = ReflectionResultSchema.parse({
      decisionOutcomes: [
        { decisionId: VALID_UUID, outcome: { artifactQuality: 'good' } },
        { decisionId: VALID_UUID_2, outcome: { reworkRequired: true, notes: 'Needed fixes.' } },
      ],
      learnings: ['Learning 1', 'Learning 2'],
      ruleSuggestions: [],
      overallQuality: 'partial',
    });
    expect(result.decisionOutcomes).toHaveLength(2);
    expect(result.learnings).toHaveLength(2);
  });
});
