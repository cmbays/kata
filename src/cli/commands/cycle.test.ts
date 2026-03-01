import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(runsDir, { recursive: true });
    mkdirSync(katasDir, { recursive: true });
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
    program.option('--json').option('--verbose').option('--cwd <path>').option('--plain');
    program.exitOverride();
    registerCycleCommands(program);
    return program;
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
      ]);

      const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(firstCall);
      expect(parsed.status).toBeDefined();
      expect(parsed.cycle).toBeDefined();
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
    it('starts a cycle with named kata and creates run trees', async () => {
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
        'cycle', 'start', cycle.id,
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('active');
      expect(output.runs).toHaveLength(1);
      expect(output.runs[0].stageSequence).toEqual(['research', 'build']);

      // Cycle should be active
      expect(manager.get(cycle.id).state).toBe('active');
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
        'cycle', 'start', cycle.id,
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.runs[0].stageSequence).toEqual(['build', 'review']);
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
        'cycle', 'start', cycle.id,
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('active');
      expect(output.runs).toHaveLength(2);
      expect(output.runs[0].stageSequence).toEqual(['research', 'build']);
      expect(output.runs[1].stageSequence).toEqual(['plan', 'build']);
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
      const { select, input: _input } = await import('@inquirer/prompts');
      (select as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('complete');
      // input should not be called for complete outcome (no notes prompt)

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
