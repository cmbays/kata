import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { KATA_DIRS } from '@shared/constants/paths.js';
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

describe('Integration: observe flow (Wave F)', () => {
  let baseDir: string;
  let runId: string;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  function makeRunDir(): void {
    const runDir = join(baseDir, '.kata', KATA_DIRS.runs, runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'run.json'),
      JSON.stringify({
        id: runId,
        pipelineId: 'pipe-integ-test',
        state: 'running',
        stages: [],
        startedAt: new Date().toISOString(),
      }),
    );
  }

  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-integ-observe-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Init project
    const p = makeProgram();
    await p.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);
    logSpy.mockClear();

    // Create a run directory (no CLI command yet — manual bootstrap)
    runId = randomUUID();
    makeRunDir();
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    logSpy.mockRestore();
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('kata observe record insight records and confirms at run level', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'insight', 'Co-locate tests for faster discovery', '--run', runId,
    ]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('kansatsu recorded');
    expect(output).toContain('[insight]');
    expect(output).toContain('run level');
  });

  it('kata observe record at stage level confirms stage scope', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'outcome', 'Build passed cleanly', '--run', runId, '--stage', 'build',
    ]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('stage level');
  });

  it('kata observe record friction requires --taxonomy and fails clearly without it', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'friction', 'TDD steps feel wrong in research stages', '--run', runId,
    ]);

    const errOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(errOutput).toContain('--taxonomy');
    expect(process.exitCode).toBe(1);
  });

  it('kata observe record gap requires --severity and fails clearly without it', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'gap', 'Missing confidence tracking', '--run', runId,
    ]);

    const errOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(errOutput).toContain('--severity');
    expect(process.exitCode).toBe(1);
  });

  it('kata observe list shows all recorded observations', async () => {
    const p1 = makeProgram();
    await p1.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'insight', 'Parallel sessions reduce conflicts', '--run', runId,
    ]);
    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'decision', 'Use read-only fixtures in build stage', '--run', runId,
    ]);
    logSpy.mockClear();

    const p3 = makeProgram();
    await p3.parseAsync(['node', 'test', '--cwd', baseDir, 'observe', 'list', '--run', runId]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Kansatsu (2)');
    expect(output).toContain('insight');
    expect(output).toContain('decision');
  });

  it('kata observe list --type filters by observation type', async () => {
    const p1 = makeProgram();
    await p1.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'insight', 'An insight', '--run', runId,
    ]);
    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'gap', 'A gap', '--run', runId, '--severity', 'minor',
    ]);
    logSpy.mockClear();

    const p3 = makeProgram();
    await p3.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'list', '--run', runId, '--type', 'gap',
    ]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('A gap');
    expect(output).not.toContain('An insight');
  });

  it('kata observe list --json returns valid JSON array', async () => {
    const p1 = makeProgram();
    await p1.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'insight', 'JSON test', '--run', runId,
    ]);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'list', '--run', runId, '--json',
    ]);

    const rawOutput = logSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(rawOutput);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].type).toBe('insight');
    expect(parsed[0].content).toBe('JSON test');
  });

  it('kata kansatsu list (alias) works the same as observe list', async () => {
    const p1 = makeProgram();
    await p1.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'record', 'insight', 'Alias check', '--run', runId,
    ]);
    logSpy.mockClear();

    const p2 = makeProgram();
    await p2.parseAsync(['node', 'test', '--cwd', baseDir, 'kansatsu', 'list', '--run', runId]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Alias check');
  });

  it('kata observe list for non-existent run ID returns empty gracefully', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'observe', 'list', '--run', randomUUID(),
    ]);

    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No kansatsu found');
    expect(process.exitCode).toBeUndefined(); // not an error — just empty
  });
});

describe('Integration: Wave F init additions', () => {
  let baseDir: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-integ-wf-'));
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    logSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('kata init generates KATA.md in .kata/ directory', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts']);

    const kataMdPath = join(baseDir, '.kata', 'KATA.md');
    expect(existsSync(kataMdPath)).toBe(true);
    const content = readFileSync(kataMdPath, 'utf-8');
    expect(content).toContain('# KATA.md');
    expect(content).toContain('shape-up');
    expect(content).toContain('Active Cycle');
    expect(content).toContain('Kataka Registry');
  });

  it('kata init --json output includes kataMdPath and Wave F config fields', async () => {
    const program = makeProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'init', '--skip-prompts', '--json']);

    const rawOutput = logSpy.mock.calls.map((c) => c[0]).join('');
    const parsed = JSON.parse(rawOutput);
    expect(parsed.kataMdPath).toContain('KATA.md');
    expect(parsed.config.user.experienceLevel).toBe('intermediate');
    expect(parsed.config.cooldown.synthesisDepth).toBe('standard');
  });
});
