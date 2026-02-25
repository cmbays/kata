import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerRunCommands } from './run.js';
import { registerDecisionCommands } from './decision.js';
import { createRunTree, writeStageState, runPaths } from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

function tempBase(): string {
  return join(tmpdir(), `kata-run-test-${randomUUID()}`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Implement auth',
    kataPattern: 'full-feature',
    stageSequence: ['research', 'plan', 'build'],
    currentStage: 'research',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerRunCommands — run status', () => {
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
    registerRunCommands(program);
    return program;
  }

  it('outputs human-readable status for a fresh run', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'run', 'status', run.id]);

    expect(consoleSpy).toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain(run.id);
    expect(output).toContain('full-feature');
    expect(output).toContain('RESEARCH');
    expect(output).toContain('PLAN');
    expect(output).toContain('BUILD');
  });

  it('outputs JSON status with --json flag', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'run', 'status', run.id]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.run.id).toBe(run.id);
    expect(parsed.stages).toHaveLength(3);
    expect(parsed.stages.map((s: { category: string }) => s.category)).toEqual(['research', 'plan', 'build']);
    expect(parsed.totalDecisions).toBe(0);
    expect(parsed.totalArtifacts).toBe(0);
  });

  it('shows stage status in JSON output', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Advance research stage
    writeStageState(runsDir, run.id, {
      category: 'research',
      status: 'running',
      selectedFlavors: ['technical-research', 'codebase-analysis'],
      executionMode: 'parallel',
      gaps: [{ description: 'No security flavor', severity: 'medium' as const }],
      decisions: [],
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'run', 'status', run.id]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    const researchStage = parsed.stages.find((s: { category: string }) => s.category === 'research');
    expect(researchStage.status).toBe('running');
    expect(researchStage.executionMode).toBe('parallel');
    expect(researchStage.selectedFlavors).toEqual(['technical-research', 'codebase-analysis']);
    expect(researchStage.gaps).toEqual([{ description: 'No security flavor', severity: 'medium' }]);
  });

  it('shows decisions with confidence in JSON output when decisions exist', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Record a decision via the decision command
    const decisionProgram = new Command();
    decisionProgram.option('--json').option('--verbose').option('--cwd <path>');
    decisionProgram.exitOverride();
    registerDecisionCommands(decisionProgram);

    await decisionProgram.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a","b"]',
      '--selected', 'a',
      '--confidence', '0.85',
      '--reasoning', 'Test',
    ]);

    consoleSpy.mockClear();

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'run', 'status', run.id]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.totalDecisions).toBe(1);
    const researchStage = parsed.stages.find((s: { category: string }) => s.category === 'research');
    expect(researchStage.decisionCount).toBe(1);
    expect(researchStage.avgConfidence).toBeCloseTo(0.85);
  });

  it('human output renders gap lines with severity', async () => {
    const run = makeRun({ stageSequence: ['research'] });
    createRunTree(runsDir, run);

    writeStageState(runsDir, run.id, {
      category: 'research',
      status: 'running',
      selectedFlavors: [],
      gaps: [
        { description: 'Missing security review', severity: 'high' },
        { description: 'Incomplete coverage', severity: 'low' },
      ],
      decisions: [],
    });

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'run', 'status', run.id]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('⚠ gap [high]: Missing security review');
    expect(output).toContain('⚠ gap [low]: Incomplete coverage');
  });

  it('hasSynthesis is true when stage synthesis.md file exists', async () => {
    const run = makeRun({ stageSequence: ['research'] });
    createRunTree(runsDir, run);

    // Write synthesis.md at the stage level
    const paths = runPaths(runsDir, run.id);
    const synthesisPath = paths.stageSynthesis('research');
    mkdirSync(join(runsDir, run.id, 'stages', 'research'), { recursive: true });
    writeFileSync(synthesisPath, '# Research Synthesis', 'utf-8');

    const program = createProgram();
    await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'run', 'status', run.id]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    const researchStage = parsed.stages.find((s: { category: string }) => s.category === 'research');
    expect(researchStage.hasSynthesis).toBe(true);
  });

  it('errors on unknown run ID', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', '--cwd', baseDir, 'run', 'status', randomUUID()]);

    expect(errorSpy).toHaveBeenCalled();
  });
});
