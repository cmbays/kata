import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { After, Given, QuickPickleWorld, Then, When, setWorldConstructor } from 'quickpickle';
import { expect, vi } from 'vitest';
import type { PreparedRun } from '@domain/ports/session-bridge.js';
import { CycleSchema, type Cycle } from '@domain/types/cycle.js';
import { RunSchema } from '@domain/types/run-state.js';
import { SessionExecutionBridge } from './session-bridge.js';
import * as sessionContext from '@shared/lib/session-context.js';

class SessionBridgeWorld extends QuickPickleWorld {
  kataDir?: string;
  bridge?: SessionExecutionBridge;
  cycle?: Cycle;
  prepared?: PreparedRun;
  agentContext?: string;
}

setWorldConstructor(SessionBridgeWorld);

function createTestDir(): string {
  const dir = join(tmpdir(), `kata-acceptance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createCycle(kataDir: string, betDescription: string): Cycle {
  const now = new Date().toISOString();
  const cycle = CycleSchema.parse({
    id: randomUUID(),
    name: 'Acceptance Cycle',
    budget: { tokenBudget: 100000 },
    bets: [{
      id: randomUUID(),
      description: betDescription,
      appetite: 30,
      outcome: 'pending',
    }],
    state: 'active',
    createdAt: now,
    updatedAt: now,
  });

  const cyclesDir = join(kataDir, 'cycles');
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${cycle.id}.json`), JSON.stringify(cycle, null, 2));

  return cycle;
}

After(async (world: SessionBridgeWorld) => {
  vi.restoreAllMocks();
  if (world.kataDir) {
    rmSync(world.kataDir, { recursive: true, force: true });
  }
});

Given('an active cycle with a default build-stage bet {string}', (world: SessionBridgeWorld, betName: string) => {
  world.kataDir = createTestDir();
  world.cycle = createCycle(world.kataDir, betName);
  world.bridge = new SessionExecutionBridge(world.kataDir);
});

Given('the session bridge has prepared the bet for execution', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected an active cycle and session bridge before preparing a bet.');
  }

  world.prepared = world.bridge.prepare(world.cycle.bets[0]!.id);
});

Given('launch mode is {string} outside a git worktree', (world: SessionBridgeWorld, launchMode: string) => {
  if (!world.kataDir) {
    throw new Error('Expected a prepared kata directory before configuring the launch context.');
  }

  vi.spyOn(sessionContext, 'detectLaunchMode').mockReturnValue(
    launchMode as ReturnType<typeof sessionContext.detectLaunchMode>,
  );
  vi.spyOn(sessionContext, 'detectSessionContext').mockReturnValue({
    kataInitialized: false,
    kataDir: null,
    inWorktree: false,
    activeCycle: null,
    launchMode: launchMode as ReturnType<typeof sessionContext.detectLaunchMode>,
  });
});

When('the session bridge prepares the bet for execution', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected an active cycle and session bridge before preparing a bet.');
  }

  world.prepared = world.bridge.prepare(world.cycle.bets[0]!.id);
});

When('the session bridge formats the agent context', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.prepared) {
    throw new Error('Expected a prepared run before formatting agent context.');
  }

  world.agentContext = world.bridge.formatAgentContext(world.prepared);
});

Then('the prepared run uses the default stage sequence', (world: SessionBridgeWorld) => {
  expect(world.prepared?.stages).toEqual(['research', 'plan', 'build', 'review']);
});

Then('the prepared run uses worktree isolation', (world: SessionBridgeWorld) => {
  expect(world.prepared?.isolation).toBe('worktree');
});

Then('a running run record exists for the prepared run', (world: SessionBridgeWorld) => {
  if (!world.kataDir || !world.prepared) {
    throw new Error('Expected a prepared run and kata directory before reading run state.');
  }

  const runJsonPath = join(world.kataDir, 'runs', world.prepared.runId, 'run.json');
  expect(existsSync(runJsonPath)).toBe(true);

  const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
  expect(run.status).toBe('running');
  expect(run.stageSequence).toEqual(['research', 'plan', 'build', 'review']);
});

Then('the bridge metadata is marked {string}', (world: SessionBridgeWorld, status: string) => {
  if (!world.kataDir || !world.prepared) {
    throw new Error('Expected a prepared run and kata directory before reading bridge metadata.');
  }

  const metaPath = join(world.kataDir, 'bridge-runs', `${world.prepared.runId}.json`);
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8')) as { status?: string };
  expect(meta.status).toBe(status);
});

Then('the agent context includes the prepared kata dir as the resolved kata dir', (world: SessionBridgeWorld) => {
  expect(world.agentContext).toContain(`- **Kata dir resolved**: ${world.prepared?.kataDir}`);
});

Then('the agent context warns that kata commands should use "--cwd"', (world: SessionBridgeWorld) => {
  expect(world.agentContext).toContain('use `--cwd` to point kata commands at the main repo');
});

Then('the agent context includes git worktree instructions', (world: SessionBridgeWorld) => {
  expect(world.agentContext).toContain('### Git workflow');
  expect(world.agentContext).toContain('NEVER commit directly to the `main` branch');
  expect(world.agentContext).toContain('git checkout -b');
});
