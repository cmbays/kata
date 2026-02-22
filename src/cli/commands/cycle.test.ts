import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { registerCycleCommands } from './cycle.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
}));

describe('registerCycleCommands', () => {
  const baseDir = join(tmpdir(), `kata-cycle-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const cyclesDir = join(kataDir, 'cycles');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerCycleCommands(program);
    return program;
  }

  describe('enbu new', () => {
    it('creates a cycle with --skip-prompts', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'enbu', 'new',
        '--skip-prompts',
        '--budget', '50000',
        '--time', '2 weeks',
        '--name', 'Sprint 1',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Enbu created!');
      const outputCalls = consoleSpy.mock.calls.map((c) => c[0]);
      const statusOutput = outputCalls.find((c) => typeof c === 'string' && c.includes('Sprint 1'));
      expect(statusOutput).toBeDefined();
    });

    it('creates a cycle with JSON output', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'enbu', 'new',
        '--skip-prompts',
        '--budget', '100000',
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.status).toBeDefined();
      expect(parsed.cycle).toBeDefined();
    });
  });

  describe('enbu status', () => {
    it('shows all cycles when no id given', async () => {
      // Create a cycle first
      const manager = new CycleManager(cyclesDir);
      manager.create({ tokenBudget: 50000 }, 'Test Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'enbu', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test Cycle');
    });

    it('shows specific cycle by id', async () => {
      const manager = new CycleManager(cyclesDir);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Specific Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'enbu', 'status', cycle.id]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Specific Cycle');
    });

    it('shows message when no cycles exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'enbu', 'status']);

      expect(consoleSpy).toHaveBeenCalledWith('No enbu found. Run "kata enbu new" to create one.');
    });

    it('shows error for missing cycle id', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'enbu', 'status', 'nonexistent-id']);

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('enbu focus', () => {
    it('adds a bet to a cycle with --skip-prompts', async () => {
      const manager = new CycleManager(cyclesDir);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Focus Test');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'enbu', 'focus', cycle.id,
        '--description', 'Implement auth',
        '--appetite', '30',
        '--skip-prompts',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Focus added!');
    });
  });

  describe('ma', () => {
    it('generates cooldown report', async () => {
      const manager = new CycleManager(cyclesDir);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Reflect Test');
      manager.addBet(cycle.id, {
        description: 'Build feature',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'ma', cycle.id]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Ma (Cooldown) Report');
      expect(output).toContain('Reflect Test');
    });

    it('shows JSON cooldown report', async () => {
      const manager = new CycleManager(cyclesDir);
      const cycle = manager.create({ tokenBudget: 50000 }, 'JSON Report');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'ma', cycle.id]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.cycleId).toBe(cycle.id);
    });
  });
});
