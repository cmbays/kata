import { describe, it, expect } from 'vitest';
import { StageType, StageRefSchema, StageResourcesSchema, StageSchema } from './stage.js';

describe('StageType', () => {
  const validTypes = ['research', 'interview', 'shape', 'breadboard', 'plan', 'build', 'review', 'wrap-up', 'custom'];

  it('accepts all valid stage types', () => {
    for (const type of validTypes) {
      expect(StageType.parse(type)).toBe(type);
    }
  });

  it('rejects invalid stage type', () => {
    expect(() => StageType.parse('not-a-real-stage')).toThrow();
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

describe('StageResourcesSchema', () => {
  it('parses empty resources with defaults', () => {
    const result = StageResourcesSchema.parse({});
    expect(result.tools).toEqual([]);
    expect(result.agents).toEqual([]);
    expect(result.skills).toEqual([]);
  });

  it('parses tools with command', () => {
    const result = StageResourcesSchema.parse({
      tools: [{ name: 'tsc', purpose: 'Type checking', command: 'npx tsc --noEmit' }],
    });
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe('tsc');
    expect(result.tools[0]!.command).toBe('npx tsc --noEmit');
  });

  it('parses tools without command (optional)', () => {
    const result = StageResourcesSchema.parse({
      tools: [{ name: 'eslint', purpose: 'Linting' }],
    });
    expect(result.tools[0]!.command).toBeUndefined();
  });

  it('rejects tool with empty name', () => {
    expect(() => StageResourcesSchema.parse({
      tools: [{ name: '', purpose: 'Linting' }],
    })).toThrow();
  });

  it('rejects tool with empty purpose', () => {
    expect(() => StageResourcesSchema.parse({
      tools: [{ name: 'eslint', purpose: '' }],
    })).toThrow();
  });

  it('rejects agent with empty name', () => {
    expect(() => StageResourcesSchema.parse({
      agents: [{ name: '' }],
    })).toThrow();
  });

  it('parses agents with when hint', () => {
    const result = StageResourcesSchema.parse({
      agents: [{ name: 'everything-claude-code:build-error-resolver', when: 'when build fails' }],
    });
    expect(result.agents[0]!.name).toBe('everything-claude-code:build-error-resolver');
    expect(result.agents[0]!.when).toBe('when build fails');
  });

  it('parses skills without when (optional)', () => {
    const result = StageResourcesSchema.parse({
      skills: [{ name: 'pr-review-toolkit:code-reviewer' }],
    });
    expect(result.skills[0]!.when).toBeUndefined();
  });

  it('parses full resources object', () => {
    const result = StageResourcesSchema.parse({
      tools: [{ name: 'tsc', purpose: 'Type checking' }],
      agents: [{ name: 'build-resolver', when: 'on failure' }],
      skills: [{ name: 'code-reviewer', when: 'before done' }],
    });
    expect(result.tools).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.skills).toHaveLength(1);
  });
});

describe('StageSchema', () => {
  it('parses minimal stage with defaults', () => {
    const result = StageSchema.parse({ type: 'build' });
    expect(result.type).toBe('build');
    expect(result.artifacts).toEqual([]);
    expect(result.learningHooks).toEqual([]);
    expect(result.config).toEqual({});
    expect(result.resources).toBeUndefined();
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

  it('parses stage with resources field', () => {
    const result = StageSchema.parse({
      type: 'build',
      flavor: 'typescript',
      resources: {
        tools: [{ name: 'tsc', purpose: 'Type checking', command: 'npx tsc --noEmit' }],
        agents: [{ name: 'build-resolver', when: 'when build fails' }],
        skills: [],
      },
    });
    expect(result.resources).toBeDefined();
    expect(result.resources!.tools).toHaveLength(1);
    expect(result.resources!.agents).toHaveLength(1);
    expect(result.resources!.skills).toHaveLength(0);
  });

  it('accepts stage without resources (optional)', () => {
    const result = StageSchema.parse({ type: 'research' });
    expect(result.resources).toBeUndefined();
  });
});
