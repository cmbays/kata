import React from 'react';
import { renderToString, Text } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const mockExit = vi.fn();

// Capture the onApprove callback passed to GlobalView so tests can invoke it directly
let capturedOnApprove: ((gateId: string) => void) | undefined;

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

vi.mock('./GlobalView.js', () => ({
  default: ({ onApprove }: { onApprove: (id: string) => void }) => {
    capturedOnApprove = onApprove;
    return React.createElement(Text, null, 'GlobalView');
  },
}));

// spawn mock returns a controllable EventEmitter child process
const makeChild = () => Object.assign(new EventEmitter(), { stdio: [null, null, null] });
const mockSpawn = vi.fn(() => makeChild());

vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// Import AFTER mocks
const { default: WatchApp } = await import('./WatchApp.js');
const { useRunWatcher } = await import('./use-run-watcher.js');
const mockUseRunWatcher = vi.mocked(useRunWatcher);


beforeEach(() => {
  vi.clearAllMocks();
  capturedOnApprove = undefined;
  mockUseRunWatcher.mockReturnValue({ runs: [], refresh: vi.fn() });
  mockSpawn.mockReturnValue(makeChild());
});

describe('WatchApp rendering', () => {
  it('renders GlobalView by default', () => {
    const output = renderToString(<WatchApp runsDir="/fake/runs" />);
    expect(output).toContain('GlobalView');
  });

  it('passes cycleId to useRunWatcher', () => {
    renderToString(<WatchApp runsDir="/fake/runs" cycleId="cycle-42" />);
    expect(mockUseRunWatcher).toHaveBeenCalledWith('/fake/runs', 'cycle-42');
  });

  it('passes runsDir to useRunWatcher', () => {
    renderToString(<WatchApp runsDir="/specific/path" />);
    expect(mockUseRunWatcher).toHaveBeenCalledWith('/specific/path', undefined);
  });
});

describe('WatchApp approveGate', () => {
  it('spawns kata approve with the correct gateId', () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    renderToString(<WatchApp runsDir="/fake/runs" />);

    capturedOnApprove?.('gate-abc-123');

    expect(mockSpawn).toHaveBeenCalledWith('kata', ['approve', 'gate-abc-123'], { stdio: 'ignore' });
  });

  it('calls refresh after successful approval (exit code 0)', () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const refresh = vi.fn();
    mockUseRunWatcher.mockReturnValue({ runs: [], refresh });
    renderToString(<WatchApp runsDir="/fake/runs" />);

    capturedOnApprove?.('gate-success');
    child.emit('close', 0);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not call refresh when approval fails (non-zero exit)', () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const refresh = vi.fn();
    mockUseRunWatcher.mockReturnValue({ runs: [], refresh });
    renderToString(<WatchApp runsDir="/fake/runs" />);

    capturedOnApprove?.('gate-fail');
    child.emit('close', 1);

    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not call refresh when spawn errors (e.g. kata not on PATH)', () => {
    const child = makeChild();
    mockSpawn.mockReturnValue(child);
    const refresh = vi.fn();
    mockUseRunWatcher.mockReturnValue({ runs: [], refresh });
    renderToString(<WatchApp runsDir="/fake/runs" />);

    capturedOnApprove?.('gate-enoent');
    child.emit('error', new Error('ENOENT'));

    expect(refresh).not.toHaveBeenCalled();
  });
});
