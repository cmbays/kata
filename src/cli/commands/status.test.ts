import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerStatusCommands } from './status.js';

describe('registerStatusCommands', () => {
  const baseDir = join(tmpdir(), `kata-status-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(join(kataDir, 'cycles'), { recursive: true });
    mkdirSync(join(kataDir, 'knowledge', 'learnings'), { recursive: true });
    mkdirSync(join(kataDir, 'tracking'), { recursive: true });
    mkdirSync(join(kataDir, 'artifacts'), { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerStatusCommands(program);
    return program;
  }

  // ---- kata status ----

  describe('status', () => {
    it('shows project overview with no data', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kata Project Status');
      expect(output).toContain('No cycles created yet');
      expect(output).toContain('No recent artifacts');
      expect(output).toContain('no learnings captured yet');
    });

    it('shows JSON output', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'status']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('activeCycle');
      expect(parsed).toHaveProperty('recentArtifacts');
      expect(parsed).toHaveProperty('knowledge');
    });

    it('shows active cycle when one exists', async () => {
      const now = new Date().toISOString();
      const cycleId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
      const betId = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
      const cycle = {
        id: cycleId,
        name: 'test-cycle',
        state: 'active',
        bets: [{ id: betId, description: 'Test bet', appetite: 30, outcome: 'pending', issueRefs: [] }],
        budget: { tokenBudget: 100000 },
        cooldownReserve: 10,
        pipelineMappings: [],
        createdAt: now,
        updatedAt: now,
      };
      writeFileSync(join(kataDir, 'cycles', `${cycleId}.json`), JSON.stringify(cycle, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Active cycle: test-cycle');
      expect(output).toContain('Bets: 1');
    });

    it('shows recent artifacts', async () => {
      const artifact = {
        name: 'build-synthesis',
        timestamp: new Date().toISOString(),
        content: 'test output',
      };
      writeFileSync(join(kataDir, 'artifacts', 'build-synthesis.json'), JSON.stringify(artifact, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Recent artifacts:');
      expect(output).toContain('build-synthesis');
    });
  });

  // ---- kata stats ----

  describe('stats', () => {
    it('shows analytics overview with no data', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stats']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kata Analytics');
      expect(output).toContain('No execution data');
      expect(output).toContain('No knowledge data');
    });

    it('shows JSON output', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stats']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('execution');
      expect(parsed).toHaveProperty('knowledge');
    });

    it('accepts --gyo as alias for --category', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stats', '--gyo', 'build']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kata Analytics (build)');
    });

    it('rejects invalid --gyo value', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stats', '--gyo', 'nope']);

      expect(process.exitCode).toBe(1);
      const output = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Invalid category');
      process.exitCode = undefined as unknown as number;
    });
  });
});
