import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';
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
  const runsDir = join(kataDir, 'runs');
  const katasDir = join(kataDir, 'katas');
  const testBinDir = join(baseDir, '.test-bin');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let originalPath: string | undefined;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    mkdirSync(katasDir, { recursive: true });
    mkdirSync(testBinDir, { recursive: true });
    writeFileSync(
      join(testBinDir, 'claude'),
      '#!/usr/bin/env node\nprocess.stdout.write("[]\\n");\n',
      { encoding: 'utf-8', mode: 0o755 },
    );
    originalPath = process.env['PATH'];
    process.env['PATH'] = `${testBinDir}${process.platform === 'win32' ? ';' : ':'}${originalPath ?? ''}`;
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    process.env['PATH'] = originalPath;
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>').option('--plain');
    program.exitOverride();
    registerCycleCommands(program);
    return program;
  }

  async function withStubbedClaudeOutput<T>(output: string, run: () => Promise<T>): Promise<T> {
    const stubDir = join(baseDir, '.test-bin');
    mkdirSync(stubDir, { recursive: true });
    writeFileSync(
      join(stubDir, 'claude'),
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(`${output}\n`)});\n`,
      { encoding: 'utf-8', mode: 0o755 },
    );

    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${stubDir}${process.platform === 'win32' ? ';' : ':'}${originalPath ?? ''}`;

    try {
      return await run();
    } finally {
      process.env['PATH'] = originalPath;
    }
  }

  describe('cycle new', () => {
    it('creates a cycle with --skip-prompts', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'new',
        '--skip-prompts',
        '--budget', '50000',
        '--time', '2 weeks',
        '--name', 'Sprint 1',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Cycle created!');
      const outputCalls = consoleSpy.mock.calls.map((c) => c[0]);
      const statusOutput = outputCalls.find((c) => typeof c === 'string' && c.includes('Sprint 1'));
      expect(statusOutput).toBeDefined();
    });

    it('creates a cycle with JSON output', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'new',
        '--skip-prompts',
        '--budget', '100000',
        '--name', 'JSON Cycle',
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.status).toBeDefined();
      expect(parsed.cycle).toBeDefined();
      expect(parsed.cycle.name).toBe('JSON Cycle');
    });

    it('creates an unnamed draft cycle when --skip-prompts is used without a name', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'new',
        '--skip-prompts',
        '--budget', '100000',
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.cycle.name).toBeUndefined();
      expect(parsed.cycle.state).toBe('planning');
    });

    it('normalizes a whitespace-only draft name to unnamed at creation time', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'new', '--skip-prompts', '--name', '   ',
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.cycle.name).toBeUndefined();
    });
  });

  describe('cycle status', () => {
    it('shows all cycles when no id given', async () => {
      // Create a cycle first
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 }, 'Test Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Test Cycle');
    });

    it('shows specific cycle by id', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Specific Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'status', cycle.id]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Specific Cycle');
    });

    it('shows message when no cycles exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'status']);

      expect(consoleSpy).toHaveBeenCalledWith('No cycles found. Run "kata cycle new" to create one.');
    });

    it('shows error for missing cycle id', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'status', 'nonexistent-id']);

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe('cycle add-bet', () => {
    it('adds a bet with --kata flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Add-Bet Test');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'add-bet', cycle.id, 'Implement auth',
        '--kata', 'full-feature',
        '--appetite', '30',
      ]);

      const updated = manager.get(cycle.id);
      expect(updated.bets).toHaveLength(1);
      expect(updated.bets[0]!.description).toBe('Implement auth');
      expect(updated.bets[0]!.kata).toEqual({ type: 'named', pattern: 'full-feature' });
    });

    it('adds a bet with --gyo flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'add-bet', cycle.id, 'Research spike',
        '--gyo', 'research,plan',
      ]);

      const updated = manager.get(cycle.id);
      expect(updated.bets[0]!.kata).toEqual({ type: 'ad-hoc', stages: ['research', 'plan'] });
    });

    it('adds a bet without kata assignment', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'add-bet', cycle.id, 'No kata bet',
      ]);

      const updated = manager.get(cycle.id);
      expect(updated.bets[0]!.kata).toBeUndefined();
    });

    it('errors when --kata and --gyo are both given', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'add-bet', cycle.id, 'Bad bet',
        '--kata', 'full-feature',
        '--gyo', 'research',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
    });
  });

  describe('cycle update-bet', () => {
    it('updates kata assignment on an existing bet', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const updated = manager.addBet(cycle.id, {
        description: 'Auth bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      const betId = updated.bets[0]!.id;

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'update-bet', betId,
        '--kata', 'full-feature',
      ]);

      const final = manager.get(cycle.id);
      expect(final.bets[0]!.kata).toEqual({ type: 'named', pattern: 'full-feature' });
    });

    it('errors when bet is not found', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'update-bet', crypto.randomUUID(),
        '--kata', 'full-feature',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });

    it('errors when neither --kata nor --gyo given', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const updated = manager.addBet(cycle.id, {
        description: 'Bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      const betId = updated.bets[0]!.id;

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'update-bet', betId,
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--kata or --gyo'));
    });
  });

  describe('cycle start', () => {
    it('starts a cycle with named kata and prepares bridge runs', async () => {
      // Write a saved kata file
      writeFileSync(
        join(katasDir, 'full-feature.json'),
        JSON.stringify({ name: 'full-feature', stages: ['research', 'build'] }),
      );

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Auth feature', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'full-feature' } });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'start', cycle.id, '--name', 'Start Named Cycle',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('active');
      expect(output.cycleName).toBe('Start Named Cycle');
      expect(output.runs).toHaveLength(1);
      expect(output.runs[0].stageSequence).toEqual(['research', 'build']);

      // Cycle should be active
      expect(manager.get(cycle.id).state).toBe('active');

      const bridgeRunFiles = readdirSync(join(kataDir, 'bridge-runs')).filter((file) => file.endsWith('.json'));
      expect(bridgeRunFiles).toHaveLength(1);

      const runJsonPath = join(kataDir, 'runs', output.runs[0].runId, 'run.json');
      expect(existsSync(runJsonPath)).toBe(true);
      const runJson = JSON.parse(readFileSync(runJsonPath, 'utf-8')) as { status: string };
      expect(runJson.status).toBe('running');
    });

    it('starts a cycle with ad-hoc kata', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Quick fix', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, {
        kata: { type: 'ad-hoc', stages: ['build', 'review'] },
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'start', cycle.id, '--name', 'Ad Hoc Start Cycle',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.cycleName).toBe('Ad Hoc Start Cycle');
      expect(output.runs[0].stageSequence).toEqual(['build', 'review']);
    });

    it('auto-suggests a cycle name when starting an unnamed cycle without --name', async () => {
      writeFileSync(
        join(katasDir, 'full-feature.json'),
        JSON.stringify({ name: 'full-feature', stages: ['research', 'build'] }),
      );

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Auth feature', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'full-feature' } });

      await withStubbedClaudeOutput('Auth Launch Cycle', async () => {
        const program = createProgram();
        await program.parseAsync([
          'node', 'test', '--json', '--cwd', baseDir,
          'cycle', 'start', cycle.id,
        ]);
      });

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.cycleName).toBe('Auth Launch Cycle');
      expect(manager.get(cycle.id).name).toBe('Auth Launch Cycle');
    });

    it('errors when bets lack kata assignment', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.addBet(cycle.id, {
        description: 'Unassigned bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'start', cycle.id,
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no kata assignment'));
    });

    it('errors when named kata file is not found', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Auth bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'nonexistent-kata' } });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'start', cycle.id,
      ]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('does not transition cycle to active when kata file is missing (pre-flight)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Auth bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'missing-kata' } });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'start', cycle.id,
      ]);

      expect(errorSpy).toHaveBeenCalled();
      // Cycle should still be in planning state — no state mutation occurred
      expect(manager.get(cycle.id).state).toBe('planning');
    });

    it('starts a cycle with multiple bets creating one run per bet', async () => {
      writeFileSync(
        join(katasDir, 'full-feature.json'),
        JSON.stringify({ name: 'full-feature', stages: ['research', 'build'] }),
      );

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 100000 });

      const withBet1 = manager.addBet(cycle.id, {
        description: 'Auth feature', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet1.bets[0]!.id, { kata: { type: 'named', pattern: 'full-feature' } });

      const withBet2 = manager.addBet(cycle.id, {
        description: 'Dashboard', appetite: 40, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet2.bets[1]!.id, {
        kata: { type: 'ad-hoc', stages: ['plan', 'build'] },
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cycle', 'start', cycle.id, '--name', 'Multi Bet Start Cycle',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('active');
      expect(output.runs).toHaveLength(2);
      expect(output.runs[0].stageSequence).toEqual(['research', 'build']);
      expect(output.runs[1].stageSequence).toEqual(['plan', 'build']);

      const bridgeRunFiles = readdirSync(join(kataDir, 'bridge-runs')).filter((file) => file.endsWith('.json'));
      expect(bridgeRunFiles).toHaveLength(2);
    });
  });

  describe('cycle focus', () => {
    it('adds a bet to a cycle with --skip-prompts', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Focus Test');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'focus', cycle.id,
        '--description', 'Implement auth',
        '--appetite', '30',
        '--skip-prompts',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Focus added!');
    });
  });

  describe('cycle bet list (alias: kadai)', () => {
    it('shows bets from the active cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Active Cycle');
      manager.addBet(cycle.id, {
        description: 'Auth feature',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      manager.updateState(cycle.id, 'active');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Auth feature');
      expect(output).toContain('pending');
    });

    it('shows "No cycles found" when no cycles exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      expect(consoleSpy).toHaveBeenCalledWith('No cycles found. Run "kata cycle new" to create one.');
    });

    it('falls back to the most recent cycle when no active cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Planning Cycle');
      manager.addBet(cycle.id, {
        description: 'Research task',
        appetite: 20,
        outcome: 'pending',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Research task');
    });

    it('targets a specific cycle with --cycle-id', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Specific');
      manager.addBet(cycle.id, {
        description: 'Specific bet',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'bet', 'list', '--cycle-id', cycle.id,
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Specific bet');
      expect(output).toContain('complete');
    });

    it('outputs JSON with --json flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'JSON Test');
      manager.addBet(cycle.id, {
        description: 'JSON bet',
        appetite: 25,
        outcome: 'pending',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir, 'cycle', 'bet', 'list',
      ]);

      const raw = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(raw);
      expect(parsed.bets).toHaveLength(1);
      expect(parsed.bets[0].description).toBe('JSON bet');
      expect(parsed.bets[0].outcome).toBe('pending');
    });

    it('shows bet count summary line', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Summary Test');
      manager.addBet(cycle.id, { description: 'Bet A', appetite: 20, outcome: 'pending', issueRefs: [] });
      manager.addBet(cycle.id, { description: 'Bet B', appetite: 20, outcome: 'complete', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('2 bet(s)');
      expect(output).toContain('1 pending');
      expect(output).toContain('1 complete');
    });

    it('shows "No bets in this cycle" when bets array is empty', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 }, 'Empty Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No bets in this cycle');
    });

    it('accepts the kadai alias (kata cycle kadai list)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Kadai Alias Test');
      manager.addBet(cycle.id, {
        description: 'Kadai bet',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'kadai', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Kadai bet');
    });

    it('uses plain labels with --plain flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Plain Test');
      manager.addBet(cycle.id, { description: 'Plain bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--plain', '--cwd', baseDir, 'cycle', 'bet', 'list']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Cycle:');       // plain label, not "Keiko:"
      expect(output).toContain('Bets:');         // plain "Bets:", not "Bets (kadai):"
    });
  });

  describe('cycle staged', () => {
    it('shows "no staged cycle" message when none exists', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No staged cycle found.');
      expect(output).toContain('kata cycle new');
    });

    it('shows the staged cycle when one exists in planning state', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Next Sprint');
      manager.addBet(cycle.id, { description: 'Build auth', appetite: 30, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Staged cycle');
      expect(output).toContain('Next Sprint');
      expect(output).toContain('Next steps:');
    });

    it('shows hint to add bets when staged cycle has no bets', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 }, 'Empty Staged');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No bets yet');
    });

    it('returns JSON with --json flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 }, 'JSON Staged');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'cycle', 'staged']);

      const raw = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(raw);
      expect(parsed.cycle).toBeDefined();
      expect(parsed.cycle.name).toBe('JSON Staged');
      expect(parsed.cycle.state).toBe('planning');
    });

    it('ignores active cycles when showing staged cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const activeCycle = manager.create({ tokenBudget: 50000 }, 'Active Cycle');
      manager.updateState(activeCycle.id, 'active');
      manager.create({ tokenBudget: 30000 }, 'Staged Cycle');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Staged Cycle');
      expect(output).not.toContain('Active Cycle');
    });
  });

  describe('cycle staged add-bet', () => {
    it('adds a bet to the staged cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Sprint X');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'add-bet', 'Implement search',
        '--appetite', '25',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Bet added to staged cycle!');
      const updated = manager.get(cycle.id);
      expect(updated.bets).toHaveLength(1);
      expect(updated.bets[0]!.description).toBe('Implement search');
      expect(updated.bets[0]!.appetite).toBe(25);
    });

    it('adds a bet with --gyo kata assignment', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'add-bet', 'Quick fix',
        '--gyo', 'build,review',
      ]);

      const updated = manager.get(cycle.id);
      expect(updated.bets[0]!.kata).toEqual({ type: 'ad-hoc', stages: ['build', 'review'] });
    });

    it('errors when no staged cycle exists', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'add-bet', 'Orphan bet',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No staged cycle found'));
    });

    it('errors when --kata and --gyo are both given', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'add-bet', 'Bad',
        '--kata', 'full-feature', '--gyo', 'build',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('mutually exclusive'));
    });
  });

  describe('cycle staged remove-bet', () => {
    it('removes a bet from the staged cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Remove Test');
      const withBet = manager.addBet(cycle.id, {
        description: 'To be removed', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      const betId = withBet.bets[0]!.id;

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'remove-bet', betId,
      ]);

      expect(consoleSpy).toHaveBeenCalledWith('Bet removed from staged cycle.');
      expect(manager.get(cycle.id).bets).toHaveLength(0);
    });

    it('errors when bet ID is not found', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'remove-bet', crypto.randomUUID(),
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
    });
  });

  describe('cycle staged clear', () => {
    it('clears an empty staged cycle without --force', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'To Clear');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'clear']);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cleared'));
      // Cycle should be gone
      expect(() => manager.get(cycle.id)).toThrow();
    });

    it('refuses to clear a cycle with bets without --force', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Has Bets');
      manager.addBet(cycle.id, { description: 'Existing bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'clear']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--force'));
      // Cycle should still exist
      expect(manager.get(cycle.id)).toBeDefined();
    });

    it('clears a cycle with bets when --force is given', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Force Clear');
      manager.addBet(cycle.id, { description: 'Bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cycle', 'staged', 'clear', '--force',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('cleared'));
      expect(() => manager.get(cycle.id)).toThrow();
    });

    it('shows "No staged cycle to clear" when none exists', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'clear']);

      expect(consoleSpy).toHaveBeenCalledWith('No staged cycle to clear.');
    });

    it('outputs JSON with --json flag', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'JSON Clear');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'cycle', 'staged', 'clear']);

      const raw = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(raw);
      expect(parsed.cleared).toBe(true);
      expect(parsed.cycleId).toBe(cycle.id);
    });
  });

  describe('cycle staged launch', () => {
    it('transitions cycle state from planning to active', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Launch Me');
      manager.addBet(cycle.id, { description: 'Build feature X', appetite: 25, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('active');
    });

    it('reports "Launched!" and lists prepared runs', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Sprint Next');
      manager.addBet(cycle.id, { description: 'Do the thing', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Launched!');
      expect(output).toContain('Do the thing');
    });

    it('errors when no staged cycle exists', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('No staged cycle found'));
    });

    it('errors when staged cycle has no bets', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      manager.create({ tokenBudget: 50000 }, 'Empty Staged');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('no bets'));
    });

    it('auto-suggests a name when staged cycle has no name and no --name override', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.addBet(cycle.id, { description: 'Unnamed launch bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      await withStubbedClaudeOutput('Suggested Launch Cycle', async () => {
        const program = createProgram();
        await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);
      });

      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('active');
      expect(updated.name).toBe('Suggested Launch Cycle');
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Suggested Launch Cycle');
    });

    it('rejects a whitespace-only --name when launching a staged cycle', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.addBet(cycle.id, { description: 'Whitespace launch bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch', '--name', '   ']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Cycle name must be non-empty when provided.'));
    });

    it('outputs JSON with --json flag and preserves cycleId', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'JSON Launch');
      manager.addBet(cycle.id, { description: 'JSON bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      const raw = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(raw);
      expect(parsed.cycleId).toBe(cycle.id);
      expect(parsed.preparedRuns).toHaveLength(1);

      // State should still have transitioned even with --json
      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('active');
    });

    it('sets cycle name from --name flag at launch time (#346)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.addBet(cycle.id, { description: 'Named launch bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch', '--name', 'Keiko 10 — Belt & Self-Improvement']);

      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('active');
      expect(updated.name).toBe('Keiko 10 — Belt & Self-Improvement');
    });

    it('uses --name in the launch output when provided (#346)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.addBet(cycle.id, { description: 'Name output bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch', '--name', 'My Named Cycle']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('My Named Cycle');
    });

    it('--name overrides existing cycle name set at creation time (#346)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Old Name');
      manager.addBet(cycle.id, { description: 'Override name bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch', '--name', 'New Name']);

      const updated = manager.get(cycle.id);
      expect(updated.name).toBe('New Name');
    });

    it('preserves original cycle name when --name is not provided (#346)', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Preserved Name');
      manager.addBet(cycle.id, { description: 'Preserve name bet', appetite: 20, outcome: 'pending', issueRefs: [] });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cycle', 'staged', 'launch']);

      const updated = manager.get(cycle.id);
      expect(updated.name).toBe('Preserved Name');
    });

  });

  describe('cycle-manager removeBet', () => {
    it('removes a bet from a planning cycle', () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Test bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      const betId = withBet.bets[0]!.id;

      const result = manager.removeBet(cycle.id, betId);
      expect(result.bets).toHaveLength(0);
    });

    it('throws when bet not found', () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      expect(() => manager.removeBet(cycle.id, crypto.randomUUID())).toThrow('not found');
    });

    it('throws when cycle is not in planning state', () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      const withBet = manager.addBet(cycle.id, {
        description: 'Test bet', appetite: 20, outcome: 'pending', issueRefs: [],
      });
      const betId = withBet.bets[0]!.id;
      manager.updateState(cycle.id, 'active');

      expect(() => manager.removeBet(cycle.id, betId)).toThrow('planning cycles');
    });
  });

  describe('cycle-manager deleteCycle', () => {
    it('deletes a planning-state cycle', () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      manager.deleteCycle(cycle.id);
      expect(() => manager.get(cycle.id)).toThrow();
    });

    it('throws when cycle is not in planning state', () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });
      manager.updateState(cycle.id, 'active');

      expect(() => manager.deleteCycle(cycle.id)).toThrow('planning-state');
    });
  });

  describe('cooldown', () => {
    it('generates cooldown session result with --skip-prompts', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Reflect Test');
      manager.addBet(cycle.id, {
        description: 'Build feature',
        appetite: 40,
        outcome: 'complete',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--plain', '--cwd', baseDir, 'cooldown', cycle.id, '--skip-prompts']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Cooldown Report');
      expect(output).toContain('Reflect Test');

      // Cycle should be transitioned to complete
      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('complete');
    });

    it('shows JSON cooldown session result', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'JSON Report');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'cooldown', cycle.id, '--skip-prompts']);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.report.cycleId).toBe(cycle.id);
      expect(parsed.proposals).toBeDefined();
      expect(parsed.learningsCaptured).toBeDefined();
    });

    it('shows proposals section when unfinished work exists', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Proposal Test');
      manager.addBet(cycle.id, {
        description: 'Incomplete feature',
        appetite: 30,
        outcome: 'partial',
        issueRefs: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--plain', '--cwd', baseDir, 'cooldown', cycle.id, '--skip-prompts']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Next-Cycle Proposals');
      expect(output).toContain('Continue: Incomplete feature');
    });

    it('shows error for missing cycle id', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cooldown', 'nonexistent-id', '--skip-prompts']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('uses interactive prompts for bet outcomes when not skipped', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Interactive Test');
      const updatedCycle = manager.addBet(cycle.id, {
        description: 'Auth feature',
        appetite: 30,
        outcome: 'pending',
        issueRefs: [],
      });
      const _betId = updatedCycle.bets[0]!.id;

      // Mock inquirer prompts
      const { select, input } = await import('@inquirer/prompts');
      (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('complete');
      (input as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(''); // human perspective — skip

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cooldown', cycle.id]);

      // Verify select was called for bet outcome
      expect(select).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Auth feature'),
        }),
      );

      // Verify cycle is complete
      const finalCycle = manager.get(cycle.id);
      expect(finalCycle.state).toBe('complete');
    });

    it('prompts for notes when bet outcome is partial', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Notes Test');
      manager.addBet(cycle.id, {
        description: 'Search feature',
        appetite: 25,
        outcome: 'pending',
        issueRefs: [],
      });

      // Mock inquirer prompts
      const { select, input } = await import('@inquirer/prompts');
      (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('partial');
      (input as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Half done');
      (input as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(''); // human perspective — skip

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'cooldown', cycle.id]);

      // Verify input was called for notes
      expect(input).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Notes (optional):',
        }),
      );
    });

    it('--auto-accept-suggestions accepts all pending rule suggestions without prompts', async () => {
      const { RuleRegistry } = await import('@infra/registries/rule-registry.js');
      const rulesDir = join(kataDir, 'rules');
      mkdirSync(rulesDir, { recursive: true });
      const ruleRegistry = new RuleRegistry(rulesDir);

      const suggestion = ruleRegistry.suggestRule({
        suggestedRule: {
          category: 'build',
          name: 'Boost TypeScript',
          condition: 'When tests exist',
          effect: 'boost',
          magnitude: 0.3,
          confidence: 0.8,
          source: 'auto-detected',
          evidence: [],
        },
        triggerDecisionIds: ['00000000-0000-4000-8000-000000000001'],
        observationCount: 3,
        reasoning: 'Observed 3 times',
      });

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Auto-accept Test');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cooldown', cycle.id,
        '--skip-prompts', '--auto-accept-suggestions',
      ]);

      // Suggestion should be promoted to an active rule
      const refreshed = new RuleRegistry(rulesDir);
      expect(refreshed.getPendingSuggestions()).toHaveLength(0);
      expect(refreshed.loadRules('build')).toHaveLength(1);
      expect(refreshed.loadRules('build')[0]!.id).toBeDefined();

      // Console should confirm auto-accept
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Auto-accepted 1 rule suggestion(s)');

      // Cycle should be complete
      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('complete');

      // Suggestion id used was ours
      void suggestion; // referenced to avoid unused var warning
    });

    // Issue #227 — --yolo synthesis failure visible in --json output.
    // We test the well-formed JSON shape when --yolo completes (even with
    // no synthesis proposals). Verifying synthesisError is surfaced in JSON
    // requires the subprocess to fail — that is covered in the unit-level test
    // for the cycle.ts --yolo handler.
    it('--yolo produces well-formed --json output with report and proposals fields', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Yolo Shape Test');

      const synthesisDir = join(kataDir, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      // Write a pre-canned synthesis result so the --yolo path reads it back
      // without needing to spawn claude. This exercises the complete() path.
      const { SynthesisResultSchema } = await import('@domain/types/synthesis.js');
      const fakeInputId = crypto.randomUUID();
      const resultPath = join(synthesisDir, `result-${fakeInputId}.json`);
      JsonStore.write(
        resultPath,
        { inputId: fakeInputId, proposals: [] },
        SynthesisResultSchema,
      );

      // Write a matching pending input so prepare() can write its own file
      // and complete() can pick up the result. We skip the synthesis spawn by
      // pre-writing the result file before the cycle is even in cooldown state.

      await withStubbedClaudeOutput('[]', async () => {
        const program = createProgram();
        await program.parseAsync([
          'node', 'test', '--json', '--cwd', baseDir,
          'cooldown', cycle.id, '--yolo',
        ]);
      });

      // JSON output must always be valid and contain the core fields (#227 fix)
      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      expect(firstCall).toBeDefined();
      const parsed = JSON.parse(firstCall);
      expect(parsed.report).toBeDefined();
      expect(parsed.proposals).toBeDefined();
      // synthesisProposals key must be present (may be undefined/empty when no proposals applied)
      expect('synthesisProposals' in parsed).toBe(true);

      // When synthesis spawning fails, synthesisError must appear in JSON output —
      // confirmed by code inspection: synthesisError is spread into the output when set.
    }, 60000);

    // Issue #257 — --yolo --json must emit a valid JSON object even when synthesis fails.
    // Synthesis failure is simulated by writing no result file (the subprocess call will fail
    // with ENOENT for 'claude', caught internally, and the yolo block must still emit JSON).
    it('--yolo --json emits valid JSON with synthesisProposals key when claude is unavailable', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Yolo Failure JSON Test');

      const synthesisDir = join(kataDir, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      // PATH manipulation makes 'claude' unavailable — execFileSync throws ENOENT,
      // which the --yolo handler catches and converts into synthesisError in JSON output.
      const originalPath = process.env['PATH'];
      process.env['PATH'] = '';

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cooldown', cycle.id, '--yolo',
      ]);

      process.env['PATH'] = originalPath;
      warnSpy.mockRestore();

      // Must have emitted exactly one JSON object to stdout (#257 fix)
      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      expect(firstCall).toBeDefined();
      const parsed = JSON.parse(firstCall);

      // Core fields always present
      expect(parsed.synthesisProposals).toEqual([]);
      // report is present because complete() succeeded despite synthesis failure
      expect(parsed.report).toBeDefined();
      expect(parsed.proposals).toBeDefined();
      // synthesisError surfaces the failure message
      expect(typeof parsed.synthesisError).toBe('string');

      // Cycle must still be complete
      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('complete');
    }, 30000);

    // Issue #227 — non-JSON --yolo mode must surface synthesis errors to the user.
    it('--yolo non-JSON mode surfaces synthesis failure via console.warn', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Yolo Failure Non-JSON Test');

      const synthesisDir = join(kataDir, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      const originalPath = process.env['PATH'];
      process.env['PATH'] = '';

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--plain', '--cwd', baseDir,
        'cooldown', cycle.id, '--yolo',
      ]);

      const warnCalls = warnSpy.mock.calls.map((c) => c[0] as string).join('\n');
      process.env['PATH'] = originalPath;
      warnSpy.mockRestore();

      // User-visible warning must mention the failure (#227)
      expect(warnCalls).toContain('synthesis failure');

      // Cycle must still complete
      const updated = manager.get(cycle.id);
      expect(updated.state).toBe('complete');
    }, 30000);

    // Issue #329 — ranWithYolo must be set after --yolo cooldown completes.
    // Belt progression checks project-state.json for ranWithYolo=true; if it
    // is never written, go-kyu advancement is permanently blocked.
    it('--yolo sets ranWithYolo=true in project-state.json after complete()', async () => {
      const { loadProjectState } = await import('@features/belt/belt-calculator.js');

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Yolo RanWithYolo Test');

      const synthesisDir = join(kataDir, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      const originalPath = process.env['PATH'];
      process.env['PATH'] = '';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'cooldown', cycle.id, '--yolo',
      ]);

      process.env['PATH'] = originalPath;
      warnSpy.mockRestore();

      // project-state.json must record ranWithYolo=true (#329 fix)
      const stateFile = join(kataDir, 'project-state.json');
      const state = loadProjectState(stateFile);
      expect(state.ranWithYolo).toBe(true);
    }, 30000);

    // Issue #336 — --yolo non-JSON mode must emit cycle header before any async ops.
    // Previously the first stdout output was from formatCooldownSessionResult() — only
    // visible after prepare() + synthesis completed. If complete() threw, there was zero
    // stdout. Fix: emit "Cooldown (--yolo): <name> — N bet(s)" immediately (#336).
    it('--yolo non-JSON mode emits cycle name and bet count as header before prepare', async () => {
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Yolo Header Test');

      const synthesisDir = join(kataDir, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      const originalPath = process.env['PATH'];
      process.env['PATH'] = '';
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--plain', '--cwd', baseDir,
        'cooldown', cycle.id, '--yolo',
      ]);

      process.env['PATH'] = originalPath;
      warnSpy.mockRestore();

      // Cycle header must appear on stdout (first or early call)
      const stdoutCalls = consoleSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(stdoutCalls).toContain('Cooldown (--yolo): Yolo Header Test');
      expect(stdoutCalls).toContain('0 bet(s)');
    }, 30000);

    it('--auto-accept-suggestions includes suggestionReview in --json output', async () => {
      const { RuleRegistry } = await import('@infra/registries/rule-registry.js');
      const rulesDir = join(kataDir, 'rules');
      mkdirSync(rulesDir, { recursive: true });
      const ruleRegistry = new RuleRegistry(rulesDir);

      ruleRegistry.suggestRule({
        suggestedRule: {
          category: 'build',
          name: 'Boost TS',
          condition: 'When tests exist',
          effect: 'boost',
          magnitude: 0.3,
          confidence: 0.8,
          source: 'auto-detected',
          evidence: [],
        },
        triggerDecisionIds: ['00000000-0000-4000-8000-000000000001'],
        observationCount: 3,
        reasoning: 'test',
      });

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'cooldown', cycle.id,
        '--skip-prompts', '--auto-accept-suggestions',
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.suggestionReview).toEqual({ accepted: 1, rejected: 0, deferred: 0 });
      expect(parsed.ruleSuggestions).toHaveLength(1);
    });
  });
});
