import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { readObservations } from '@infra/persistence/run-store.js';
import { registerPredictCommand } from './predict.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal .kata directory with config.json so withCommandContext
 * can resolve kataDir.
 */
function makeKataDir(base: string): string {
  const kataDir = join(base, '.kata');
  mkdirSync(join(kataDir, 'runs'), { recursive: true });
  writeFileSync(
    join(kataDir, 'config.json'),
    JSON.stringify({ outputMode: 'plain', projectName: 'test', adapter: 'manual' }),
  );
  return kataDir;
}

/**
 * Run a predict command with the given args, capturing stdout/stderr.
 * The command is run with --cwd pointing to the parent of kataDir.
 */
async function runPredict(
  kataDir: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;

  // Intercept stdout/stderr
  console.log = (...a: unknown[]) => stdoutChunks.push(a.join(' '));
  console.error = (...a: unknown[]) => stderrChunks.push(a.join(' '));

  try {
    const program = new Command();
    program
      .option('--json', 'JSON output')
      .option('--verbose', 'Verbose')
      .option('--plain', 'Plain output')
      .option('--cwd <path>', 'Working directory', join(kataDir, '..'));

    registerPredictCommand(program);

    await program.parseAsync(['node', 'kata', 'predict', ...args]);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    stdout: stdoutChunks.join('\n'),
    stderr: stderrChunks.join('\n'),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kata predict command', () => {
  let tmpDir: string;
  let kataDir: string;
  let runsDir: string;
  let runId: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kata-predict-test-${randomUUID()}`);
    mkdirSync(tmpDir, { recursive: true });
    kataDir = makeKataDir(tmpDir);
    runsDir = join(kataDir, 'runs');
    runId = randomUUID();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Happy path — basic prediction written to disk
  // -------------------------------------------------------------------------

  it('writes a prediction observation when given valid --run and content', async () => {
    await runPredict(kataDir, [
      'the build will succeed without errors',
      '--run', runId,
    ]);

    const observations = readObservations(runsDir, runId, { level: 'run' });
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      type: 'prediction',
      content: 'the build will succeed without errors',
    });
  });

  // -------------------------------------------------------------------------
  // Quantitative fields populated
  // -------------------------------------------------------------------------

  it('includes quantitative fields when --metric --value --unit are all present', async () => {
    await runPredict(kataDir, [
      'response time under 200ms',
      '--run', runId,
      '--metric', 'response-time',
      '--value', '200',
      '--unit', 'ms',
    ]);

    const observations = readObservations(runsDir, runId, { level: 'run' });
    expect(observations).toHaveLength(1);
    const obs = observations[0];
    expect(obs?.type).toBe('prediction');
    if (obs?.type === 'prediction') {
      expect(obs.quantitative).toMatchObject({
        metric: 'response-time',
        predicted: 200,
        unit: 'ms',
      });
    }
  });

  // -------------------------------------------------------------------------
  // Timeframe field
  // -------------------------------------------------------------------------

  it('includes timeframe when --timeframe is provided', async () => {
    await runPredict(kataDir, [
      'deployment will finish',
      '--run', runId,
      '--timeframe', '1 sprint',
    ]);

    const observations = readObservations(runsDir, runId, { level: 'run' });
    const obs = observations[0];
    if (obs?.type === 'prediction') {
      expect(obs.timeframe).toBe('1 sprint');
    }
  });

  // -------------------------------------------------------------------------
  // Stage-level scoping
  // -------------------------------------------------------------------------

  it('scopes observation to stage level when --stage is provided', async () => {
    await runPredict(kataDir, [
      'tests will all pass',
      '--run', runId,
      '--stage', 'build',
    ]);

    const runLevelObs = readObservations(runsDir, runId, { level: 'run' });
    expect(runLevelObs).toHaveLength(0);

    const stageObs = readObservations(runsDir, runId, { level: 'stage', category: 'build' });
    expect(stageObs).toHaveLength(1);
    expect(stageObs[0]).toMatchObject({ type: 'prediction' });
  });

  // -------------------------------------------------------------------------
  // JSON output
  // -------------------------------------------------------------------------

  it('outputs JSON when --json flag is provided', async () => {
    const { stdout } = await runPredict(kataDir, [
      'json output prediction',
      '--run', runId,
      '--json',
    ]);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.type).toBe('prediction');
    expect(parsed.content).toBe('json output prediction');
  });

  // -------------------------------------------------------------------------
  // katakaId / --kataka
  // -------------------------------------------------------------------------

  it('sets katakaId on the observation when --kataka is provided', async () => {
    await runPredict(kataDir, [
      'agent prediction content',
      '--run', runId,
      '--kataka', 'agent-alpha',
    ]);

    const observations = readObservations(runsDir, runId, { level: 'run' });
    expect(observations[0]).toMatchObject({ katakaId: 'agent-alpha' });
  });

  // -------------------------------------------------------------------------
  // Missing --run flag → Commander throws (requiredOption)
  // -------------------------------------------------------------------------

  it('throws when --run is not provided (requiredOption)', async () => {
    const program = new Command();
    program.exitOverride(); // prevent process.exit, throw instead
    program
      .option('--json')
      .option('--verbose')
      .option('--plain')
      .option('--cwd <path>', 'cwd', join(kataDir, '..'));

    registerPredictCommand(program);

    await expect(
      program.parseAsync(['node', 'kata', 'predict', 'some content'])
    ).rejects.toThrow();
  });

  // -------------------------------------------------------------------------
  // Plain text output (no --json)
  // -------------------------------------------------------------------------

  it('prints plain text confirmation for a successful prediction', async () => {
    const { stdout } = await runPredict(kataDir, [
      'plain output prediction',
      '--run', runId,
    ]);

    expect(stdout).toMatch(/prediction recorded/i);
    expect(stdout).toMatch(/id:/i);
  });
});
