import { describe, it, expect } from 'vitest';
import { TokenUsageSchema, ExecutionHistoryEntrySchema } from './history.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('TokenUsageSchema', () => {
  it('parses with defaults', () => {
    const result = TokenUsageSchema.parse({});
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.total).toBe(0);
  });

  it('parses full usage', () => {
    const result = TokenUsageSchema.parse({
      inputTokens: 50_000,
      outputTokens: 15_000,
      cacheCreationTokens: 5_000,
      cacheReadTokens: 20_000,
      total: 90_000,
    });
    expect(result.total).toBe(90_000);
  });

  it('rejects negative tokens', () => {
    expect(() => TokenUsageSchema.parse({ inputTokens: -1 })).toThrow();
  });

  it('rejects non-integer tokens', () => {
    expect(() => TokenUsageSchema.parse({ inputTokens: 1.5 })).toThrow();
  });
});

describe('ExecutionHistoryEntrySchema', () => {
  it('parses minimal entry', () => {
    const ts = now();
    const result = ExecutionHistoryEntrySchema.parse({
      id: uuid(),
      pipelineId: uuid(),
      stageType: 'build',
      stageIndex: 4,
      adapter: 'claude-cli',
      startedAt: ts,
      completedAt: ts,
    });
    expect(result.artifactNames).toEqual([]);
    expect(result.learningIds).toEqual([]);
    expect(result.tokenUsage).toBeUndefined();
  });

  it('parses full entry with all fields', () => {
    const ts = now();
    const result = ExecutionHistoryEntrySchema.parse({
      id: uuid(),
      pipelineId: uuid(),
      stageType: 'build',
      stageFlavor: 'frontend',
      stageIndex: 4,
      adapter: 'claude-cli',
      tokenUsage: {
        inputTokens: 50_000,
        outputTokens: 15_000,
        total: 65_000,
      },
      durationMs: 120_000,
      artifactNames: ['search-widget.tsx', 'search-widget.test.ts'],
      entryGatePassed: true,
      exitGatePassed: true,
      learningIds: [uuid(), uuid()],
      cycleId: uuid(),
      betId: uuid(),
      startedAt: ts,
      completedAt: ts,
    });
    expect(result.artifactNames).toHaveLength(2);
    expect(result.learningIds).toHaveLength(2);
    expect(result.durationMs).toBe(120_000);
    expect(result.cycleId).toBeDefined();
  });

  it('rejects negative stageIndex', () => {
    expect(() =>
      ExecutionHistoryEntrySchema.parse({
        id: uuid(),
        pipelineId: uuid(),
        stageType: 'build',
        stageIndex: -1,
        adapter: 'manual',
        startedAt: now(),
        completedAt: now(),
      })
    ).toThrow();
  });
});
