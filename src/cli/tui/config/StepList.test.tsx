import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { Step } from '@domain/types/step.js';

// Capture useInput handler for keyboard simulation
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

// Module-level spy so class method can reference it across tests
const mockList = vi.fn((): Step[] => []);

vi.mock('@infra/registries/step-registry.js', () => ({
  StepRegistry: class MockStepRegistry {
    list() {
      return mockList();
    }
  },
}));

// Import AFTER mocks
const { default: StepList } = await import('./StepList.js');

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

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  type: 'research',
  artifacts: [],
  learningHooks: [],
  config: {},
  ...overrides,
});

const defaultProps = {
  stepsDir: '/fake/stages',
  onDetailEnter: vi.fn(),
  onDetailExit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
  mockList.mockReturnValue([]);
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('StepList rendering', () => {
  it('shows step count when steps exist', () => {
    mockList.mockReturnValue([makeStep(), makeStep({ type: 'build' })]);
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('Steps (2)');
  });

  it('shows zero count when no steps', () => {
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('Steps (0)');
  });

  it('shows empty message when list is empty', () => {
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('No steps found');
  });

  it('shows step type label', () => {
    mockList.mockReturnValue([makeStep({ type: 'shape' })]);
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('shape');
  });

  it('shows flavored step as type.flavor', () => {
    mockList.mockReturnValue([makeStep({ type: 'build', flavor: 'tdd' })]);
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('build.tdd');
  });

  it('shows stage category', () => {
    mockList.mockReturnValue([makeStep({ stageCategory: 'plan' })]);
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('plan');
  });

  it('shows step description', () => {
    mockList.mockReturnValue([makeStep({ description: 'Core shaping step' })]);
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('Core shaping step');
  });

  it('shows keyboard hint footer', () => {
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('switch section');
  });
});

// ── keyboard navigation ────────────────────────────────────────────────────

describe('StepList keyboard navigation', () => {
  it('calls onDetailEnter when Enter pressed on a non-empty step list', () => {
    const onDetailEnter = vi.fn();
    mockList.mockReturnValue([makeStep()]);
    renderToString(<StepList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).toHaveBeenCalledOnce();
  });

  it('does not call onDetailEnter when list is empty', () => {
    const onDetailEnter = vi.fn();
    renderToString(<StepList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).not.toHaveBeenCalled();
  });

  it('does not throw when Esc pressed after Enter', () => {
    // renderToString is a static snapshot — state changes don't re-render
    // so we verify the handler doesn't throw rather than asserting on the callback
    mockList.mockReturnValue([makeStep()]);
    renderToString(<StepList {...defaultProps} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(() => handlerRef.current?.('', { ...noKey(), escape: true })).not.toThrow();
  });

  it('does not throw on up arrow at index 0', () => {
    mockList.mockReturnValue([makeStep(), makeStep({ type: 'build' })]);
    renderToString(<StepList {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), upArrow: true })).not.toThrow();
  });

  it('does not throw on down arrow at last item', () => {
    mockList.mockReturnValue([makeStep()]);
    renderToString(<StepList {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), downArrow: true })).not.toThrow();
  });
});

// ── error handling ─────────────────────────────────────────────────────────

describe('StepList error handling', () => {
  it('shows empty list when registry throws', () => {
    mockList.mockImplementation(() => {
      throw new Error('disk error');
    });
    const output = renderToString(<StepList {...defaultProps} />);
    expect(output).toContain('No steps found');
  });
});
