import { describe, it, expect } from 'vitest';
import { StageType, StageRefSchema, StageSchema } from './stage.js';

describe('StageType', () => {
  const validTypes = ['research', 'interview', 'shape', 'breadboard', 'plan', 'build', 'review', 'wrap-up', 'custom'];

  it('accepts all valid stage types', () => {
    for (const type of validTypes) {
      expect(StageType.parse(type)).toBe(type);
    }
  });

  it('rejects invalid stage type', () => {
    expect(() => StageType.parse('deploy')).toThrow();
  });
});

describe('StageRefSchema', () => {
  it('parses type-only ref', () => {
    const result = StageRefSchema.parse({ type: 'build' });
    expect(result.type).toBe('build');
    expect(result.flavor).toBeUndefined();
  });

  it('parses ref with flavor', () => {
    const result = StageRefSchema.parse({ type: 'review', flavor: 'security' });
    expect(result.flavor).toBe('security');
  });

  it('rejects empty type', () => {
    expect(() => StageRefSchema.parse({ type: '' })).toThrow();
  });
});

describe('StageSchema', () => {
  it('parses minimal stage with defaults', () => {
    const result = StageSchema.parse({ type: 'build' });
    expect(result.type).toBe('build');
    expect(result.artifacts).toEqual([]);
    expect(result.learningHooks).toEqual([]);
    expect(result.config).toEqual({});
  });

  it('parses stage with gates and artifacts', () => {
    const result = StageSchema.parse({
      type: 'build',
      flavor: 'frontend',
      description: 'Build the UI components',
      entryGate: {
        type: 'entry',
        conditions: [{ type: 'predecessor-complete', predecessorType: 'plan' }],
      },
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'components.ts' }],
      },
      artifacts: [
        { name: 'components', extension: '.ts' },
      ],
      promptTemplate: 'stages/build/prompt.md',
      learningHooks: ['extract-patterns', 'log-decisions'],
      config: { parallel: true, maxRetries: 3 },
    });
    expect(result.entryGate!.conditions).toHaveLength(1);
    expect(result.exitGate!.conditions[0]!.artifactName).toBe('components.ts');
    expect(result.artifacts).toHaveLength(1);
    expect(result.config).toEqual({ parallel: true, maxRetries: 3 });
  });
});
