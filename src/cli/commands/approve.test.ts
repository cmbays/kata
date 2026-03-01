import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerApproveCommand } from './approve.js';
import { createRunTree, readStageState, writeStageState } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

// Mock @inquirer/prompts to avoid interactive prompts in tests
vi.mock('@inquirer/prompts', () => ({
  checkbox: vi.fn().mockResolvedValue([]),
}));

function tempBase(): string {
  return join(tmpdir(), `kata-approve-test-${randomUUID()}`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Implement auth',
    stageSequence: ['research', 'plan'],
    currentStage: null,
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerApproveCommand', () => {
  let baseDir: string;
  let kataDir: string;
  let runsDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = tempBase();
    kataDir = join(baseDir, '.kata');
    runsDir = join(kataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
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
    registerApproveCommand(program);
    return program;
  }

  it('registers hai as an alias for the approve command', () => {
    const program = createProgram();
    const approveCmd = program.commands.find((c) => c.name() === 'approve');
    expect(approveCmd).toBeDefined();
    expect(approveCmd!.alias()).toBe('hai');
  });

  it('returns empty array when no pending gates exist', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'approve']);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output).toEqual([]);
  });

  it('shows "No pending gates." message in non-JSON mode', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'approve']);

    expect(consoleSpy).toHaveBeenCalledWith('No pending gates.');
  });

  it('approves a gate by gate-id', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Write a pending gate to stage state
    const stageState = readStageState(runsDir, run.id, 'research');
    stageState.pendingGate = {
      gateId: 'gate-abc123',
      gateType: 'human-approved',
      requiredBy: 'stage',
    };
    writeStageState(runsDir, run.id, stageState);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'approve', 'gate-abc123',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output).toHaveLength(1);
    expect(output[0].gateId).toBe('gate-abc123');
    expect(output[0].gateType).toBe('human-approved');
    expect(output[0].approver).toBe('human');
    expect(output[0].runId).toBe(run.id);
    expect(output[0].stage).toBe('research');
  });

  it('approves a gate with --agent flag', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const stageState = readStageState(runsDir, run.id, 'research');
    stageState.pendingGate = {
      gateId: 'gate-agent-test',
      gateType: 'confidence-gate',
      requiredBy: 'research-flavor',
    };
    writeStageState(runsDir, run.id, stageState);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'approve', 'gate-agent-test', '--agent',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output[0].approver).toBe('agent');
  });

  it('clears pendingGate and moves to approvedGates after approval', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const stageState = readStageState(runsDir, run.id, 'plan');
    stageState.pendingGate = {
      gateId: 'gate-plan-001',
      gateType: 'human-approved',
      requiredBy: 'stage',
    };
    writeStageState(runsDir, run.id, stageState);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'approve', 'gate-plan-001',
    ]);

    const updatedState = readStageState(runsDir, run.id, 'plan');
    expect(updatedState.pendingGate).toBeUndefined();
    expect(updatedState.approvedGates).toHaveLength(1);
    expect(updatedState.approvedGates[0]!.gateId).toBe('gate-plan-001');
  });

  it('errors when gate ID is not found', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'approve', 'nonexistent-gate',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"nonexistent-gate" not found'));
  });

  it('scopes gate search to --run when provided', async () => {
    const run1 = makeRun();
    const run2 = makeRun();
    createRunTree(runsDir, run1);
    createRunTree(runsDir, run2);

    // Gate on run2
    const stageState = readStageState(runsDir, run2.id, 'research');
    stageState.pendingGate = {
      gateId: 'gate-run2-only',
      gateType: 'human-approved',
      requiredBy: 'stage',
    };
    writeStageState(runsDir, run2.id, stageState);

    // Approve scoped to run1 — should not find the gate on run2
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'approve', 'gate-run2-only', '--run', run1.id,
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('skips gracefully when gate is already cleared (race condition)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Set gate so findPendingGates picks it up
    const stageState = readStageState(runsDir, run.id, 'research');
    stageState.pendingGate = {
      gateId: 'gate-race',
      gateType: 'human-approved',
      requiredBy: 'stage',
    };
    writeStageState(runsDir, run.id, stageState);

    // Simulate race: clear the gate before the approve loop reads it
    const clearedState = readStageState(runsDir, run.id, 'research');
    clearedState.pendingGate = undefined;
    writeStageState(runsDir, run.id, clearedState);

    // Approve by gate-id — gate is now gone, should report no gates approved
    const program = createProgram();
    // findPendingGates scans from disk — gate is already cleared, so it won't find it
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'approve', 'gate-race',
    ]);

    // Gate not found error because pendingGate was already cleared
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('handles no runs directory without error (returns no pending gates)', async () => {
    // Use a fresh kataDir with no runs/ directory
    const freshBase = join(tmpdir(), `kata-approve-fresh-${randomUUID()}`);
    const freshKataDir = join(freshBase, '.kata');
    mkdirSync(freshKataDir, { recursive: true });

    const consoleSpy2 = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', freshBase, 'approve']);

      const output = JSON.parse(consoleSpy2.mock.calls[0]![0] as string);
      expect(output).toEqual([]);
    } finally {
      consoleSpy2.mockRestore();
      rmSync(freshBase, { recursive: true, force: true });
    }
  });
});
