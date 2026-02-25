import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerGateCommands } from './gate.js';
import {
  createRunTree,
  readStageState,
  writeStageState,
} from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

function tempBase(): string {
  return join(tmpdir(), `kata-gate-test-${randomUUID()}`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Build feature',
    stageSequence: ['plan', 'build'],
    currentStage: 'plan',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerGateCommands', () => {
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
    registerGateCommands(program);
    return program;
  }

  describe('gate set', () => {
    it('sets a pending gate on a running stage', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      // Stage must be running
      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'gate-plan-review',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.gateId).toBe('gate-plan-review');
      expect(output.gateType).toBe('human-approved');
      expect(output.stage).toBe('plan');
      expect(output.runId).toBe(run.id);

      const updatedState = readStageState(runsDir, run.id, 'plan');
      expect(updatedState.pendingGate?.gateId).toBe('gate-plan-review');
      expect(updatedState.pendingGate?.gateType).toBe('human-approved');
      expect(updatedState.pendingGate?.requiredBy).toBe('stage');
    });

    it('uses custom gate type when --type provided', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'my-gate', '--type', 'confidence-gate',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.gateType).toBe('confidence-gate');

      const updatedState = readStageState(runsDir, run.id, 'plan');
      expect(updatedState.pendingGate?.gateType).toBe('confidence-gate');
    });

    it('prints non-JSON message with approval hint', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'gate-abc',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('gate-abc'));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('kata approve gate-abc'));
    });

    it('errors when stage is not running (pending)', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);
      // Stage is 'pending' by default after createRunTree

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'gate-fail',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('errors when a pending gate is already set', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      stageState.pendingGate = {
        gateId: 'existing-gate',
        gateType: 'human-approved',
        requiredBy: 'stage',
      };
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'new-gate',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('existing-gate'));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('kata approve'));
    });

    it('warns but allows setting a gate already in approvedGates', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      stageState.approvedGates = [{
        gateId: 'already-approved',
        gateType: 'human-approved',
        requiredBy: 'stage',
        approvedAt: '2026-01-01T00:00:00.000Z',
        approver: 'human',
      }];
      writeStageState(runsDir, run.id, stageState);

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'plan', '--gate-id', 'already-approved',
      ]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already approved'));
      warnSpy.mockRestore();

      // Gate should still be set
      const updatedState = readStageState(runsDir, run.id, 'plan');
      expect(updatedState.pendingGate?.gateId).toBe('already-approved');
    });

    it('errors on invalid stage category', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'invalid', '--gate-id', 'gate-x',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid stage category'));
    });

    it('errors when stage is not initialized', async () => {
      const run = makeRun({ stageSequence: ['plan', 'build'] });
      createRunTree(runsDir, run);

      // Manually remove the build state.json to simulate uninitialized state
      const { rmSync: rmS } = await import('node:fs');
      const buildStatePath = join(runsDir, run.id, 'stages', 'build', 'state.json');
      rmS(buildStatePath, { force: true });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'build', '--gate-id', 'gate-x',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not initialized'));
    });

    it('errors when stage is not in the run stageSequence', async () => {
      const run = makeRun({ stageSequence: ['plan'] });
      createRunTree(runsDir, run);

      // 'research' is a valid category but not in this run's sequence
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', run.id,
        '--stage', 'research', '--gate-id', 'gate-x',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not in the sequence'));
    });

    it('errors when run does not exist', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'gate', 'set', randomUUID(),
        '--stage', 'plan', '--gate-id', 'gate-x',
      ]);

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
