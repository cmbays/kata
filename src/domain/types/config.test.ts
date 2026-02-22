import { describe, it, expect } from 'vitest';
import { ExecutionAdapterType, KataConfigSchema } from './config.js';

describe('ExecutionAdapterType', () => {
  it('accepts all adapter types', () => {
    for (const a of ['manual', 'claude-cli', 'composio']) {
      expect(ExecutionAdapterType.parse(a)).toBe(a);
    }
  });
});

describe('KataConfigSchema', () => {
  it('parses empty config with all defaults', () => {
    const result = KataConfigSchema.parse({});
    expect(result.methodology).toBe('shape-up');
    expect(result.execution.adapter).toBe('manual');
    expect(result.execution.config).toEqual({});
    expect(result.customStagePaths).toEqual([]);
    expect(result.project.name).toBeUndefined();
  });

  it('parses full config', () => {
    const result = KataConfigSchema.parse({
      methodology: 'kanban',
      execution: {
        adapter: 'claude-cli',
        config: { model: 'claude-sonnet-4-6', maxTurns: 50 },
      },
      customStagePaths: ['./stages/custom-review.json'],
      project: {
        name: 'Screen Print Pro',
        repository: 'cmbays/print-4ink',
      },
    });
    expect(result.methodology).toBe('kanban');
    expect(result.execution.adapter).toBe('claude-cli');
    expect(result.execution.config).toHaveProperty('model');
    expect(result.project.name).toBe('Screen Print Pro');
  });

  it('rejects invalid adapter type', () => {
    expect(() =>
      KataConfigSchema.parse({
        execution: { adapter: 'openai' },
      })
    ).toThrow();
  });
});
