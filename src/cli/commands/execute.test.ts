import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerExecuteCommands } from './execute.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';

// ---------------------------------------------------------------------------
// Hoist mock functions before modules are imported
// ---------------------------------------------------------------------------

const { mockRunStage, mockRunPipeline } = vi.hoisted(() => ({
  mockRunStage: vi.fn(),
  mockRunPipeline: vi.fn(),
}));

// Mock KiaiRunner as a class (required for Vitest to treat it as a constructor)
vi.mock('@features/execute/kiai-runner.js', () => ({
  KiaiRunner: class MockKiaiRunner {
    runStage = mockRunStage;
    runPipeline = mockRunPipeline;
  },
  listRecentArtifacts: vi.fn().mockReturnValue([]),
}));

// Stub status handlers so `execute status`/`execute stats` don't need real infra
vi.mock('./status.js', () => ({
  handleStatus: vi.fn(),
  handleStats: vi.fn(),
  parseCategoryFilter: vi.fn().mockReturnValue(undefined),
}));

// ---------------------------------------------------------------------------
// Mock OrchestratorResult values
// ---------------------------------------------------------------------------

function makeSingleResult(stageCategory = 'build') {
  return {
    stageCategory,
    executionMode: 'sequential',
    selectedFlavors: ['typescript-tdd'],
    decisions: [
      { decisionType: 'flavor-selection', selection: 'typescript-tdd', confidence: 0.9 },
    ],
    stageArtifact: {
      name: `${stageCategory}-synthesis`,
      content: 'output',
      timestamp: new Date().toISOString(),
    },
  };
}

function makePipelineResult(categories: string[]) {
  return {
    stageResults: categories.map((cat) => ({
      stageCategory: cat,
      selectedFlavors: ['default'],
      executionMode: 'sequential',
      stageArtifact: { name: `${cat}-synthesis`, content: 'output', timestamp: new Date().toISOString() },
      decisions: [],
    })),
    pipelineReflection: { overallQuality: 'good', learnings: [] },
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

describe('registerExecuteCommands', () => {
  const baseDir = join(tmpdir(), `kata-execute-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(join(kataDir, 'stages'), { recursive: true });
    mkdirSync(join(kataDir, 'flavors'), { recursive: true });
    mkdirSync(join(kataDir, 'history'), { recursive: true });
    mkdirSync(join(kataDir, 'tracking'), { recursive: true });
    mkdirSync(join(kataDir, 'katas'), { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunStage.mockResolvedValue(makeSingleResult());
    mockRunPipeline.mockResolvedValue(makePipelineResult(['build', 'review']));
    process.exitCode = undefined as unknown as number;
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
    registerExecuteCommands(program);
    return program;
  }

  // ---- --list-katas ----

  describe('--list-katas', () => {
    it('shows empty message when no katas are saved', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No saved katas');
    });

    it('lists saved katas when some exist', async () => {
      const kata = { name: 'my-kata', stages: ['build', 'review'] };
      writeFileSync(join(kataDir, 'katas', 'my-kata.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('my-kata');
      expect(output).toContain('build -> review');
    });

    it('outputs saved katas as JSON with global --json flag', async () => {
      const kata = { name: 'json-kata', stages: ['research'] };
      writeFileSync(join(kataDir, 'katas', 'json-kata.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.some((k: { name: string }) => k.name === 'json-kata')).toBe(true);
    });

    it('skips invalid kata files without crashing', async () => {
      writeFileSync(join(kataDir, 'katas', 'bad.json'), '{ broken json }');
      const kata = { name: 'good-kata', stages: ['plan'] };
      writeFileSync(join(kataDir, 'katas', 'good-kata.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('good-kata');
    });

    it('includes description when kata has one', async () => {
      const kata = { name: 'described-kata', stages: ['build'], description: 'My description' };
      writeFileSync(join(kataDir, 'katas', 'described-kata.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('My description');
    });
  });

  // ---- --delete-kata ----

  describe('--delete-kata', () => {
    it('deletes an existing kata and prints confirmation', async () => {
      const kata = { name: 'to-delete', stages: ['build'] };
      const filePath = join(kataDir, 'katas', 'to-delete.json');
      writeFileSync(filePath, JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--delete-kata', 'to-delete']);

      expect(existsSync(filePath)).toBe(false);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('"to-delete" deleted');
    });

    it('sets exitCode=1 when kata does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--delete-kata', 'nonexistent']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ---- --save-kata ----

  describe('--save-kata', () => {
    it('saves kata after a successful run', async () => {
      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--save-kata', 'my-run']);

      const filePath = join(kataDir, 'katas', 'my-run.json');
      expect(existsSync(filePath)).toBe(true);
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(raw.name).toBe('my-run');
      expect(raw.stages).toEqual(['build']);
    });

    it('does not save kata when --dry-run is set', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build',
        '--save-kata', 'dry-kata', '--dry-run',
      ]);

      const filePath = join(kataDir, 'katas', 'dry-kata.json');
      expect(existsSync(filePath)).toBe(false);
    });

    it('prints confirmation message after save', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--save-kata', 'saved-kata']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('"saved-kata" saved');
    });
  });

  // ---- --kata <name> ----

  describe('--kata', () => {
    it('loads saved kata and resolves categories for a multi-stage run', async () => {
      const kata = { name: 'full-run', stages: ['research', 'plan'] };
      writeFileSync(join(kataDir, 'katas', 'full-run.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--kata', 'full-run']);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        ['research', 'plan'],
        expect.objectContaining({ bet: undefined, dryRun: undefined }),
      );
    });

    it('sets exitCode=1 for non-existent kata', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--kata', 'missing-kata']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('sets exitCode=1 on kata with invalid JSON', async () => {
      writeFileSync(join(kataDir, 'katas', 'bad-json-kata.json'), '{ broken }');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--kata', 'bad-json-kata']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ---- kata name validation (assertValidKataName) ----

  describe('kata name path traversal guard', () => {
    const TRAVERSAL_NAMES = ['../evil', 'foo/bar', '..', 'foo\\bar', 'a b', 'foo|bar'];

    for (const badName of TRAVERSAL_NAMES) {
      it(`--kata "${badName}" sets exitCode=1`, async () => {
        const program = createProgram();
        await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--kata', badName]);
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
      });

      it(`--save-kata "${badName}" sets exitCode=1`, async () => {
        const program = createProgram();
        await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--save-kata', badName]);
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
      });

      it(`--delete-kata "${badName}" sets exitCode=1`, async () => {
        const program = createProgram();
        await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--delete-kata', badName]);
        expect(process.exitCode).toBe(1);
        expect(errorSpy).toHaveBeenCalled();
      });
    }

    it('accepts a valid kata name with letters, digits, hyphens, underscores', async () => {
      const kata = { name: 'my_kata-1', stages: ['build'] };
      writeFileSync(join(kataDir, 'katas', 'my_kata-1.json'), JSON.stringify(kata, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--kata', 'my_kata-1']);
      expect(process.exitCode).not.toBe(1);
    });
  });

  // ---- --gyo <stages> ----

  describe('--gyo', () => {
    it('runs comma-separated stage categories', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--gyo', 'build,review']);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        ['build', 'review'],
        expect.anything(),
      );
    });

    it('filters empty strings from double-comma edge case', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--gyo', 'research,,build']);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        ['research', 'build'],
        expect.anything(),
      );
    });

    it('sets exitCode=1 for invalid category in --gyo', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--gyo', 'build,invalid-cat']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('sets exitCode=1 when --gyo resolves to empty list', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--gyo', ',,,']);

      expect(process.exitCode).toBe(1);
    });
  });

  // ---- --ryu (pin) ----

  describe('--ryu / --pin', () => {
    it('passes pinned flavor via --ryu', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build', '--ryu', 'typescript-tdd',
      ]);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ pin: ['typescript-tdd'] }),
      );
    });

    it('merges --ryu and --pin flags', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build',
        '--ryu', 'typescript-tdd', '--pin', 'legacy-build',
      ]);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ pin: expect.arrayContaining(['typescript-tdd', 'legacy-build']) }),
      );
    });
  });

  // ---- parseBetOption edge cases (via --bet) ----

  describe('--bet (parseBetOption)', () => {
    it('passes valid JSON object as bet context', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build',
        '--bet', '{"title":"Add search"}',
      ]);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ bet: { title: 'Add search' } }),
      );
    });

    it('sets exitCode=1 and prints error for invalid JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--bet', '{broken}']);

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('valid JSON');
    });

    it('sets exitCode=1 and prints error when --bet is a JSON array', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--bet', '["a","b"]']);

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('JSON object');
    });

    it('sets exitCode=1 and prints error when --bet is null', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--bet', 'null']);

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('JSON object');
    });

    it('passes undefined bet when --bet is not provided', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build']);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ bet: undefined }),
      );
    });
  });

  // ---- Invalid category in runCategories ----

  describe('invalid category', () => {
    it('sets exitCode=1 for unrecognized stage category', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'invalid-stage']);

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('Invalid stage category');
    });

    it('prints valid categories in the error message', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'deploy']);

      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('research');
    });

    it('sets exitCode=1 when no categories are specified', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute']);

      expect(process.exitCode).toBe(1);
      const allErrors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(allErrors).toContain('No categories specified');
    });
  });

  // ---- single vs multi-stage output ----

  describe('run output', () => {
    it('prints stage result for a single category', async () => {
      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Stage: build');
      expect(output).toContain('typescript-tdd');
    });

    it('outputs single stage as JSON when global --json flag is set', async () => {
      mockRunStage.mockResolvedValue(makeSingleResult('research'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.stageCategory).toBe('research');
    });

    it('prints pipeline result for multiple categories', async () => {
      mockRunPipeline.mockResolvedValue(makePipelineResult(['research', 'build']));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'research', 'build']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Pipeline: research -> build');
    });

    it('outputs pipeline as JSON when global --json flag is set', async () => {
      mockRunPipeline.mockResolvedValue(makePipelineResult(['build', 'review']));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', 'build', 'review']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.pipelineReflection).toBeDefined();
    });

    it('shows dry-run notice in output for single stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--dry-run']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('dry-run');
    });

    it('shows pipeline learnings in output', async () => {
      mockRunPipeline.mockResolvedValue({
        ...makePipelineResult(['build', 'review']),
        pipelineReflection: { overallQuality: 'good', learnings: ['Use tests first'] },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', 'review']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Use tests first');
    });
  });

  // ---- --bridge-gaps ----

  describe('--bridge-gaps', () => {
    it('registers --bridge-gaps option on the execute command', () => {
      const program = createProgram();
      const executeCmd = program.commands.find((c) => c.name() === 'execute');
      expect(executeCmd).toBeDefined();
      const bridgeGapsOpt = executeCmd!.options.find((o) => o.long === '--bridge-gaps');
      expect(bridgeGapsOpt).toBeDefined();
    });
  });

  // ---- kiai alias ----

  describe('kiai alias', () => {
    it('accepts kiai as alias for execute', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'kiai', 'build']);

      expect(mockRunStage).toHaveBeenCalledWith('build', expect.anything());
    });
  });

  // ---- --next flag (Issue #191) ----

  describe('--next', () => {
    const cyclesDir = join(kataDir, 'cycles');

    it('prints message and exits cleanly when no active cycle exists', async () => {
      mkdirSync(cyclesDir, { recursive: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No active cycle found');
      expect(mockRunStage).not.toHaveBeenCalled();
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    it('prints message and exits cleanly when no pending bets in active cycle', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Resolved Cycle');
      manager.addBet(cycle.id, { description: 'Done bet', appetite: 30, outcome: 'complete', issueRefs: [] });
      manager.updateState(cycle.id, 'active');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('No pending bets');
      expect(mockRunStage).not.toHaveBeenCalled();
    });

    it('auto-selects the first pending bet and resolves categories from its ad-hoc kata', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Active Cycle');
      const withBet = manager.addBet(cycle.id, {
        description: 'My next bet', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'ad-hoc', stages: ['build'] } });
      manager.updateState(cycle.id, 'active');

      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      // Correct stage resolved from bet's kata assignment
      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ bet: expect.objectContaining({ description: 'My next bet' }) }),
      );

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Auto-selected bet');
      expect(output).toContain('My next bet');
    });

    it('skips non-pending bets and selects the first pending one', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 100000 }, 'Multi-Bet Cycle');

      // First bet: complete (should be skipped)
      const withBet1 = manager.addBet(cycle.id, {
        description: 'Already done', appetite: 20, outcome: 'complete', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet1.bets[0]!.id, { kata: { type: 'ad-hoc', stages: ['research'] } });

      // Second bet: pending (should be selected)
      const withBet2 = manager.addBet(cycle.id, {
        description: 'Next up', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet2.bets[1]!.id, { kata: { type: 'ad-hoc', stages: ['build'] } });

      manager.updateState(cycle.id, 'active');

      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ bet: expect.objectContaining({ description: 'Next up' }) }),
      );
    });

    it('errors gracefully when named kata file does not exist', async () => {
      mkdirSync(cyclesDir, { recursive: true });

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Missing Kata Cycle');
      const withBet = manager.addBet(cycle.id, {
        description: 'Bet with bad kata', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'nonexistent' } });
      manager.updateState(cycle.id, 'active');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      const errorOutput = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errorOutput).toContain('Error loading kata "nonexistent"');
      expect(mockRunStage).not.toHaveBeenCalled();
      expect(mockRunPipeline).not.toHaveBeenCalled();
    });

    it('resolves categories from a named kata file', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      writeFileSync(join(kataDir, 'katas', 'my-kata.json'), JSON.stringify({ name: 'my-kata', stages: ['plan', 'build'] }));

      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Named Kata Cycle');
      const withBet = manager.addBet(cycle.id, {
        description: 'Named kata bet', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'named', pattern: 'my-kata' } });
      manager.updateState(cycle.id, 'active');

      mockRunPipeline.mockResolvedValue(makePipelineResult(['plan', 'build']));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      expect(mockRunPipeline).toHaveBeenCalledWith(
        ['plan', 'build'],
        expect.objectContaining({ bet: expect.objectContaining({ description: 'Named kata bet' }) }),
      );
    });
  });
});
