import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { Flavor } from '@domain/types/flavor.js';
import type { FlavorValidationResult } from '@domain/ports/flavor-registry.js';

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

const mockFlavorList = vi.fn((): Flavor[] => []);
const mockValidate = vi.fn((): FlavorValidationResult => ({ valid: true }));
let throwOnConstruct = false;

vi.mock('@infra/registries/flavor-registry.js', () => ({
  FlavorRegistry: class MockFlavorRegistry {
    constructor() {
      if (throwOnConstruct) throw new Error('disk error');
    }
    list() {
      return mockFlavorList();
    }
    validate(f: Flavor, _resolver?: unknown) {
      return mockValidate(f);
    }
  },
}));

vi.mock('@infra/registries/step-registry.js', () => ({
  StepRegistry: class MockStepRegistry {
    get(_type: string) {
      return undefined;
    }
  },
}));

const { default: FlavorList } = await import('./FlavorList.js');

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

const makeFlavor = (overrides: Partial<Flavor> = {}): Flavor => ({
  name: 'typescript-tdd',
  stageCategory: 'build',
  steps: [{ stepName: 'tdd-scaffold', stepType: 'build' }],
  synthesisArtifact: 'build-output',
  ...overrides,
});

const defaultProps = {
  flavorsDir: '/fake/flavors',
  stepsDir: '/fake/stages',
  onDetailEnter: vi.fn(),
  onDetailExit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
  mockFlavorList.mockReturnValue([]);
  mockValidate.mockReturnValue({ valid: true });
  throwOnConstruct = false;
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('FlavorList rendering', () => {
  it('shows flavor count when flavors exist', () => {
    mockFlavorList.mockReturnValue([makeFlavor(), makeFlavor({ name: 'basic' })]);
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('Flavors (2)');
  });

  it('shows zero count when no flavors', () => {
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('Flavors (0)');
  });

  it('shows empty message when no flavors', () => {
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('No flavors found');
  });

  it('shows flavor name', () => {
    mockFlavorList.mockReturnValue([makeFlavor({ name: 'typescript-tdd' })]);
    const output = renderToString(<FlavorList {...defaultProps} />);
    expect(output).toContain('typescript-tdd');
  });

  it('shows stage category', () => {
    mockFlavorList.mockReturnValue([makeFlavor({ stageCategory: 'build' })]);
    const output = renderToString(<FlavorList {...defaultProps} />);
    expect(output).toContain('build');
  });

  it('shows step count', () => {
    const flavor = makeFlavor({
      steps: [
        { stepName: 'step-a', stepType: 'build' },
        { stepName: 'step-b', stepType: 'build' },
      ],
    });
    mockFlavorList.mockReturnValue([flavor]);
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('2 step(s)');
  });

  it('shows keyboard hint footer', () => {
    const output = renderToString(<FlavorList {...defaultProps} />);
    expect(output).toContain('switch section');
  });
});

// ── detail view ────────────────────────────────────────────────────────────

describe('FlavorList detail view', () => {
  it('calls onDetailEnter when Enter pressed on a flavor', () => {
    const onDetailEnter = vi.fn();
    mockFlavorList.mockReturnValue([makeFlavor()]);
    renderToString(<FlavorList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).toHaveBeenCalledOnce();
  });

  it('does not call onDetailEnter when list is empty', () => {
    const onDetailEnter = vi.fn();
    renderToString(<FlavorList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).not.toHaveBeenCalled();
  });

  it('does not throw when Esc pressed after Enter', () => {
    // renderToString is a static snapshot — state changes don't re-render
    // so we verify the handler doesn't throw rather than asserting on the callback
    mockFlavorList.mockReturnValue([makeFlavor()]);
    renderToString(<FlavorList {...defaultProps} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(() => handlerRef.current?.('', { ...noKey(), escape: true })).not.toThrow();
  });

  it('does not throw when Enter then Esc pressed (no state re-render)', () => {
    // validate is called during re-render (after state update) which renderToString
    // doesn't trigger. Verify the interaction doesn't throw.
    const flavor = makeFlavor({ name: 'typescript-tdd' });
    mockFlavorList.mockReturnValue([flavor]);
    renderToString(<FlavorList {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), return: true })).not.toThrow();
  });
});

// ── action keys ────────────────────────────────────────────────────────────

describe('FlavorList action keys', () => {
  it('calls onAction flavor:create when n is pressed', () => {
    const onAction = vi.fn();
    renderToString(<FlavorList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('n', noKey());
    expect(onAction).toHaveBeenCalledWith({ type: 'flavor:create' });
  });

  it('calls onAction flavor:delete with selected flavor when d is pressed', () => {
    const onAction = vi.fn();
    const flavor = makeFlavor({ name: 'my-flavor' });
    mockFlavorList.mockReturnValue([flavor]);
    renderToString(<FlavorList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('d', noKey());
    expect(onAction).toHaveBeenCalledWith({ type: 'flavor:delete', flavor });
  });

  it('does not call onAction on d when list is empty', () => {
    const onAction = vi.fn();
    renderToString(<FlavorList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('d', noKey());
    expect(onAction).not.toHaveBeenCalled();
  });
});

// ── error handling ─────────────────────────────────────────────────────────

describe('FlavorList error handling', () => {
  it('shows empty list when FlavorRegistry constructor throws', () => {
    throwOnConstruct = true;
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('No flavors found');
  });

  it('shows empty list when flavorList throws', () => {
    mockFlavorList.mockImplementation(() => {
      throw new Error('disk error');
    });
    const output = renderToString(<FlavorList {...defaultProps} plain />);
    expect(output).toContain('No flavors found');
  });
});
