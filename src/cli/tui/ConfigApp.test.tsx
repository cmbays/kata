import React from 'react';
import { renderToString, Text } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';

const mockExit = vi.fn();

const handlerRef = {
  current: undefined as ((input: string, key: Key) => void) | undefined,
};

vi.mock('ink', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ink')>();
  return {
    ...actual,
    useApp: () => ({ exit: mockExit }),
    useInput: (handler: (input: string, key: Key) => void) => {
      handlerRef.current = handler;
    },
  };
});

// Mock section components using Ink Text to avoid rendering Ink-incompatible elements
vi.mock('./config/StepList.js', () => ({
  default: () => React.createElement(Text, null, 'StepList'),
}));

vi.mock('./config/FlavorList.js', () => ({
  default: () => React.createElement(Text, null, 'FlavorList'),
}));

vi.mock('./config/KataList.js', () => ({
  default: () => React.createElement(Text, null, 'KataList'),
}));

// Import AFTER mock setup
const { default: ConfigApp } = await import('./ConfigApp.js');

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

const defaultProps = {
  stepsDir: '/fake/stages',
  flavorsDir: '/fake/flavors',
  katasDir: '/fake/katas',
};

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('ConfigApp rendering', () => {
  it('shows KATA CONFIG header', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('KATA CONFIG');
  });

  it('shows Methodology Editor subtitle', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('Methodology Editor');
  });

  it('shows all three section tab labels', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('Steps');
    expect(output).toContain('Flavors');
    expect(output).toContain('Katas');
  });

  it('shows quit hint', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('quit');
  });

  it('shows Tab hint', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('Tab');
  });

  it('shows StepList by default (first section active)', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).toContain('StepList');
  });

  it('does not show FlavorList on initial render', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).not.toContain('FlavorList');
  });

  it('does not show KataList on initial render', () => {
    const output = renderToString(<ConfigApp {...defaultProps} />);
    expect(output).not.toContain('KataList');
  });
});

// ── keyboard navigation ────────────────────────────────────────────────────

describe('ConfigApp keyboard navigation', () => {
  it('calls exit on q key', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    handlerRef.current?.('q', noKey());
    expect(mockExit).toHaveBeenCalledOnce();
  });

  it('does not call exit on other keys', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    handlerRef.current?.('a', noKey());
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('does not throw when Tab is pressed', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), tab: true })).not.toThrow();
  });

  it('does not throw when ] is pressed', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    expect(() => handlerRef.current?.(']', noKey())).not.toThrow();
  });

  it('does not throw when [ is pressed', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    expect(() => handlerRef.current?.('[', noKey())).not.toThrow();
  });

  it('calls exit when q is pressed (works from all pages)', () => {
    renderToString(<ConfigApp {...defaultProps} />);
    handlerRef.current?.('q', noKey());
    expect(mockExit).toHaveBeenCalled();
  });
});
