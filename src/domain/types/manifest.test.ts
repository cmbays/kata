import { describe, it, expect } from 'vitest';
import { ExecutionContextSchema, ExecutionManifestSchema, ExecutionResultSchema } from './manifest.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('ExecutionContextSchema', () => {
  it('parses minimal context', () => {
    const result = ExecutionContextSchema.parse({
      pipelineId: uuid(),
      stageIndex: 0,
    });
    expect(result.metadata).toEqual({});
  });

  it('parses context with metadata', () => {
    const result = ExecutionContextSchema.parse({
      pipelineId: uuid(),
      stageIndex: 3,
      metadata: { branch: 'session/0222-build', worktree: true },
    });
    expect(result.metadata).toHaveProperty('branch');
  });

  it('rejects negative stageIndex', () => {
    expect(() =>
      ExecutionContextSchema.parse({ pipelineId: uuid(), stageIndex: -1 })
    ).toThrow();
  });
});

describe('ExecutionManifestSchema', () => {
  it('parses minimal manifest', () => {
    const result = ExecutionManifestSchema.parse({
      stageType: 'build',
      prompt: 'Build the UI components for the dashboard',
      context: { pipelineId: uuid(), stageIndex: 4 },
    });
    expect(result.artifacts).toEqual([]);
    expect(result.learnings).toEqual([]);
  });

  it('parses full manifest with gates', () => {
    const result = ExecutionManifestSchema.parse({
      stageType: 'build',
      stageFlavor: 'frontend',
      prompt: 'Build the search widget',
      context: {
        pipelineId: uuid(),
        stageIndex: 4,
        metadata: { vertical: 'quoting' },
      },
      entryGate: {
        type: 'entry',
        conditions: [{ type: 'predecessor-complete', predecessorType: 'plan' }],
      },
      artifacts: [{ name: 'search-widget', extension: '.tsx' }],
    });
    expect(result.entryGate!.conditions).toHaveLength(1);
    expect(result.artifacts).toHaveLength(1);
  });

  it('rejects empty prompt', () => {
    expect(() =>
      ExecutionManifestSchema.parse({
        stageType: 'build',
        prompt: '',
        context: { pipelineId: uuid(), stageIndex: 0 },
      })
    ).toThrow();
  });
});

describe('ExecutionResultSchema', () => {
  it('parses success result', () => {
    const result = ExecutionResultSchema.parse({
      success: true,
      completedAt: now(),
    });
    expect(result.artifacts).toEqual([]);
    expect(result.tokenUsage).toBeUndefined();
  });

  it('parses result with token usage', () => {
    const result = ExecutionResultSchema.parse({
      success: true,
      artifacts: [{ name: 'component.tsx', path: 'src/components/Search.tsx' }],
      tokenUsage: {
        inputTokens: 50_000,
        outputTokens: 15_000,
        cacheCreationTokens: 5_000,
        cacheReadTokens: 20_000,
        total: 90_000,
      },
      durationMs: 45_000,
      notes: 'Completed in 45 seconds',
      completedAt: now(),
    });
    expect(result.tokenUsage!.total).toBe(90_000);
    expect(result.durationMs).toBe(45_000);
  });

  it('parses failure result', () => {
    const result = ExecutionResultSchema.parse({
      success: false,
      notes: 'Entry gate failed — predecessor not complete',
      completedAt: now(),
    });
    expect(result.success).toBe(false);
  });
});
