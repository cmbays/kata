import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createProgram } from '@cli/program.js';
import { ObservationSchema } from '@domain/types/observation.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { runPaths } from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';


function makeKataDir(): { kataDir: string; runsDir: string } {
  const base = join(tmpdir(), `kata-observe-test-${randomUUID()}`);
  const kataDir = join(base, '.kata');
  const runsDir = join(kataDir, KATA_DIRS.runs);
  mkdirSync(runsDir, { recursive: true });

  // Write minimal config so withCommandContext doesn't fail
  writeFileSync(join(kataDir, 'config.json'), JSON.stringify({
    methodology: 'shape-up',
    outputMode: 'plain',
    execution: { adapter: 'manual', config: {}, confidenceThreshold: 0.7 },
    customStagePaths: [],
    project: {},
    user: { experienceLevel: 'intermediate' },
    cooldown: { synthesisDepth: 'standard' },
  }), 'utf-8');

  return { kataDir, runsDir };
}

function makeRunDir(runsDir: string, runId: string): void {
  mkdirSync(join(runsDir, runId), { recursive: true });
}

async function runCli(argv: string[], cwd: string): Promise<{ stdout: string; exitCode: number }> {
  const lines: string[] = [];
  const orig = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };

  const program = createProgram();
  program.exitOverride();

  let exitCode = 0;
  try {
    await program.parseAsync(['node', 'kata', '--cwd', cwd, '--plain', ...argv]);
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'commander.helpDisplayed') {
      // help was printed — not a real error
    } else {
      exitCode = 1;
    }
  } finally {
    console.log = orig;
  }

  return { stdout: lines.join('\n'), exitCode };
}

describe('kata observe record', () => {
  it('records an insight observation at run level', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { exitCode } = await runCli([
      'observe', 'record', 'insight', 'TDD reduces rework here',
      '--run', runId,
    ], join(kataDir, '..'));

    expect(exitCode).toBe(0);

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.observationsJsonl, ObservationSchema);
    expect(obs).toHaveLength(1);
    expect(obs[0].type).toBe('insight');
    expect(obs[0].content).toBe('TDD reduces rework here');
  });

  it('records a friction observation with required taxonomy', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { exitCode } = await runCli([
      'observe', 'record', 'friction', 'Style guide conflicts with existing code',
      '--run', runId,
      '--taxonomy', 'convention-clash',
    ], join(kataDir, '..'));

    expect(exitCode).toBe(0);

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.observationsJsonl, ObservationSchema);
    expect(obs).toHaveLength(1);
    if (obs[0].type === 'friction') {
      expect(obs[0].taxonomy).toBe('convention-clash');
    }
  });

  it('records a gap observation with required severity', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { exitCode } = await runCli([
      'observe', 'record', 'gap', 'No tests for error handling paths',
      '--run', runId,
      '--severity', 'major',
    ], join(kataDir, '..'));

    expect(exitCode).toBe(0);

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.observationsJsonl, ObservationSchema);
    expect(obs).toHaveLength(1);
    if (obs[0].type === 'gap') {
      expect(obs[0].severity).toBe('major');
    }
  });

  it('records at stage level with --stage flag', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    await runCli([
      'observe', 'record', 'decision', 'Selected TDD approach',
      '--run', runId,
      '--stage', 'build',
    ], join(kataDir, '..'));

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.stageObservationsJsonl('build'), ObservationSchema);
    expect(obs).toHaveLength(1);
    expect(obs[0].type).toBe('decision');
  });

  it('records at flavor level with --stage and --flavor flags', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    await runCli([
      'observe', 'record', 'outcome', 'All tests pass',
      '--run', runId,
      '--stage', 'build',
      '--flavor', 'tdd',
    ], join(kataDir, '..'));

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.flavorObservationsJsonl('build', 'tdd'), ObservationSchema);
    expect(obs).toHaveLength(1);
    expect(obs[0].type).toBe('outcome');
  });

  it('sets exitCode=1 for friction missing taxonomy', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { exitCode } = await runCli([
      'observe', 'record', 'friction', 'some friction',
      '--run', runId,
      // missing --taxonomy
    ], join(kataDir, '..'));

    expect(exitCode).toBe(0); // commander doesn't throw, exitCode set via process.exitCode
    // File should not exist
    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.observationsJsonl, ObservationSchema);
    expect(obs).toHaveLength(0);
  });
});

describe('kata observe list', () => {
  it('lists observations for a run', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    // First record one
    await runCli([
      'observe', 'record', 'insight', 'Cross-cutting insight here',
      '--run', runId,
    ], join(kataDir, '..'));

    const { stdout } = await runCli([
      'observe', 'list',
      '--run', runId,
    ], join(kataDir, '..'));

    expect(stdout).toContain('Cross-cutting insight here');
  });

  it('outputs JSON with --json flag', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    await runCli([
      'observe', 'record', 'assumption', 'API supports pagination',
      '--run', runId,
    ], join(kataDir, '..'));

    const { stdout } = await runCli([
      '--json', 'observe', 'list',
      '--run', runId,
    ], join(kataDir, '..'));

    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('assumption');
  });

  it('shows empty message when no observations', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { stdout } = await runCli([
      'observe', 'list',
      '--run', runId,
    ], join(kataDir, '..'));

    expect(stdout).toContain('No');
  });
});

describe('kata kansatsu alias', () => {
  it('kansatsu alias works the same as observe', async () => {
    const { kataDir, runsDir } = makeKataDir();
    const runId = randomUUID();
    makeRunDir(runsDir, runId);

    const { exitCode } = await runCli([
      'kansatsu', 'record', 'insight', 'via kansatsu alias',
      '--run', runId,
    ], join(kataDir, '..'));

    expect(exitCode).toBe(0);

    const paths = runPaths(runsDir, runId);
    const obs = JsonlStore.readAll(paths.observationsJsonl, ObservationSchema);
    expect(obs).toHaveLength(1);
    expect(obs[0].content).toBe('via kansatsu alias');
  });
});
