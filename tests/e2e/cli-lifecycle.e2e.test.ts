import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const cliEntry = resolve(repoRoot, 'dist/cli/index.js');

interface KataRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runKata(projectDir: string, args: string[]): KataRunResult {
  const testBinDir = join(projectDir, '.kata-test-bin');
  const result = spawnSync(
    process.execPath,
    [cliEntry, '--cwd', projectDir, '--plain', ...args],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        KATA_PLAIN: '1',
        PATH: `${testBinDir}${process.platform === 'win32' ? ';' : ':'}${process.env['PATH'] ?? ''}`,
      },
      encoding: 'utf-8',
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runKataOrThrow(projectDir: string, args: string[]): string {
  const result = runKata(projectDir, args);
  if (result.status !== 0) {
    throw new Error(
      [
        `kata ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}`,
        'stdout:',
        result.stdout,
        'stderr:',
        result.stderr,
      ].join('\n'),
    );
  }
  return result.stdout;
}

function runKataJson<T>(projectDir: string, args: string[]): T {
  const stdout = runKataOrThrow(projectDir, ['--json', ...args]);
  return JSON.parse(stdout) as T;
}

describe('CLI E2E: staged lifecycle', () => {
  let projectDir: string;

  beforeAll(() => {
    if (!existsSync(cliEntry)) {
      throw new Error(
        'Built CLI entrypoint not found at dist/cli/index.js. Run "npm run build" before "npm run test:e2e".',
      );
    }
  });

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'kata-e2e-'));
    const testBinDir = join(projectDir, '.kata-test-bin');
    mkdirSync(testBinDir, { recursive: true });
    const claudeStub = join(testBinDir, 'claude');
    writeFileSync(
      claudeStub,
      '#!/usr/bin/env node\nprocess.stdout.write("[]\\n");\n',
      'utf-8',
    );
    chmodSync(claudeStub, 0o755);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('runs init -> staged launch -> agent logging -> complete -> cooldown via the real CLI entrypoint', () => {
    runKataOrThrow(projectDir, ['init', '--skip-prompts']);

    const agent = runKataJson<{ id: string }>(projectDir, [
      'agent', 'register',
      '--name', 'E2E Agent',
      '--role', 'executor',
    ]);

    const cycleCreation = runKataJson<{ cycle: { id: string } }>(projectDir, [
      'cycle', 'new',
      '--skip-prompts',
      '-b', '100000',
      '-n', 'e2e-cycle',
    ]);
    const cycleId = cycleCreation.cycle.id;

    runKataOrThrow(projectDir, [
      'cycle', 'add-bet', cycleId, 'Ship a narrow end-to-end bet',
      '--gyo', 'research,build',
    ]);

    const launch = runKataJson<{
      cycleId: string;
      cycleName: string;
      preparedRuns: Array<{ runId: string; betId: string; betName: string }>;
    }>(projectDir, [
      'cycle', 'staged', 'launch',
      '--agent', agent.id,
      '--name', 'E2E Launch',
    ]);

    expect(launch.cycleId).toBe(cycleId);
    expect(launch.cycleName).toBe('E2E Launch');
    expect(launch.preparedRuns).toHaveLength(1);

    const runId = launch.preparedRuns[0]!.runId;

    const context = runKataOrThrow(projectDir, ['execute', 'context', runId]);
    expect(context).toContain(runId);
    expect(context).toContain('Ship a narrow end-to-end bet');

    runKataOrThrow(projectDir, [
      'observe', 'record', 'insight', 'E2E observation captured',
      '--run', runId,
      '--agent', agent.id,
    ]);

    runKataOrThrow(projectDir, [
      'predict', 'E2E prediction',
      '--run', runId,
      '--agent', agent.id,
    ]);

    runKataOrThrow(projectDir, [
      'decision', 'record', runId,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--selected', 'manual-review',
      '--options', '["manual-review"]',
      '--agent', agent.id,
    ]);

    runKataOrThrow(projectDir, [
      'execute', 'complete', runId,
      '--success',
      '--notes', 'e2e complete',
    ]);

    const runJson = JSON.parse(readFileSync(join(projectDir, '.kata', 'runs', runId, 'run.json'), 'utf-8')) as {
      status: string;
      agentId?: string;
      katakaId?: string;
    };
    const bridgeRunJson = JSON.parse(readFileSync(join(projectDir, '.kata', 'bridge-runs', `${runId}.json`), 'utf-8')) as {
      status: string;
      agentId?: string;
      katakaId?: string;
    };

    expect(runJson.status).toBe('completed');
    expect(runJson.agentId).toBe(agent.id);
    expect(runJson.katakaId).toBe(agent.id);
    expect(bridgeRunJson.status).toBe('complete');
    expect(bridgeRunJson.agentId).toBe(agent.id);
    expect(bridgeRunJson.katakaId).toBe(agent.id);

    const cooldown = runKataJson<{ report: { cycleId: string } }>(projectDir, [
      'cooldown', cycleId,
      '--skip-prompts',
      '--force',
    ]);
    expect(cooldown.report.cycleId).toBe(cycleId);

    const cycleJson = JSON.parse(readFileSync(join(projectDir, '.kata', 'cycles', `${cycleId}.json`), 'utf-8')) as {
      state: string;
    };
    expect(cycleJson.state).toBe('complete');
  });
});
