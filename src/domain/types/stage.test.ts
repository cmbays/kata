import { describe, it, expect } from 'vitest';
import { StageCategorySchema, OrchestratorConfigSchema, StageSchema } from './stage.js';

describe('StageCategorySchema', () => {
  const validCategories = ['research', 'plan', 'build', 'review'];

  it('accepts all four stage categories', () => {
    for (const category of validCategories) {
      expect(StageCategorySchema.parse(category)).toBe(category);
    }
  });

  it('rejects unknown category', () => {
    expect(() => StageCategorySchema.parse('deploy')).toThrow();
  });

  it('rejects wrap-up (hyphenated form is not valid)', () => {
    expect(() => StageCategorySchema.parse('wrap-up')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => StageCategorySchema.parse('')).toThrow();
  });
});

describe('OrchestratorConfigSchema', () => {
  it('parses minimal config — applies defaults', () => {
    const result = OrchestratorConfigSchema.parse({ type: 'build' });
    expect(result.type).toBe('build');
    expect(result.confidenceThreshold).toBe(0.7);
    expect(result.maxParallelFlavors).toBe(5);
    expect(result.promptTemplate).toBeUndefined();
  });

  it('accepts all valid orchestrator types', () => {
    const types = ['research', 'plan', 'build', 'review'];
    for (const type of types) {
      expect(OrchestratorConfigSchema.parse({ type }).type).toBe(type);
    }
  });

  it('accepts custom promptTemplate path', () => {
    const result = OrchestratorConfigSchema.parse({
      type: 'research',
      promptTemplate: 'orchestrators/deep-research.md',
    });
    expect(result.promptTemplate).toBe('orchestrators/deep-research.md');
  });

  it('accepts overridden confidenceThreshold', () => {
    const result = OrchestratorConfigSchema.parse({ type: 'review', confidenceThreshold: 0.9 });
    expect(result.confidenceThreshold).toBe(0.9);
  });

  it('rejects confidenceThreshold below 0', () => {
    expect(() =>
      OrchestratorConfigSchema.parse({ type: 'build', confidenceThreshold: -0.1 })
    ).toThrow();
  });

  it('rejects confidenceThreshold above 1', () => {
    expect(() =>
      OrchestratorConfigSchema.parse({ type: 'build', confidenceThreshold: 1.1 })
    ).toThrow();
  });

  it('rejects maxParallelFlavors of zero', () => {
    expect(() =>
      OrchestratorConfigSchema.parse({ type: 'build', maxParallelFlavors: 0 })
    ).toThrow();
  });

  it('accepts maxParallelFlavors overridden to 1', () => {
    const result = OrchestratorConfigSchema.parse({ type: 'plan', maxParallelFlavors: 1 });
    expect(result.maxParallelFlavors).toBe(1);
  });

  it('rejects unknown orchestrator type', () => {
    expect(() => OrchestratorConfigSchema.parse({ type: 'deploy' })).toThrow();
  });
});

describe('StageSchema', () => {
  const baseOrchestrator = { type: 'build' as const };

  it('parses minimal stage with required fields', () => {
    const result = StageSchema.parse({
      category: 'build',
      orchestrator: baseOrchestrator,
      availableFlavors: ['typescript-feature', 'bug-fix'],
    });
    expect(result.category).toBe('build');
    expect(result.orchestrator.type).toBe('build');
    expect(result.availableFlavors).toEqual(['typescript-feature', 'bug-fix']);
    expect(result.entryGate).toBeUndefined();
    expect(result.exitGate).toBeUndefined();
    expect(result.pinnedFlavors).toBeUndefined();
    expect(result.excludedFlavors).toBeUndefined();
  });

  it('parses stage with empty availableFlavors', () => {
    const result = StageSchema.parse({
      category: 'research',
      orchestrator: { type: 'research' },
      availableFlavors: [],
    });
    expect(result.availableFlavors).toEqual([]);
  });

  it('parses stage with entry and exit gates', () => {
    const result = StageSchema.parse({
      category: 'review',
      orchestrator: { type: 'review' },
      availableFlavors: ['security-review'],
      entryGate: [{ type: 'predecessor-complete', predecessorType: 'build' }],
      exitGate: [{ type: 'human-approved' }],
    });
    expect(result.entryGate).toHaveLength(1);
    expect(result.entryGate![0]!.type).toBe('predecessor-complete');
    expect(result.exitGate).toHaveLength(1);
    expect(result.exitGate![0]!.type).toBe('human-approved');
  });

  it('parses stage with pinnedFlavors and excludedFlavors', () => {
    const result = StageSchema.parse({
      category: 'plan',
      orchestrator: { type: 'plan' },
      availableFlavors: ['ui-planning', 'data-model-planning', 'impl-planning'],
      pinnedFlavors: ['impl-planning'],
      excludedFlavors: ['legacy-planning'],
    });
    expect(result.pinnedFlavors).toEqual(['impl-planning']);
    expect(result.excludedFlavors).toEqual(['legacy-planning']);
  });

  it('rejects wrapup category (removed in v1)', () => {
    expect(() =>
      StageSchema.parse({
        category: 'wrapup',
        orchestrator: { type: 'wrapup' },
        availableFlavors: ['docs', 'learning-capture'],
      })
    ).toThrow();
  });

  it('parses full stage with all optional fields', () => {
    const result = StageSchema.parse({
      category: 'build',
      orchestrator: {
        type: 'build',
        promptTemplate: 'orchestrators/build-custom.md',
        confidenceThreshold: 0.85,
        maxParallelFlavors: 3,
      },
      availableFlavors: ['typescript-feature', 'api-integration', 'ui-component'],
      pinnedFlavors: ['typescript-feature'],
      excludedFlavors: [],
      entryGate: [{ type: 'artifact-exists', artifactName: 'implementation-plan.md' }],
      exitGate: [
        { type: 'command-passes', command: 'npm test' },
        { type: 'artifact-exists', artifactName: 'pr-ready' },
      ],
    });
    expect(result.orchestrator.confidenceThreshold).toBe(0.85);
    expect(result.orchestrator.maxParallelFlavors).toBe(3);
    expect(result.exitGate).toHaveLength(2);
    expect(result.exitGate![1]!.artifactName).toBe('pr-ready');
  });

  it('rejects stage with invalid category', () => {
    expect(() =>
      StageSchema.parse({
        category: 'deploy',
        orchestrator: baseOrchestrator,
        availableFlavors: [],
      })
    ).toThrow();
  });

  it('rejects stage missing orchestrator', () => {
    expect(() =>
      StageSchema.parse({
        category: 'build',
        availableFlavors: [],
      })
    ).toThrow();
  });

  it('rejects stage missing availableFlavors', () => {
    expect(() =>
      StageSchema.parse({
        category: 'build',
        orchestrator: baseOrchestrator,
      })
    ).toThrow();
  });
});
