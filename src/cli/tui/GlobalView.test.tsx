import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { WatchRun } from './run-reader.js';

// Capture useInput handler so we can call it directly in tests
const handlerRef = {
  current: undefined as ((input: string, key: Key) => void) | undefined,
};

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useInput: (handler: (input: string, key: Key) => void) => {
      handlerRef.current = handler;
    },
  };
});

// Import AFTER mock setup
const { default: GlobalView } = await import('./GlobalView.js');

const noKey = (): Key => ({
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
});

const baseRun = (overrides: Partial<WatchRun> = {}): WatchRun => ({
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

const defaultProps = (overrides = {}) => ({
  selectedIndex: 0,
  onSelectChange: vi.fn(),
  onDrillIn: vi.fn(),
  onApprove: vi.fn(),
  onQuit: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('GlobalView rendering', () => {
  it('shows "No active runs." when list is empty', () => {
    const output = renderToString(<GlobalView runs={[]} {...defaultProps()} />);
    expect(output).toContain('No active runs.');
  });

  it('shows KATA WATCH header', () => {
    const output = renderToString(<GlobalView runs={[]} {...defaultProps()} />);
    expect(output).toContain('KATA WATCH');
  });

  it('shows run count — singular', () => {
    const output = renderToString(<GlobalView runs={[baseRun()]} {...defaultProps()} />);
    expect(output).toContain('1 active run');
    expect(output).not.toContain('1 active runs');
  });

  it('shows run count — plural', () => {
    const runs = [baseRun(), { ...baseRun(), runId: 'r2' }];
    const output = renderToString(<GlobalView runs={runs} {...defaultProps()} />);
    expect(output).toContain('2 active runs');
  });

  it('renders bet title (truncated at 32 chars)', () => {
    const output = renderToString(<GlobalView runs={[baseRun()]} {...defaultProps()} />);
    // 'implement user auth' is under 32 chars so full title appears
    expect(output).toContain('implement user auth');
  });

  it('shows pending gate indicator for a run with a pending gate', () => {
    const run = baseRun({ pendingGateId: 'gate-approval-42' });
    const output = renderToString(<GlobalView runs={[run]} {...defaultProps({ plain: true })} />);
    expect(output).toContain('gate pending');
    expect(output).toContain('gate-approval-42');
  });

  it('does not show gate pending when no pending gate', () => {
    const output = renderToString(<GlobalView runs={[baseRun()]} {...defaultProps()} />);
    expect(output).not.toContain('gate pending');
  });

  it('shows selection cursor > on the selected row', () => {
    const runs = [baseRun(), { ...baseRun(), runId: 'r2' }];
    const output = renderToString(<GlobalView runs={runs} selectedIndex={0} {...defaultProps({ selectedIndex: 0 })} />);
    expect(output).toContain('>');
  });

  it('shows keyboard hint footer', () => {
    const output = renderToString(<GlobalView runs={[]} {...defaultProps()} />);
    expect(output).toContain('quit');
    expect(output).toContain('drill in');
  });

  it('shows stage name in uppercase', () => {
    const run = baseRun({ currentStage: 'build' });
    const output = renderToString(<GlobalView runs={[run]} {...defaultProps()} />);
    expect(output).toContain('BUILD');
  });
});

// ── keyboard input ─────────────────────────────────────────────────────────

describe('GlobalView keyboard input', () => {
  it('calls onQuit when q is pressed', () => {
    const props = defaultProps();
    renderToString(<GlobalView runs={[]} {...props} />);
    handlerRef.current?.('q', noKey());
    expect(props.onQuit).toHaveBeenCalled();
  });

  it('calls onDrillIn with selected run when Enter is pressed', () => {
    const run = baseRun();
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={[run]} {...props} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(props.onDrillIn).toHaveBeenCalledWith(run);
  });

  it('does not call onDrillIn when Enter is pressed with empty list', () => {
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={[]} {...props} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(props.onDrillIn).not.toHaveBeenCalled();
  });

  it('calls onApprove when a is pressed and selected run has pending gate', () => {
    const run = baseRun({ pendingGateId: 'gate-99' });
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={[run]} {...props} />);
    handlerRef.current?.('a', noKey());
    expect(props.onApprove).toHaveBeenCalledWith('gate-99');
  });

  it('does not call onApprove when a is pressed but no pending gate', () => {
    const run = baseRun({ pendingGateId: undefined });
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={[run]} {...props} />);
    handlerRef.current?.('a', noKey());
    expect(props.onApprove).not.toHaveBeenCalled();
  });

  it('calls onSelectChange with decremented index on up arrow', () => {
    const runs = [baseRun(), { ...baseRun(), runId: 'r2' }];
    const props = defaultProps({ selectedIndex: 1 });
    renderToString(<GlobalView runs={runs} {...props} />);
    handlerRef.current?.('', { ...noKey(), upArrow: true });
    expect(props.onSelectChange).toHaveBeenCalledWith(0);
  });

  it('clamps up arrow at index 0', () => {
    const runs = [baseRun()];
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={runs} {...props} />);
    handlerRef.current?.('', { ...noKey(), upArrow: true });
    expect(props.onSelectChange).toHaveBeenCalledWith(0);
  });

  it('calls onSelectChange with incremented index on down arrow', () => {
    const runs = [baseRun(), { ...baseRun(), runId: 'r2' }];
    const props = defaultProps({ selectedIndex: 0 });
    renderToString(<GlobalView runs={runs} {...props} />);
    handlerRef.current?.('', { ...noKey(), downArrow: true });
    expect(props.onSelectChange).toHaveBeenCalledWith(1);
  });

  it('clamps down arrow at last index', () => {
    const runs = [baseRun(), { ...baseRun(), runId: 'r2' }];
    const props = defaultProps({ selectedIndex: 1 });
    renderToString(<GlobalView runs={runs} {...props} />);
    handlerRef.current?.('', { ...noKey(), downArrow: true });
    expect(props.onSelectChange).toHaveBeenCalledWith(1);
  });
});
