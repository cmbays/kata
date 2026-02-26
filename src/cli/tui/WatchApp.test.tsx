import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatchRun } from './run-reader.js';

const mockExit = vi.fn();

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useApp: () => ({ exit: mockExit }),
    useInput: vi.fn(),
  };
});

vi.mock('./use-run-watcher.js', () => ({
  useRunWatcher: vi.fn(() => ({ runs: [], refresh: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
}));

// Import AFTER mocks
const { default: WatchApp } = await import('./WatchApp.js');
const { useRunWatcher } = await import('./use-run-watcher.js');
const mockUseRunWatcher = vi.mocked(useRunWatcher);

const makeRun = (overrides: Partial<WatchRun> = {}): WatchRun => ({
  runId: 'run-abc123-def456-ghi789',
  betId: 'bet-xyz789',
  betTitle: 'implement user auth',
  cycleId: 'cycle-001',
  status: 'running',
  currentStage: 'plan',
  stageProgress: 0.5,
  pendingGateId: undefined,
  avgConfidence: 0.87,
  avatarState: { stage: 'plan' },
  avatarColor: 'cyan',
  stageSequence: ['research', 'plan'],
  stageDetails: [],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockUseRunWatcher.mockReturnValue({ runs: [], refresh: vi.fn() });
});

describe('WatchApp', () => {
  it('renders without crashing when there are no runs', () => {
    const output = renderToString(<WatchApp runsDir="/fake/runs" />);
    expect(output).toContain('No active runs.');
  });

  it('renders run list when useRunWatcher returns runs', () => {
    mockUseRunWatcher.mockReturnValue({
      runs: [makeRun()],
      refresh: vi.fn(),
    });
    const output = renderToString(<WatchApp runsDir="/fake/runs" />);
    expect(output).toContain('implement user auth');
  });

  it('passes cycleId to useRunWatcher', () => {
    renderToString(<WatchApp runsDir="/fake/runs" cycleId="cycle-42" />);
    expect(mockUseRunWatcher).toHaveBeenCalledWith('/fake/runs', 'cycle-42');
  });

  it('passes runsDir to useRunWatcher', () => {
    renderToString(<WatchApp runsDir="/specific/path" />);
    expect(mockUseRunWatcher).toHaveBeenCalledWith('/specific/path', undefined);
  });

  it('renders KATA WATCH header from GlobalView', () => {
    const output = renderToString(<WatchApp runsDir="/fake/runs" />);
    expect(output).toContain('KATA WATCH');
  });
});
