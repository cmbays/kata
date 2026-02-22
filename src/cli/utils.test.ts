import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolveKataDir, getGlobalOptions, handleCommandError } from './utils.js';
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
