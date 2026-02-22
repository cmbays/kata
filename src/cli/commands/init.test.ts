import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerInitCommand } from './init.js';

// Mock @inquirer/prompts to avoid interactive prompts in tests
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn().mockResolvedValue('shape-up'),
  confirm: vi.fn().mockResolvedValue(true),
}));

describe('registerInitCommand', () => {
  const baseDir = join(tmpdir(), `kata-init-cmd-test-${Date.now()}`);
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('registers begin command on program', () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    registerInitCommand(program);

    const beginCmd = program.commands.find((c) => c.name() === 'begin');
    expect(beginCmd).toBeDefined();
  });

  it('initializes a project with --skip-prompts', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['node', 'test', 'begin', '--skip-prompts', '--cwd', baseDir]);

    expect(existsSync(join(baseDir, '.kata'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'config.json'))).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith('kata project initialized!');
  });

  it('outputs JSON when --json flag is set', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['node', 'test', '--json', 'begin', '--skip-prompts', '--cwd', baseDir]);

    // Check that JSON output was produced (first console.log call should be JSON)
    const firstCall = consoleSpy.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const parsed = JSON.parse(firstCall as string);
    expect(parsed.kataDir).toBeDefined();
    expect(parsed.config).toBeDefined();
  });

  it('accepts --methodology and --adapter flags', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync([
      'node', 'test', '--json', 'begin',
      '--skip-prompts',
      '--methodology', 'custom',
      '--adapter', 'claude-cli',
      '--cwd', baseDir,
    ]);

    const firstCall = consoleSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(firstCall as string);
    expect(parsed.config.methodology).toBe('custom');
    expect(parsed.config.execution.adapter).toBe('claude-cli');
  });
});
