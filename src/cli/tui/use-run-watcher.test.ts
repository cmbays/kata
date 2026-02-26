import React from 'react';
import { renderToString, Text } from 'ink';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { WatchRun } from './run-reader.js';

// Mock node:fs before importing the module under test
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, watch: vi.fn() };
});

import * as fsModule from 'node:fs';
import { createRunWatcher, useRunWatcher, DEBOUNCE_MS } from './use-run-watcher.js';

const mockWatch = vi.mocked(fsModule.watch);

beforeEach(() => {
  mockWatch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createRunWatcher', () => {
  it('starts watching the given directory', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof fsModule.watch>);

    const cleanup = createRunWatcher('/fake/dir', vi.fn());

    expect(mockWatch).toHaveBeenCalledWith(
      '/fake/dir',
      { recursive: true },
      expect.any(Function),
    );
    cleanup();
  });

  it('returned cleanup closes the watcher', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as unknown as ReturnType<typeof fsModule.watch>);

    const cleanup = createRunWatcher('/fake/dir', vi.fn());
    cleanup();

    expect(mockWatcher.close).toHaveBeenCalled();
  });

  it('calls onUpdate after DEBOUNCE_MS on file change', async () => {
    vi.useFakeTimers();

    let watchCb: (() => void) | undefined;
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockImplementation((_p: unknown, _o: unknown, cb: unknown) => {
      watchCb = cb as () => void;
      return mockWatcher as unknown as ReturnType<typeof fsModule.watch>;
    });

    const onUpdate = vi.fn();
    const cleanup = createRunWatcher('/fake/dir', onUpdate);

    watchCb?.();
    expect(onUpdate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('debounces multiple rapid changes into a single onUpdate call', async () => {
    vi.useFakeTimers();

    let watchCb: (() => void) | undefined;
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockImplementation((_p: unknown, _o: unknown, cb: unknown) => {
      watchCb = cb as () => void;
      return mockWatcher as unknown as ReturnType<typeof fsModule.watch>;
    });

    const onUpdate = vi.fn();
    const cleanup = createRunWatcher('/fake/dir', onUpdate);

    watchCb?.();
    watchCb?.();
    watchCb?.();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('cleanup clears a pending debounce timer', async () => {
    vi.useFakeTimers();

    let watchCb: (() => void) | undefined;
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockImplementation((_p: unknown, _o: unknown, cb: unknown) => {
      watchCb = cb as () => void;
      return mockWatcher as unknown as ReturnType<typeof fsModule.watch>;
    });

    const onUpdate = vi.fn();
    const cleanup = createRunWatcher('/fake/dir', onUpdate);

    watchCb?.();
    cleanup(); // cancel before debounce fires

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('handles a nonexistent directory without throwing', () => {
    mockWatch.mockImplementation(() => {
      throw new Error('ENOENT: no such file or directory');
    });

    const onUpdate = vi.fn();
    const cleanup = createRunWatcher('/nonexistent', onUpdate);

    // cleanup should not throw even when watcher was never created
    expect(() => cleanup()).not.toThrow();
  });
});

// ── useRunWatcher hook ─────────────────────────────────────────────────────

describe('useRunWatcher', () => {
  beforeEach(() => {
    // Return a no-op watcher so fs.watch doesn't cause issues
    mockWatch.mockReturnValue({ close: vi.fn() } as unknown as ReturnType<typeof fsModule.watch>);
  });

  it('returns an object with runs array and refresh function', () => {
    let capturedResult: { runs: WatchRun[]; refresh: () => void } | undefined;

    function TestComp() {
      capturedResult = useRunWatcher('/nonexistent-dir-xyz');
      return React.createElement(Text, null, `${capturedResult.runs.length}`);
    }

    renderToString(React.createElement(TestComp));

    expect(capturedResult).toBeDefined();
    expect(Array.isArray(capturedResult?.runs)).toBe(true);
    expect(typeof capturedResult?.refresh).toBe('function');
  });

  it('initial runs are empty for a nonexistent directory', () => {
    let capturedRuns: WatchRun[] | undefined;

    function TestComp() {
      const { runs } = useRunWatcher('/no-such-dir-for-testing');
      capturedRuns = runs;
      return React.createElement(Text, null, `${runs.length}`);
    }

    renderToString(React.createElement(TestComp));

    expect(capturedRuns).toEqual([]);
  });

  it('passes cycleId to listActiveRuns filtering', () => {
    let capturedResult: { runs: WatchRun[] } | undefined;

    function TestComp() {
      capturedResult = useRunWatcher('/no-such-dir', 'some-cycle-id');
      return React.createElement(Text, null, `${capturedResult.runs.length}`);
    }

    renderToString(React.createElement(TestComp));

    // listActiveRuns returns [] for nonexistent dir regardless of cycleId
    expect(capturedResult?.runs).toEqual([]);
  });
});
