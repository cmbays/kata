import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { WatchRun, WatchStageDetail } from './run-reader.js';

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
const { default: DetailView } = await import('./DetailView.js');

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

const makeStageDetail = (overrides: Partial<WatchStageDetail> = {}): WatchStageDetail => ({
  category: 'research',
  status: 'completed',
  flavorCount: 2,
  artifactCount: 3,
  decisionCount: 4,
  avgConfidence: 0.87,
  pendingGateId: undefined,
  ...overrides,
});

const makeRun = (overrides: Partial<WatchRun> = {}): WatchRun => ({
  runId: 'run-abc123-def456',
  betId: 'bet-xyz789',
  betTitle: 'implement user authentication',
  cycleId: 'cycle-001',
  status: 'running',
  currentStage: 'plan',
  stageProgress: 0.5,
  pendingGateId: undefined,
  avgConfidence: 0.87,
  avatarState: { stage: 'plan' },
  avatarColor: 'cyan',
  stageSequence: ['research', 'plan'],
  stageDetails: [
    makeStageDetail({ category: 'research', status: 'completed' }),
    makeStageDetail({ category: 'plan', status: 'running', avgConfidence: 0.75 }),
  ],
  ...overrides,
});

const defaultProps = (overrides = {}) => ({
  onBack: vi.fn(),
  onApprove: vi.fn(),
  onQuit: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('DetailView rendering', () => {
  it('shows "Run not found." when run is undefined', () => {
    const output = renderToString(<DetailView run={undefined} {...defaultProps()} />);
    expect(output).toContain('Run not found.');
  });

  it('shows the bet title', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('implement user authentication');
  });

  it('shows the run ID (short form)', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('run-abc1');
  });

  it('shows stage categories in uppercase', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('RESEARCH');
    expect(output).toContain('PLAN');
  });

  it('shows ✓ for completed stages', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('✓');
  });

  it('shows ● for running stages', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('●');
  });

  it('shows ✗ for failed stages', () => {
    const run = makeRun({ stageDetails: [makeStageDetail({ status: 'failed' })] });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).toContain('✗');
  });

  it('shows ○ for pending stages', () => {
    const run = makeRun({ stageDetails: [makeStageDetail({ status: 'pending' })] });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).toContain('○');
  });

  it('shows flavor count', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('2 flavors');
  });

  it('shows singular flavor when count is 1', () => {
    const run = makeRun({ stageDetails: [makeStageDetail({ flavorCount: 1 })] });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).toContain('1 flavor');
    expect(output).not.toContain('1 flavors');
  });

  it('shows artifact count', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('3 artifacts');
  });

  it('shows decision count', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('4 decisions');
  });

  it('shows avg confidence when present', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('0.87');
  });

  it('omits confidence when undefined', () => {
    const run = makeRun({ stageDetails: [makeStageDetail({ avgConfidence: undefined })] });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).not.toMatch(/\(0\.\d+\)/);
  });

  it('shows per-stage pending gate id', () => {
    const run = makeRun({
      stageDetails: [makeStageDetail({ pendingGateId: 'gate-stage-99' })],
    });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).toContain('gate-stage-99');
  });

  it('shows run-level pending gate banner', () => {
    const run = makeRun({ pendingGateId: 'gate-run-level' });
    const output = renderToString(<DetailView run={run} {...defaultProps()} />);
    expect(output).toContain('Gate pending: gate-run-level');
  });

  it('shows keyboard hint footer', () => {
    const output = renderToString(<DetailView run={makeRun()} {...defaultProps()} />);
    expect(output).toContain('back');
    expect(output).toContain('quit');
  });
});

// ── keyboard input ─────────────────────────────────────────────────────────

describe('DetailView keyboard input', () => {
  it('calls onQuit when q is pressed', () => {
    const props = defaultProps();
    renderToString(<DetailView run={makeRun()} {...props} />);
    handlerRef.current?.('q', noKey());
    expect(props.onQuit).toHaveBeenCalled();
  });

  it('calls onBack when left arrow is pressed', () => {
    const props = defaultProps();
    renderToString(<DetailView run={makeRun()} {...props} />);
    handlerRef.current?.('', { ...noKey(), leftArrow: true });
    expect(props.onBack).toHaveBeenCalled();
  });

  it('calls onApprove when a is pressed and run has pending gate', () => {
    const run = makeRun({ pendingGateId: 'gate-approve-77' });
    const props = defaultProps();
    renderToString(<DetailView run={run} {...props} />);
    handlerRef.current?.('a', noKey());
    expect(props.onApprove).toHaveBeenCalledWith('gate-approve-77');
  });

  it('does not call onApprove when a is pressed but no pending gate', () => {
    const run = makeRun({ pendingGateId: undefined });
    const props = defaultProps();
    renderToString(<DetailView run={run} {...props} />);
    handlerRef.current?.('a', noKey());
    expect(props.onApprove).not.toHaveBeenCalled();
  });

  it('does not call onApprove when run is undefined and a is pressed', () => {
    const props = defaultProps();
    renderToString(<DetailView run={undefined} {...props} />);
    handlerRef.current?.('a', noKey());
    expect(props.onApprove).not.toHaveBeenCalled();
  });
});
