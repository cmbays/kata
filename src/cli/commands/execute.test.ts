import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerExecuteCommands } from './execute.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { SessionExecutionBridge } from '@infra/execution/session-bridge.js';
import { ProjectStateUpdater } from '@features/belt/belt-calculator.js';

// ---------------------------------------------------------------------------
// Hoist mock functions before modules are imported
// ---------------------------------------------------------------------------

const { mockRunStage, mockRunPipeline } = vi.hoisted(() => ({
  mockRunStage: vi.fn(),
  mockRunPipeline: vi.fn(),
}));

const { mockBridgeGaps } = vi.hoisted(() => ({
  mockBridgeGaps: vi.fn(),
}));

// Mock WorkflowRunner as a class (required for Vitest to treat it as a constructor)
vi.mock('@features/execute/workflow-runner.js', () => ({
  WorkflowRunner: class MockWorkflowRunner {
    runStage = mockRunStage;
    runPipeline = mockRunPipeline;
  },
  listRecentArtifacts: vi.fn().mockReturnValue([]),
}));

vi.mock('@features/execute/gap-bridger.js', () => ({
  GapBridger: class MockGapBridger {
    bridge = mockBridgeGaps;
  },
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
    mkdirSync(join(kataDir, 'kataka'), { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRunStage.mockResolvedValue(makeSingleResult());
    mockRunPipeline.mockResolvedValue(makePipelineResult(['build', 'review']));
    mockBridgeGaps.mockReturnValue({ blocked: [], bridged: [] });
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

  function registerAgent(id: string, name = 'Test Agent'): void {
    writeFileSync(
      join(kataDir, 'kataka', `${id}.json`),
      JSON.stringify({
        id,
        name,
        role: 'executor',
        skills: [],
        createdAt: new Date().toISOString(),
        active: true,
      }, null, 2),
    );
  }

  function writeInvalidAgentRecord(id: string): void {
    writeFileSync(
      join(kataDir, 'kataka', `${id}.json`),
      JSON.stringify({
        id,
        active: true,
      }, null, 2),
    );
  }

  function createCycleWithBets(
    name = 'CLI Cycle',
    bets: Array<{ description: string; appetite: number; outcome?: 'pending' | 'complete' | 'partial' | 'abandoned' }> = [
      { description: 'CLI bet', appetite: 30, outcome: 'pending' },
    ],
  ) {
    const manager = new CycleManager(join(kataDir, 'cycles'), JsonStore);
    let cycle = manager.create({ tokenBudget: 100000 }, name);

    for (const bet of bets) {
      cycle = manager.addBet(cycle.id, {
        description: bet.description,
        appetite: bet.appetite,
        outcome: bet.outcome ?? 'pending',
        issueRefs: [],
      });
    }

    return manager.get(cycle.id);
  }

  function prepareRunForBet(betId: string, agentId?: string) {
    const bridge = new SessionExecutionBridge(kataDir);
    return bridge.prepare(betId, agentId);
  }

  describe('status and stats delegation', () => {
    it('delegates execute status to handleStatus', async () => {
      const statusModule = await import('./status.js');
      const handleStatus = vi.mocked(statusModule.handleStatus);
      const program = createProgram();

      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'status']);

      expect(handleStatus).toHaveBeenCalledTimes(1);
      expect(handleStatus).toHaveBeenCalledWith(expect.objectContaining({ kataDir }));
    });

    it('delegates execute stats with the parsed category filter', async () => {
      const statusModule = await import('./status.js');
      const handleStats = vi.mocked(statusModule.handleStats);
      const parseCategoryFilter = vi.mocked(statusModule.parseCategoryFilter);
      parseCategoryFilter.mockReturnValueOnce('build');
      const program = createProgram();

      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'stats', '--category', 'build']);

      expect(parseCategoryFilter).toHaveBeenCalledWith('build');
      expect(handleStats).toHaveBeenCalledWith(expect.objectContaining({ kataDir }), 'build');
    });

    it('sets exitCode when execute stats receives an invalid category filter', async () => {
      const statusModule = await import('./status.js');
      const handleStats = vi.mocked(statusModule.handleStats);
      const parseCategoryFilter = vi.mocked(statusModule.parseCategoryFilter);
      parseCategoryFilter.mockReturnValueOnce(false);
      const program = createProgram();

      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'stats', '--gyo', 'bad']);

      expect(process.exitCode).toBe(1);
      expect(handleStats).not.toHaveBeenCalled();
    });
  });

  describe('cycle subcommand', () => {
    it('registers execute, stats, status, and cycle command descriptions and options', () => {
      const program = createProgram();
      const executeCmd = program.commands.find((c) => c.name() === 'execute');
      expect(executeCmd).toBeDefined();
      expect(executeCmd!.description()).toBe('Run stage orchestration — select and execute flavors (alias: kiai)');

      const statusCmd = executeCmd!.commands.find((c) => c.name() === 'status');
      expect(statusCmd).toBeDefined();
      expect(statusCmd!.description()).toBe('Show project status (same as "kata status")');

      const statsCmd = executeCmd!.commands.find((c) => c.name() === 'stats');
      expect(statsCmd).toBeDefined();
      expect(statsCmd!.description()).toBe('Show analytics (same as "kata stats")');
      expect(statsCmd!.options.find((o) => o.long === '--category')?.description).toBe('Filter stats by stage category');
      expect(statsCmd!.options.find((o) => o.long === '--gyo')?.description).toBe('Filter stats by stage category (alias)');

      const cycleCmd = executeCmd!.commands.find((c) => c.name() === 'cycle');
      expect(cycleCmd).toBeDefined();
      expect(cycleCmd!.description()).toBe('Session bridge — prepare, monitor, or complete a cycle for in-session agent execution');
      expect(cycleCmd!.options.find((o) => o.long === '--prepare')?.description).toBe('Prepare all pending bets in the cycle for agent dispatch');
      expect(cycleCmd!.options.find((o) => o.long === '--status')?.description).toBe('Get aggregated status of all runs in the cycle');
      expect(cycleCmd!.options.find((o) => o.long === '--complete')?.description).toBe('Complete all in-progress runs in the cycle');
      expect(cycleCmd!.options.find((o) => o.long === '--agent')?.description).toBe('Agent ID to attribute all prepared runs to (only used with --prepare)');
      expect(cycleCmd!.options.find((o) => o.long === '--kataka')?.description).toBe('Alias for --agent <id>');
      expect(cycleCmd!.options.find((o) => o.long === '--json')?.description).toBe('Output as JSON');
    });

    it('prepares all pending bets for session execution', async () => {
      const cycle = createCycleWithBets('Dispatch Cycle', [
        { description: 'Bet A', appetite: 20 },
        { description: 'Bet B', appetite: 35 },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--prepare',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Prepared 2 run(s)');
      expect(output).toContain('Bet A');
      expect(output).toContain('Run ID:');
      expect(output).toContain('Isolation:');

      const bridgeRunsDir = join(kataDir, 'bridge-runs');
      const files = existsSync(bridgeRunsDir)
        ? readdirSync(bridgeRunsDir).filter((file) => file.endsWith('.json'))
        : [];
      expect(files).toHaveLength(2);
    });

    it('forwards --kataka when preparing a cycle', async () => {
      const cycle = createCycleWithBets('Attributed Cycle', [
        { description: 'Attributed bet', appetite: 20 },
      ]);
      const agentId = randomUUID();
      registerAgent(agentId, 'Cycle Agent');

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--prepare', '--kataka', agentId,
      ]);

      const bridgeRunFiles = readdirSync(join(kataDir, 'bridge-runs')).filter((file) => file.endsWith('.json'));
      expect(bridgeRunFiles).toHaveLength(1);

      const meta = JSON.parse(readFileSync(join(kataDir, 'bridge-runs', bridgeRunFiles[0]!), 'utf-8')) as {
        runId: string;
        agentId?: string;
        katakaId?: string;
      };
      expect(meta.agentId).toBe(agentId);
      expect(meta.katakaId).toBe(agentId);

      const run = JSON.parse(readFileSync(join(kataDir, 'runs', meta.runId, 'run.json'), 'utf-8')) as {
        agentId?: string;
        katakaId?: string;
      };
      expect(run.agentId).toBe(agentId);
      expect(run.katakaId).toBe(agentId);
    });

    it('rejects an unknown agent when preparing a cycle', async () => {
      const cycle = createCycleWithBets('Missing Agent Cycle', [
        { description: 'Unattributed bet', appetite: 20 },
      ]);
      const missingAgentId = randomUUID();

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--prepare', '--agent', missingAgentId,
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain(`agent "${missingAgentId}" not found`);
    });

    it('renders cycle status with budget and activity counts', async () => {
      const cycle = createCycleWithBets('Status Cycle', [
        { description: 'Observed bet', appetite: 25 },
      ]);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepareCycle(cycle.id);
      const runId = prepared.preparedRuns[0]!.runId;

      writeFileSync(join(kataDir, 'runs', runId, 'observations.jsonl'), '{"note":"obs1"}\n{"note":"obs2"}\n');
      writeFileSync(join(kataDir, 'runs', runId, 'artifacts.jsonl'), '{"name":"artifact"}\n');
      writeFileSync(join(kataDir, 'runs', runId, 'decisions.jsonl'), '{"decision":"ship"}\n');
      writeFileSync(
        join(kataDir, 'history', `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'build',
          stageIndex: 0,
          adapter: 'manual',
          cycleId: cycle.id,
          tokenUsage: { total: 3000 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Cycle "Status Cycle"');
      expect(output).toContain('Budget: 3% used (~3000 tokens)');
      expect(output).toContain('kansatsu: 2, maki: 1, kime: 1');
    });

    it('renders pending, complete, and failed status markers for cycle bets', async () => {
      const cycle = createCycleWithBets('Marker Cycle', [
        { description: 'Prepared success', appetite: 20 },
        { description: 'Prepared failure', appetite: 20 },
        { description: 'Still pending', appetite: 20 },
      ]);
      const bridge = new SessionExecutionBridge(kataDir);
      const successRun = bridge.prepare(cycle.bets[0]!.id);
      const failedRun = bridge.prepare(cycle.bets[1]!.id);
      bridge.complete(successRun.runId, { success: true });
      bridge.complete(failedRun.runId, { success: false });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--status']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('✓ Prepared success [complete]');
      expect(output).toContain('✗ Prepared failure [failed]');
      expect(output).toContain('· Still pending [pending]');
    });

    it('completes a prepared cycle and emits json when requested', async () => {
      const cycle = createCycleWithBets('Complete Cycle', [
        { description: 'Bet A', appetite: 20 },
        { description: 'Bet B', appetite: 20 },
      ]);
      const bridge = new SessionExecutionBridge(kataDir);
      bridge.prepareCycle(cycle.id);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--complete']);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.cycleId).toBe(cycle.id);
      expect(parsed.completedBets).toBe(2);
      expect(parsed.totalBets).toBe(2);
    });

    it('includes persisted token usage when a run was already completed before execute cycle --complete', async () => {
      const cycle = createCycleWithBets('Persisted Token Cycle', [
        { description: 'Bet A', appetite: 20 },
        { description: 'Bet B', appetite: 20 },
      ]);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepareCycle(cycle.id);
      bridge.complete(prepared.preparedRuns[0]!.runId, {
        success: true,
        tokenUsage: { inputTokens: 10, outputTokens: 5, total: 15 },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--complete']);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.completedBets).toBe(2);
      expect(parsed.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, total: 15 });
    });

    it('emits prepared cycle data as json when requested', async () => {
      const cycle = createCycleWithBets('JSON Cycle', [
        { description: 'JSON bet', appetite: 20 },
      ]);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--prepare',
      ]);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.cycleId).toBe(cycle.id);
      expect(parsed.preparedRuns).toHaveLength(1);
    });

    it('emits cycle status as json when local --json is provided', async () => {
      const cycle = createCycleWithBets('Local Json Status', [
        { description: 'Observed bet', appetite: 25 },
      ]);
      const bridge = new SessionExecutionBridge(kataDir);
      bridge.prepareCycle(cycle.id);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id, '--status', '--json']);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.cycleId).toBe(cycle.id);
      expect(parsed.bets).toHaveLength(1);
    });

    it('requires an action flag for execute cycle', async () => {
      const cycle = createCycleWithBets();

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'cycle', cycle.id]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Specify one of');
    });
  });

  describe('complete subcommand', () => {
    it('marks a run failed and reports token usage as json', async () => {
      const cycle = createCycleWithBets('Single Run Cycle', [
        { description: 'Run me', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--failed',
        '--artifacts', '[{"name":"report.md"}]',
        '--input-tokens', '10',
        '--output-tokens', '5',
        '--json',
      ]);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.status).toBe('failed');
      expect(parsed.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, total: 15 });

      const runJson = JSON.parse(readFileSync(join(kataDir, 'runs', prepared.runId, 'run.json'), 'utf-8'));
      expect(runJson.status).toBe('failed');
      expect(runJson.tokenUsage.totalTokens).toBe(15);
    });

    it('rejects invalid artifact payloads', async () => {
      const cycle = createCycleWithBets('Artifact Error Cycle', [
        { description: 'Bad artifact run', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--artifacts', '{"name":"oops"}',
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('JSON array');
    });

    it('rejects artifact entries without a string name', async () => {
      const cycle = createCycleWithBets('Artifact Shape Cycle', [
        { description: 'Bad artifact item', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--artifacts', '[{"path":"report.md"}]',
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('"name" string property');
    });

    it('rejects negative token counts', async () => {
      const cycle = createCycleWithBets('Token Error Cycle', [
        { description: 'Bad token run', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--input-tokens', '-1',
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('non-negative integer');
    });

    it('accepts zero token counts and reports them exactly', async () => {
      const cycle = createCycleWithBets('Zero Token Cycle', [
        { description: 'Zero token run', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--input-tokens', '0',
        '--output-tokens', '0',
        '--json',
      ]);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.tokenUsage).toEqual({ inputTokens: 0, outputTokens: 0, total: 0 });
    });

    it('prints plain-text token usage when only one token side is provided', async () => {
      const cycle = createCycleWithBets('Partial Token Cycle', [
        { description: 'One-sided token run', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--input-tokens', '7',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Run');
      expect(output).toContain('marked as complete');
      expect(output).toContain('tokens: 7 total, 7 in, 0 out');
    });

    it('rejects null artifact entries', async () => {
      const cycle = createCycleWithBets('Artifact Null Cycle', [
        { description: 'Bad artifact item', appetite: 20 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'complete', prepared.runId,
        '--artifacts', '[null]',
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('"name" string property');
    });
  });

  describe('prepare subcommand', () => {
    it('renders prepared run details and the agent context block in plain text mode', async () => {
      const cycle = createCycleWithBets('Prepare Text Cycle', [
        { description: 'Prepared bet', appetite: 20 },
      ]);
      const previousKataDir = process.env['KATA_DIR'];
      process.env['KATA_DIR'] = kataDir;

      try {
        const program = createProgram();
        const executeCmd = program.commands.find((command) => command.name() === 'execute');
        const prepareCmd = executeCmd?.commands.find((command) => command.name() === 'prepare');
        await prepareCmd?.parseAsync(['node', 'test', '--bet', cycle.bets[0]!.id]);
      } finally {
        if (previousKataDir === undefined) {
          delete process.env['KATA_DIR'];
        } else {
          process.env['KATA_DIR'] = previousKataDir;
        }
      }

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Prepared run for bet: "Prepared bet"');
      expect(output).toContain('Run ID:');
      expect(output).toContain('Agent context block');
    });

    it('emits prepared run data as json when local --json is provided', async () => {
      const cycle = createCycleWithBets('Prepare Json Cycle', [
        { description: 'Prepared bet', appetite: 20 },
      ]);
      const previousKataDir = process.env['KATA_DIR'];
      process.env['KATA_DIR'] = kataDir;

      try {
        const program = createProgram();
        const executeCmd = program.commands.find((command) => command.name() === 'execute');
        const prepareCmd = executeCmd?.commands.find((command) => command.name() === 'prepare');
        await prepareCmd?.parseAsync(['node', 'test', '--bet', cycle.bets[0]!.id, '--json']);
      } finally {
        if (previousKataDir === undefined) {
          delete process.env['KATA_DIR'];
        } else {
          process.env['KATA_DIR'] = previousKataDir;
        }
      }

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.betId).toBe(cycle.bets[0]!.id);
      expect(parsed.runId).toBeTruthy();
      expect(parsed.stages).toContain('build');
    });

    it('reports agent load failures separately from missing-agent errors', async () => {
      const cycle = createCycleWithBets('Prepare Invalid Agent Cycle', [
        { description: 'Prepared bet', appetite: 20 },
      ]);
      const invalidAgentId = '11111111-1111-4111-8111-111111111111';
      writeInvalidAgentRecord(invalidAgentId);
      const previousKataDir = process.env['KATA_DIR'];
      process.env['KATA_DIR'] = kataDir;

      try {
        const program = createProgram();
        const executeCmd = program.commands.find((command) => command.name() === 'execute');
        const prepareCmd = executeCmd?.commands.find((command) => command.name() === 'prepare');
        await prepareCmd?.parseAsync(['node', 'test', '--bet', cycle.bets[0]!.id, '--agent', invalidAgentId]);
      } finally {
        if (previousKataDir === undefined) {
          delete process.env['KATA_DIR'];
        } else {
          process.env['KATA_DIR'] = previousKataDir;
        }
      }

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain(`Failed to load agent "${invalidAgentId}"`);
    });
  });

  describe('context subcommand', () => {
    it('renders agent context through the context subcommand', async () => {
      const cycle = createCycleWithBets('Context Cycle', [
        { description: 'Explain the run', appetite: 25 },
      ]);
      const prepared = prepareRunForBet(cycle.bets[0]!.id);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir, 'execute', 'context', prepared.runId,
      ]);

      const parsed = JSON.parse(consoleSpy.mock.calls[0]?.[0] as string);
      expect(parsed.runId).toBe(prepared.runId);
      expect(parsed.agentContext).toContain(`**Run ID**: ${prepared.runId}`);
      expect(parsed.agentContext).toContain(`**Bet ID**: ${prepared.betId}`);
    });
  });

  describe('hidden backward-compatible execute commands', () => {
    it('routes execute run through single-stage execution', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'run', 'build']);

      expect(mockRunStage).toHaveBeenCalledWith('build', expect.anything());
    });

    it('routes execute pipeline through multi-stage execution', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'pipeline', 'build', 'review']);

      expect(mockRunPipeline).toHaveBeenCalledWith(['build', 'review'], expect.anything());
    });

    it('merges --pin and --ryu flags for the hidden execute run alias', async () => {
      const previousKataDir = process.env['KATA_DIR'];
      process.env['KATA_DIR'] = kataDir;

      try {
        const program = createProgram();
        const executeCmd = program.commands.find((command) => command.name() === 'execute');
        const runCmd = executeCmd?.commands.find((command) => command.name() === 'run');
        await runCmd?.parseAsync([
          'node', 'test', 'build',
          '--pin', 'legacy-build',
          '--ryu', 'typescript-tdd',
        ]);
      } finally {
        if (previousKataDir === undefined) {
          delete process.env['KATA_DIR'];
        } else {
          process.env['KATA_DIR'] = previousKataDir;
        }
      }

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ pin: expect.arrayContaining(['legacy-build', 'typescript-tdd']) }),
      );
    });
  });

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

    it('ignores non-json files in the katas directory', async () => {
      const kata = { name: 'my-kata', stages: ['build', 'review'] };
      writeFileSync(join(kataDir, 'katas', 'my-kata.json'), JSON.stringify(kata, null, 2));
      writeFileSync(join(kataDir, 'katas', 'notes.txt'), 'ignore me');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('my-kata');
      expect(output).not.toContain('notes.txt');
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

    it('warns and skips kata files with invalid structure', async () => {
      writeFileSync(join(kataDir, 'katas', 'broken-structure.json'), JSON.stringify({ name: 'broken-structure' }, null, 2));
      writeFileSync(join(kataDir, 'katas', 'good-kata.json'), JSON.stringify({ name: 'good-kata', stages: ['plan'] }, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--list-katas']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      const errors = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('good-kata');
      expect(errors).toContain('skipping invalid kata file "broken-structure.json"');
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

    it('reports an invalid kata-name error before any file lookup for trailing separators', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--delete-kata', 'safe/']);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Invalid kata name "safe/"');
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

  describe('--hint', () => {
    it('passes parsed flavor hints through to execution', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build',
        '--hint', 'build:typescript-tdd,reviewer:restrict',
      ]);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({
          flavorHints: {
            build: { recommended: ['typescript-tdd', 'reviewer'], strategy: 'restrict' },
          },
        }),
      );
    });

    it('sets exitCode=1 for invalid hint format', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build',
        '--hint', 'build-only',
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('invalid --hint format');
      expect(mockRunStage).not.toHaveBeenCalled();
    });
  });

  describe('--agent', () => {
    it('passes canonical agent attribution to single-stage execution', async () => {
      const agentId = '11111111-1111-4111-8111-111111111111';
      registerAgent(agentId);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build', '--agent', agentId,
      ]);

      expect(mockRunStage).toHaveBeenCalledWith(
        'build',
        expect.objectContaining({ agentId, katakaId: agentId }),
      );
    });

    it('reports invalid agent records as load failures', async () => {
      const agentId = '22222222-2222-4222-8222-222222222222';
      writeInvalidAgentRecord(agentId);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'execute', 'build', '--agent', agentId,
      ]);

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain(`Failed to load agent "${agentId}"`);
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

    it('shows dry-run notice in output for a pipeline', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', 'review', '--dry-run']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Pipeline: build -> review');
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

    it('captures bridged gaps for a single-stage run', async () => {
      const incrementGapsClosed = vi.spyOn(ProjectStateUpdater, 'incrementGapsClosed').mockImplementation(() => {});
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        gaps: [{ description: 'Missing validation', severity: 'medium' }],
      });
      mockBridgeGaps.mockReturnValue({
        blocked: [],
        bridged: [{ description: 'Missing validation', severity: 'medium' }],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--bridge-gaps']);

      expect(mockBridgeGaps).toHaveBeenCalledWith([
        expect.objectContaining({ description: 'Missing validation' }),
      ]);
      expect(consoleSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Captured 1 gap(s) as step-tier learnings.');
      expect(incrementGapsClosed).toHaveBeenCalledWith(join(kataDir, 'project-state.json'), 1);
    });

    it('blocks pipeline execution when bridged gaps include high-severity blockers', async () => {
      mockRunPipeline.mockResolvedValue({
        ...makePipelineResult(['build', 'review']),
        stageResults: [
          { ...makeSingleResult('build'), gaps: [{ description: 'Prod access missing', severity: 'high' }] },
          { ...makeSingleResult('review'), gaps: [] },
        ],
      });
      mockBridgeGaps.mockReturnValue({
        blocked: [{ description: 'Prod access missing', severity: 'high' }],
        bridged: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', 'review', '--bridge-gaps']);

      expect(errorSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Blocked by 1 high-severity gap(s)');
      expect(process.exitCode).toBe(1);
    });

    it('captures bridged gaps for a pipeline when no blockers remain', async () => {
      const incrementGapsClosed = vi.spyOn(ProjectStateUpdater, 'incrementGapsClosed').mockImplementation(() => {});
      mockRunPipeline.mockResolvedValue({
        ...makePipelineResult(['build', 'review']),
        stageResults: [
          { ...makeSingleResult('build'), gaps: [{ description: 'Document fallback', severity: 'medium' }] },
          { ...makeSingleResult('review'), gaps: [{ description: 'Clarify rollout', severity: 'low' }] },
        ],
      });
      mockBridgeGaps.mockReturnValue({
        blocked: [],
        bridged: [
          { description: 'Document fallback', severity: 'medium' },
          { description: 'Clarify rollout', severity: 'low' },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', 'review', '--bridge-gaps']);

      expect(mockBridgeGaps).toHaveBeenCalledWith([
        expect.objectContaining({ description: 'Document fallback' }),
        expect.objectContaining({ description: 'Clarify rollout' }),
      ]);
      expect(consoleSpy.mock.calls.map((c) => c[0]).join('\n')).toContain('Captured 2 gap(s) as step-tier learnings.');
      expect(incrementGapsClosed).toHaveBeenCalledWith(join(kataDir, 'project-state.json'), 2);
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

  // ---- --explain ----

  describe('--explain', () => {
    it('registers --explain option on the execute command', () => {
      const program = createProgram();
      const executeCmd = program.commands.find((c) => c.name() === 'execute');
      expect(executeCmd).toBeDefined();
      const explainOpt = executeCmd!.options.find((o) => o.long === '--explain');
      expect(explainOpt).toBeDefined();
    });

    it('prints flavor scoring breakdown for a single stage when --explain is set', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: [
          {
            flavorName: 'typescript-tdd',
            score: 0.87,
            keywordHits: 3,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'Score 0.87: 3 keyword hit(s), learning boost 0.00, rule adj 0.00.',
          },
          {
            flavorName: 'quick-fix',
            score: 0.42,
            keywordHits: 1,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'Score 0.42: 1 keyword hit(s), learning boost 0.00, rule adj 0.00.',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Flavor scoring for stage: build');
      expect(output).toContain('typescript-tdd');
      expect(output).toContain('0.87');
      expect(output).toContain('<- selected');
      expect(output).toContain('quick-fix');
      expect(output).toContain('0.42');
    });

    it('still prints normal stage output after the explain block', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: [
          {
            flavorName: 'typescript-tdd',
            score: 0.87,
            keywordHits: 3,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'Score 0.87: 3 keyword hit(s).',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Stage: build');
      expect(output).toContain('Selected flavors: typescript-tdd');
    });

    it('prints scoring breakdown for each stage in a multi-stage pipeline when --explain is set', async () => {
      mockRunPipeline.mockResolvedValue({
        stageResults: [
          {
            stageCategory: 'research',
            selectedFlavors: ['deep-dive'],
            executionMode: 'sequential',
            stageArtifact: { name: 'research-synthesis', content: 'output', timestamp: new Date().toISOString() },
            decisions: [],
            matchReports: [
              {
                flavorName: 'deep-dive',
                score: 0.75,
                keywordHits: 2,
                ruleAdjustments: 0,
                learningBoost: 0,
                reasoning: 'Score 0.75: 2 keyword hit(s).',
              },
            ],
          },
          {
            stageCategory: 'build',
            selectedFlavors: ['typescript-tdd'],
            executionMode: 'sequential',
            stageArtifact: { name: 'build-synthesis', content: 'output', timestamp: new Date().toISOString() },
            decisions: [],
            matchReports: [
              {
                flavorName: 'typescript-tdd',
                score: 0.90,
                keywordHits: 4,
                ruleAdjustments: 0.1,
                learningBoost: 0.1,
                reasoning: 'Score 0.90: 4 keyword hit(s), learning boost 0.10, rule adj 0.10.',
              },
            ],
          },
        ],
        pipelineReflection: { overallQuality: 'good', learnings: [] },
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'research', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Flavor scoring for stage: research');
      expect(output).toContain('Flavor scoring for stage: build');
      expect(output).toContain('deep-dive');
      expect(output).toContain('typescript-tdd');
    });

    it('prints fallback message when matchReports is absent (pinned/no-vocabulary)', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: undefined,
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Flavor scoring for stage: build');
      expect(output).toContain('no scoring data');
    });

    it('prints learning boost and rule adjustments when non-zero', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: [
          {
            flavorName: 'typescript-tdd',
            score: 0.90,
            keywordHits: 2,
            ruleAdjustments: 0.15,
            learningBoost: 0.10,
            reasoning: 'Score 0.90: 2 keyword hit(s), learning boost 0.10, rule adj 0.15.',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('learning boost');
      expect(output).toContain('rule adjustments');
    });

    it('omits zero-score losers from scoring factors when a positive winner exists', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: [
          {
            flavorName: 'typescript-tdd',
            score: 0.90,
            keywordHits: 3,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'winning flavor',
          },
          {
            flavorName: 'zero-loser',
            score: 0,
            keywordHits: 0,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'should be filtered',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build', '--explain']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('zero-loser');
      expect(output).toContain('score: 0.00');
      expect(output).not.toContain('zero-loser:');
    });

    it('does not print explain block when --explain is not set', async () => {
      mockRunStage.mockResolvedValue({
        ...makeSingleResult('build'),
        matchReports: [
          {
            flavorName: 'typescript-tdd',
            score: 0.87,
            keywordHits: 3,
            ruleAdjustments: 0,
            learningBoost: 0,
            reasoning: 'Score 0.87.',
          },
        ],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', 'build']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Flavor scoring for stage');
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

    it('suppresses the auto-selected banner when --json is enabled', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Json Cycle');
      const withBet = manager.addBet(cycle.id, {
        description: 'JSON bet', appetite: 30, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'ad-hoc', stages: ['build'] } });
      manager.updateState(cycle.id, 'active');

      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'execute', '--next']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).not.toContain('Auto-selected bet');
      expect(() => JSON.parse(output)).not.toThrow();
    });

    it('uses the cycle id in the auto-selected banner when the active cycle has no name', async () => {
      mkdirSync(cyclesDir, { recursive: true });
      const manager = new CycleManager(cyclesDir, JsonStore);
      const cycle = manager.create({ tokenBudget: 50000 }, 'Named Then Removed');
      const withBet = manager.addBet(cycle.id, {
        description: 'Unnamed cycle bet', appetite: 25, outcome: 'pending', issueRefs: [],
      });
      manager.updateBet(cycle.id, withBet.bets[0]!.id, { kata: { type: 'ad-hoc', stages: ['build'] } });
      manager.updateState(cycle.id, 'active');

      const cyclePath = join(cyclesDir, `${cycle.id}.json`);
      const stored = JSON.parse(readFileSync(cyclePath, 'utf-8')) as Record<string, unknown>;
      delete stored['name'];
      writeFileSync(cyclePath, JSON.stringify(stored, null, 2));

      mockRunStage.mockResolvedValue(makeSingleResult('build'));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'execute', '--next']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain(`(cycle: ${cycle.id})`);
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
