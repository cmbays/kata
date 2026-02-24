import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProgram } from './program.js';

/**
 * Integration tests — exercise real services + temp directories + Commander.
 * These tests run actual command handlers, not mocks.
 */

function makeProgram() {
  const program = createProgram();
  program.exitOverride(); // throw instead of process.exit
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  return program;
}

describe('Integration: null-state flow', () => {
  let baseDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-integ-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('kata init --skip-prompts initializes project with stages', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('kata project initialized');
    expect(output).toContain('Steps loaded:');
  });

  it('kata stage list shows stage categories after init', async () => {
    // Init first
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    // List stages
    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('research');
  });

  it('kata stage inspect research shows stage category detail', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'research']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('research');
  });

  it('kata step list shows built-in steps after init', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'list']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('research');
  });

  it('kata gyo list (alias) works the same as stage list', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'gyo', 'list']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('research');
  });
});

describe('Integration: cycle flow', () => {
  let baseDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-integ-cycle-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('kata cycle new --skip-prompts creates a cycle', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'cycle', 'new', '--skip-prompts', '-b', '100000', '-n', 'test-cycle',
    ]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Cycle created');
    expect(output).toContain('test-cycle');
  });

  it('kata cycle status shows the created cycle', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);

    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'cycle', 'new', '--skip-prompts', '-b', '50000', '-n', 'my-cycle',
    ]);
    logSpy.mockClear();

    const p3 = makeProgram();
    await p3.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'status']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('my-cycle');
  });

  it('kata keiko status (alias) works the same as cycle status', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);

    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'cycle', 'new', '--skip-prompts', '-b', '50000', '-n', 'alias-test',
    ]);
    logSpy.mockClear();

    const p3 = makeProgram();
    await p3.parseAsync(['node', 'test', '--cwd', baseDir, 'keiko', 'status']);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('alias-test');
  });
});

describe('Integration: error handling', () => {
  let baseDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-integ-err-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('kata stage list without .kata/ shows error and suggests kata init', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list']);

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No .kata/ directory found');
    expect(output).toContain('kata init');
    expect(process.exitCode).toBe(1);
  });

  it('kata stage inspect invalid-category shows error', async () => {
    const p1 = makeProgram();
    await p1.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    errorSpy.mockClear();
    process.exitCode = undefined;

    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'nonexistent']);

    const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Invalid stage category');
    expect(process.exitCode).toBe(1);
  });

  it('kata stage list --verbose without .kata/ shows stack trace', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, '--verbose', 'stage', 'list']);

    const allErrorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(allErrorOutput).toContain('No .kata/ directory found');
    // With verbose, should also print stack trace
    expect(allErrorOutput).toContain('at ');
    expect(process.exitCode).toBe(1);
  });
});
