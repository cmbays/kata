import { describe, expect, it } from 'vitest';
import { summarizeCycleCompletion } from '@infra/execution/session-bridge-cycle-completion.js';

describe('summarizeCycleCompletion', () => {
  it('sums durations and persisted token usage across completed and failed runs', () => {
    const totals = summarizeCycleCompletion([
      {
        status: 'complete',
        startedAt: '2026-03-15T12:00:00.000Z',
        completedAt: '2026-03-15T12:02:00.000Z',
        tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      {
        status: 'failed',
        startedAt: '2026-03-15T12:05:00.000Z',
        completedAt: '2026-03-15T12:06:30.000Z',
        tokenUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      },
    ]);

    expect(totals.completedBets).toBe(1);
    expect(totals.totalDurationMs).toBe(210_000);
    expect(totals.tokenUsage).toEqual({ inputTokens: 14, outputTokens: 7, total: 21 });
  });

  it('ignores incomplete runs and leaves token usage null when none was persisted', () => {
    const totals = summarizeCycleCompletion([
      {
        status: 'in-progress',
        startedAt: '2026-03-15T12:00:00.000Z',
      },
      {
        status: 'complete',
        startedAt: '2026-03-15T12:05:00.000Z',
        completedAt: '2026-03-15T12:08:00.000Z',
      },
    ]);

    expect(totals.completedBets).toBe(1);
    expect(totals.totalDurationMs).toBe(180_000);
    expect(totals.tokenUsage).toBeNull();
  });

  it('clamps malformed or out-of-order timestamps to zero duration', () => {
    const totals = summarizeCycleCompletion([
      {
        status: 'complete',
        startedAt: 'not-a-date',
        completedAt: '2026-03-15T12:02:00.000Z',
      },
      {
        status: 'failed',
        startedAt: '2026-03-15T12:05:00.000Z',
        completedAt: '2026-03-15T12:04:00.000Z',
      },
    ]);

    expect(totals.completedBets).toBe(1);
    expect(totals.totalDurationMs).toBe(0);
    expect(totals.tokenUsage).toBeNull();
  });
});
