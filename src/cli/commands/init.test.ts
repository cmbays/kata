import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
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

  it('registers init command on program', () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    registerInitCommand(program);

    const initCmd = program.commands.find((c) => c.name() === 'init');
    expect(initCmd).toBeDefined();
  });

  it('initializes a project with --skip-prompts', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['node', 'test', 'init', '--skip-prompts', '--cwd', baseDir]);

    expect(existsSync(join(baseDir, '.kata'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'config.json'))).toBe(true);
    // Check that the "What's next?" guidance was printed
    const allOutput = consoleSpy.mock.calls.flat().join('\n');
    expect(allOutput).toMatch(/kata initialized|kata project initialized/);
    expect(allOutput).toMatch(/What's next/);
    expect(allOutput).toMatch(/kata kiai build/);
    expect(allOutput).toContain('Project type:     Generic');
  });

  it('displays project name in header when package.json is present', async () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['node', 'test', 'init', '--skip-prompts', '--cwd', baseDir]);

    const allOutput = consoleSpy.mock.calls.flat().join('\n');
    expect(allOutput).toContain('kata initialized for my-app');
  });

  it('outputs JSON when --json flag is set', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync(['node', 'test', '--json', 'init', '--skip-prompts', '--cwd', baseDir]);

    // Check that JSON output was produced (first console.log call should be JSON)
    const firstCall = consoleSpy.mock.calls[0]?.[0];
    expect(firstCall).toBeDefined();
    const parsed = JSON.parse(firstCall as string);
    expect(parsed.kataDir).toBeDefined();
    expect(parsed.config).toBeDefined();
    expect(parsed.projectType).toBeDefined();
  });

  it('accepts --methodology and --adapter flags', async () => {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerInitCommand(program);

    await program.parseAsync([
      'node', 'test', '--json', 'init',
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

  // ---- --scan mode ----

  describe('--scan basic', () => {
    function createScanProgram(): Command {
      const program = new Command();
      program.option('--json').option('--verbose').option('--cwd <path>');
      program.exitOverride();
      registerInitCommand(program);
      return program;
    }

    it('outputs basic scan JSON without creating .kata/', async () => {
      const program = createScanProgram();
      await program.parseAsync(['node', 'test', 'init', '--scan', 'basic', '--cwd', baseDir]);

      expect(existsSync(join(baseDir, '.kata'))).toBe(false);
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.scanDepth).toBe('basic');
      expect(parsed.projectType).toBeDefined();
      expect(parsed.devTooling).toBeDefined();
      expect(parsed.claudeAssets).toBeDefined();
      expect(parsed.ci).toBeDefined();
      expect(parsed.manifests).toBeDefined();
    });

    it('detects node project type from package.json', async () => {
      writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'scan-test-app' }));
      const program = createScanProgram();
      await program.parseAsync(['node', 'test', 'init', '--scan', 'basic', '--cwd', baseDir]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.projectType).toBe('node');
      expect(parsed.packageName).toBe('scan-test-app');
    });

    it('outputs full scan JSON with gitInsights and frameworkGaps', async () => {
      const program = createScanProgram();
      await program.parseAsync(['node', 'test', 'init', '--scan', 'full', '--cwd', baseDir]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.scanDepth).toBe('full');
      expect(Array.isArray(parsed.frameworkGaps)).toBe(true);
    });

    it('errors on invalid scan depth', async () => {
      const program = createScanProgram();
      await program.parseAsync(['node', 'test', 'init', '--scan', 'invalid', '--cwd', baseDir]);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
