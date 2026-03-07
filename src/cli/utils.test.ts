import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveKataDir, getGlobalOptions, handleCommandError, kataDirPath, withCommandContext } from './utils.js';
import type { CommandContext } from './utils.js';
import { ConfigNotFoundError } from '@shared/lib/errors.js';
import { Command } from 'commander';

describe('resolveKataDir', () => {
  const testDir = join(tmpdir(), `kata-utils-test-${Date.now()}`);
  const kataDir = join(testDir, '.kata');

  beforeEach(() => {
    mkdirSync(kataDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('returns .kata dir path when it exists', () => {
    const result = resolveKataDir(testDir);
    expect(result).toBe(kataDir);
  });

  it('throws ConfigNotFoundError when .kata dir does not exist', () => {
    const noKataDir = join(tmpdir(), `kata-no-kata-${Date.now()}`);
    mkdirSync(noKataDir, { recursive: true });
    try {
      expect(() => resolveKataDir(noKataDir)).toThrow(ConfigNotFoundError);
    } finally {
      rmSync(noKataDir, { recursive: true, force: true });
    }
  });

  describe('KATA_DIR env var', () => {
    const savedEnv = process.env['KATA_DIR'];

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env['KATA_DIR'];
      } else {
        process.env['KATA_DIR'] = savedEnv;
      }
    });

    it('uses KATA_DIR env var when set and directory exists', () => {
      process.env['KATA_DIR'] = kataDir;
      const result = resolveKataDir('/some/other/path');
      expect(result).toBe(kataDir);
    });

    it('throws ConfigNotFoundError when KATA_DIR points to a non-existent path', () => {
      process.env['KATA_DIR'] = '/nonexistent/.kata';
      expect(() => resolveKataDir()).toThrow(ConfigNotFoundError);
    });

    it('KATA_DIR takes precedence over cwd', () => {
      // kataDir exists; /some/other/path does not have .kata
      process.env['KATA_DIR'] = kataDir;
      const result = resolveKataDir('/tmp');
      expect(result).toBe(kataDir);
    });
  });

  describe('git worktree auto-detection', () => {
    let mainRepoDir: string;
    let mainKataDir: string;
    let worktreeDir: string;

    beforeEach(() => {
      const base = join(tmpdir(), `kata-worktree-test-${Date.now()}`);
      // Main repo: has .git/ dir and .kata/
      mainRepoDir = join(base, 'main');
      mainKataDir = join(mainRepoDir, '.kata');
      mkdirSync(join(mainRepoDir, '.git'), { recursive: true });
      mkdirSync(mainKataDir, { recursive: true });

      // Worktree dir: has a .git FILE pointing to main/.git/worktrees/wt1
      worktreeDir = join(base, 'worktree');
      mkdirSync(worktreeDir, { recursive: true });
      const worktreesDir = join(mainRepoDir, '.git', 'worktrees', 'wt1');
      mkdirSync(worktreesDir, { recursive: true });
      writeFileSync(join(worktreeDir, '.git'), `gitdir: ${worktreesDir}`);
    });

    afterEach(() => {
      // Clean up via the worktree dir's parent (the base temp dir)
      const parent = join(worktreeDir, '..');
      try { rmSync(parent, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('resolves .kata/ from main repo when cwd is a linked worktree', () => {
      const result = resolveKataDir(worktreeDir);
      expect(result).toBe(mainKataDir);
    });

    it('does NOT auto-resolve when cwd is the main worktree (has .git directory)', () => {
      // The main repo has .kata/ — direct resolution should succeed normally
      const result = resolveKataDir(mainRepoDir);
      expect(result).toBe(mainKataDir);
    });

    it('throws ConfigNotFoundError when worktree points to a main repo with no .kata/', () => {
      // Remove .kata/ from main repo
      rmSync(mainKataDir, { recursive: true, force: true });
      expect(() => resolveKataDir(worktreeDir)).toThrow(ConfigNotFoundError);
    });

    it('throws ConfigNotFoundError when .git file content is malformed', () => {
      // Overwrite .git file with garbage
      writeFileSync(join(worktreeDir, '.git'), 'not-a-gitdir-line');
      expect(() => resolveKataDir(worktreeDir)).toThrow(ConfigNotFoundError);
    });
  });
});

describe('getGlobalOptions', () => {
  it('extracts json, verbose, and cwd from command options', () => {
    const program = new Command();
    program
      .option('--json', 'JSON output')
      .option('--verbose', 'Verbose output')
      .option('--cwd <path>', 'Working directory');

    program.parse(['node', 'test', '--json', '--verbose', '--cwd', '/some/path']);

    const opts = getGlobalOptions(program);
    expect(opts.json).toBe(true);
    expect(opts.verbose).toBe(true);
    expect(opts.cwd).toBe('/some/path');
  });

  it('defaults json and verbose to false when not set', () => {
    const program = new Command();
    program
      .option('--json', 'JSON output')
      .option('--verbose', 'Verbose output')
      .option('--cwd <path>', 'Working directory');

    program.parse(['node', 'test']);

    const opts = getGlobalOptions(program);
    expect(opts.json).toBe(false);
    expect(opts.verbose).toBe(false);
    expect(opts.cwd).toBeUndefined();
  });
});

describe('kataDirPath', () => {
  it('joins kataDir with the named subdirectory', () => {
    expect(kataDirPath('/project/.kata', 'stages')).toBe(join('/project/.kata', 'stages'));
    expect(kataDirPath('/project/.kata', 'pipelines')).toBe(join('/project/.kata', 'pipelines'));
    expect(kataDirPath('/project/.kata', 'config')).toBe(join('/project/.kata', 'config.json'));
  });
});

describe('handleCommandError', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  it('prints error message for Error instances', () => {
    handleCommandError(new Error('something broke'), false);
    expect(errorSpy).toHaveBeenCalledWith('Error: something broke');
    expect(process.exitCode).toBe(1);
  });

  it('prints string for non-Error values', () => {
    handleCommandError('raw string error', false);
    expect(errorSpy).toHaveBeenCalledWith('Error: raw string error');
    expect(process.exitCode).toBe(1);
  });

  it('does not print stack trace when verbose is false', () => {
    const err = new Error('fail');
    handleCommandError(err, false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('prints stack trace when verbose is true', () => {
    const err = new Error('fail with stack');
    handleCommandError(err, true);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Error: fail with stack'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('at '));
  });

  it('does not print stack trace for non-Error values even when verbose is true', () => {
    handleCommandError(42, true);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: 42');
  });
});

describe('withCommandContext', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `kata-ctx-test-${Date.now()}`);
    mkdirSync(join(testDir, '.kata'), { recursive: true });
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    errorSpy.mockRestore();
    process.exitCode = undefined;
  });

  function makeCmd(cwd: string): Command {
    const program = new Command();
    program
      .option('--json', 'JSON output')
      .option('--verbose', 'Verbose output')
      .option('--cwd <path>', 'Working directory');
    program.parse(['node', 'test', '--cwd', cwd]);
    return program;
  }

  it('provides globalOpts and kataDir to handler', async () => {
    let captured: CommandContext | undefined;
    const handler = withCommandContext(async (ctx) => { captured = ctx; });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler(localOpts, cmd);

    expect(captured).toBeDefined();
    expect(captured!.kataDir).toBe(join(testDir, '.kata'));
    expect(captured!.globalOpts.json).toBe(false);
  });

  it('forwards positional arguments', async () => {
    const args: unknown[] = [];
    const handler = withCommandContext(async (ctx, ...rest) => { args.push(...rest); });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler('my-type', localOpts, cmd);

    expect(args).toEqual(['my-type']);
  });

  it('catches errors and calls handleCommandError', async () => {
    const handler = withCommandContext(async () => { throw new Error('handler error'); });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler(localOpts, cmd);

    expect(errorSpy).toHaveBeenCalledWith('Error: handler error');
    expect(process.exitCode).toBe(1);
  });

  it('prints error exactly once (no duplicate from unhandled rejection)', async () => {
    const handler = withCommandContext(async () => { throw new Error('single error'); });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler(localOpts, cmd);

    // Only one console.error call for the error message (not verbose, so no stack trace)
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith('Error: single error');
  });

  it('does not reject the returned promise on handler error', async () => {
    const handler = withCommandContext(async () => { throw new Error('should not reject'); });

    const cmd = makeCmd(testDir);
    const localOpts = {};

    // The wrapper must resolve (not reject) so Commander's parse() doesn't
    // see a rejection that would duplicate the error output.
    await expect(handler(localOpts, cmd)).resolves.toBeUndefined();
    expect(process.exitCode).toBe(1);
  });

  it('skips kataDir resolution when needsKataDir is false', async () => {
    let captured: CommandContext | undefined;
    const handler = withCommandContext(
      async (ctx) => { captured = ctx; },
      { needsKataDir: false },
    );

    // Use a directory without .kata — should not throw
    const noKataDir = join(tmpdir(), `kata-no-dir-${Date.now()}`);
    mkdirSync(noKataDir, { recursive: true });
    const cmd = makeCmd(noKataDir);
    const localOpts = {};
    await handler(localOpts, cmd);
    rmSync(noKataDir, { recursive: true, force: true });

    expect(captured).toBeDefined();
    expect(captured!.kataDir).toBe('');
  });

  it('handles sync handlers', async () => {
    let called = false;
    const handler = withCommandContext((_ctx) => { called = true; });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler(localOpts, cmd);

    expect(called).toBe(true);
  });

  // Issue #228 — loadConfigOutputMode should warn on malformed config.json
  it('emits a logger warn and falls back when config.json is malformed', async () => {
    // Write a malformed config.json
    writeFileSync(join(testDir, '.kata', 'config.json'), 'not-valid-json{{{');

    let captured: CommandContext | undefined;
    const handler = withCommandContext(async (ctx) => { captured = ctx; });

    const cmd = makeCmd(testDir);
    const localOpts = {};

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await handler(localOpts, cmd);
    warnSpy.mockRestore();

    // Command should still succeed (falls back to default)
    expect(captured).toBeDefined();
    // plain should remain false (default fallback)
    expect(captured!.globalOpts.plain).toBe(false);
  });

  it('reads outputMode from valid config.json when set to plain', async () => {
    writeFileSync(
      join(testDir, '.kata', 'config.json'),
      JSON.stringify({
        methodology: 'shape-up',
        execution: { adapter: 'manual', config: {}, confidenceThreshold: 0.7 },
        customStagePaths: [],
        outputMode: 'plain',
        project: {},
      }),
    );

    let captured: CommandContext | undefined;
    const handler = withCommandContext(async (ctx) => { captured = ctx; });

    const cmd = makeCmd(testDir);
    const localOpts = {};
    await handler(localOpts, cmd);

    expect(captured!.globalOpts.plain).toBe(true);
  });
});
