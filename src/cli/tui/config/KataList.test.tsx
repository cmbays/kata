import React from 'react';
import { renderToString } from 'ink';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Key } from 'ink';
import type { SavedKata } from '@domain/types/saved-kata.js';

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

const mockJsonList = vi.fn(() => [] as SavedKata[]);

vi.mock('@infra/persistence/json-store.js', () => ({
  JsonStore: {
    list: mockJsonList,
    read: vi.fn(),
    write: vi.fn(),
    exists: vi.fn(() => false),
    ensureDir: vi.fn(),
  },
}));

const { default: KataList } = await import('./KataList.js');

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

const makeKata = (overrides: Partial<SavedKata> = {}): SavedKata => ({
  name: 'full-feature',
  stages: ['research', 'plan', 'build', 'review'],
  ...overrides,
});

const defaultProps = {
  katasDir: '/fake/katas',
  onDetailEnter: vi.fn(),
  onDetailExit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  handlerRef.current = undefined;
  mockJsonList.mockReturnValue([]);
});

// ── rendering ──────────────────────────────────────────────────────────────

describe('KataList rendering', () => {
  it('shows kata count header', () => {
    mockJsonList.mockReturnValue([makeKata(), makeKata({ name: 'quick-fix' })]);
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('Kata Patterns (2)');
  });

  it('shows empty message when no katas', () => {
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('No kata patterns found');
  });

  it('shows kata name', () => {
    mockJsonList.mockReturnValue([makeKata({ name: 'full-feature' })]);
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('full-feature');
  });

  it('shows stage sequence with arrow separator', () => {
    mockJsonList.mockReturnValue([makeKata({ stages: ['research', 'plan', 'build'] })]);
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('research → plan → build');
  });

  it('shows keyboard hint footer', () => {
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('switch section');
  });

  it('shows selection cursor when katas exist', () => {
    mockJsonList.mockReturnValue([makeKata()]);
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('>');
  });
});

// ── detail view ────────────────────────────────────────────────────────────

describe('KataList detail view', () => {
  it('calls onDetailEnter when Enter pressed on a kata', () => {
    const onDetailEnter = vi.fn();
    mockJsonList.mockReturnValue([makeKata()]);
    renderToString(<KataList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).toHaveBeenCalledOnce();
  });

  it('does not call onDetailEnter when list is empty', () => {
    const onDetailEnter = vi.fn();
    renderToString(<KataList {...defaultProps} onDetailEnter={onDetailEnter} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(onDetailEnter).not.toHaveBeenCalled();
  });

  it('does not throw when Esc pressed after Enter', () => {
    // renderToString is a static snapshot — state changes don't re-render
    // so we verify the handler doesn't throw rather than asserting on the callback
    mockJsonList.mockReturnValue([makeKata()]);
    renderToString(<KataList {...defaultProps} />);
    handlerRef.current?.('', { ...noKey(), return: true });
    expect(() => handlerRef.current?.('', { ...noKey(), escape: true })).not.toThrow();
  });
});

// ── keyboard navigation ────────────────────────────────────────────────────

describe('KataList keyboard navigation', () => {
  it('does not throw on up arrow at index 0', () => {
    mockJsonList.mockReturnValue([makeKata()]);
    renderToString(<KataList {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), upArrow: true })).not.toThrow();
  });

  it('does not throw on down arrow at last item', () => {
    mockJsonList.mockReturnValue([makeKata()]);
    renderToString(<KataList {...defaultProps} />);
    expect(() => handlerRef.current?.('', { ...noKey(), downArrow: true })).not.toThrow();
  });
});

// ── action keys ────────────────────────────────────────────────────────────

describe('KataList action keys', () => {
  it('calls onAction kata:create when n is pressed', () => {
    const onAction = vi.fn();
    renderToString(<KataList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('n', noKey());
    expect(onAction).toHaveBeenCalledWith({ type: 'kata:create' });
  });

  it('calls onAction kata:delete with selected kata when d is pressed', () => {
    const onAction = vi.fn();
    const kata = makeKata({ name: 'my-kata' });
    mockJsonList.mockReturnValue([kata]);
    renderToString(<KataList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('d', noKey());
    expect(onAction).toHaveBeenCalledWith({ type: 'kata:delete', kata });
  });

  it('does not call onAction on d when list is empty', () => {
    const onAction = vi.fn();
    renderToString(<KataList {...defaultProps} onAction={onAction} />);
    handlerRef.current?.('d', noKey());
    expect(onAction).not.toHaveBeenCalled();
  });
});

// ── error handling ─────────────────────────────────────────────────────────

describe('KataList error handling', () => {
  it('shows empty list when JsonStore.list throws', () => {
    mockJsonList.mockImplementation(() => {
      throw new Error('disk error');
    });
    const output = renderToString(<KataList {...defaultProps} />);
    expect(output).toContain('No kata patterns found');
  });
});
