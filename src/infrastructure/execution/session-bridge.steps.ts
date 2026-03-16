import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { After, Given, QuickPickleWorld, Then, When, setWorldConstructor } from 'quickpickle';
import { expect, vi } from 'vitest';
import { z } from 'zod/v4';
import type {
  CycleExecutionStatus,
  CycleSummary,
  PreparedCycle,
  PreparedRun,
} from '@domain/ports/session-bridge.js';
import { CycleSchema, type Cycle } from '@domain/types/cycle.js';
import { RunSchema } from '@domain/types/run-state.js';
import { CooldownSession, type CooldownSessionResult } from '@features/cycle-management/cooldown-session.js';
import { SessionExecutionBridge } from '@infra/execution/session-bridge.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import * as sessionContext from '@shared/lib/session-context.js';

class SessionBridgeWorld extends QuickPickleWorld {
  kataDir?: string;
  bridge?: SessionExecutionBridge;
  cycle?: Cycle;
  prepared?: PreparedRun;
  preparedCycle?: PreparedCycle;
  initialPreparedRunIds?: string[];
  agentContext?: string;
  cycleStatus?: CycleExecutionStatus;
  cycleSummary?: CycleSummary;
  cooldownResult?: CooldownSessionResult;
}

setWorldConstructor(SessionBridgeWorld);

const bridgeRunMetaSchema = z.object({
  status: z.enum(['in-progress', 'complete', 'failed']),
});

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

  const cyclesDir = join(kataDir, KATA_DIRS.cycles);
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${cycle.id}.json`), JSON.stringify(cycle, null, 2));

  return cycle;
}

function createCycleWithBets(kataDir: string, name: string, state: 'planning' | 'active', betDescriptions: string[]): Cycle {
  const now = new Date().toISOString();
  const cycle = CycleSchema.parse({
    id: randomUUID(),
    name,
    budget: { tokenBudget: 100000 },
    bets: betDescriptions.map((description) => ({
      id: randomUUID(),
      description,
      appetite: 30,
      outcome: 'pending',
    })),
    state,
    createdAt: now,
    updatedAt: now,
  });

  const cyclesDir = join(kataDir, KATA_DIRS.cycles);
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${cycle.id}.json`), JSON.stringify(cycle, null, 2));

  return cycle;
}

function createCooldownSession(kataDir: string): CooldownSession {
  const knowledgeDir = join(kataDir, KATA_DIRS.knowledge);
  const pipelinesDir = join(kataDir, KATA_DIRS.pipelines);
  const historyDir = join(kataDir, KATA_DIRS.history);
  const runsDir = join(kataDir, KATA_DIRS.runs);
  const bridgeRunsDir = join(kataDir, KATA_DIRS.bridgeRuns);

  mkdirSync(knowledgeDir, { recursive: true });
  mkdirSync(pipelinesDir, { recursive: true });
  mkdirSync(historyDir, { recursive: true });

  return new CooldownSession({
    cycleManager: new CycleManager(join(kataDir, KATA_DIRS.cycles), JsonStore),
    knowledgeStore: new KnowledgeStore(knowledgeDir),
    persistence: JsonStore,
    pipelineDir: pipelinesDir,
    historyDir,
    runsDir,
    bridgeRunsDir,
  });
}

function findBet(world: SessionBridgeWorld, betName: string) {
  const bet = world.cycle?.bets.find((candidate) => candidate.description === betName);
  if (!bet) {
    throw new Error(`Expected to find a bet named "${betName}".`);
  }

  return bet;
}

function findPreparedRun(world: SessionBridgeWorld, betName: string): PreparedRun {
  const run = world.preparedCycle?.preparedRuns.find((candidate) => candidate.betName === betName)
    ?? (world.prepared?.betName === betName ? world.prepared : undefined);
  if (!run) {
    throw new Error(`Expected a prepared run for bet "${betName}".`);
  }

  return run;
}

function bridgeRunMetaFiles(kataDir: string): string[] {
  const dir = join(kataDir, KATA_DIRS.bridgeRuns);
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort();
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

Given(
  'a planning cycle named {string} with pending bets {string}',
  (world: SessionBridgeWorld, cycleName: string, betNames: string) => {
    world.kataDir = createTestDir();
    world.cycle = createCycleWithBets(
      world.kataDir,
      cycleName,
      'planning',
      betNames.split(',').map((bet) => bet.trim()).filter(Boolean),
    );
    world.bridge = new SessionExecutionBridge(world.kataDir);
  },
);

Given(
  'an active cycle named {string} with pending bets {string}',
  (world: SessionBridgeWorld, cycleName: string, betNames: string) => {
    world.kataDir = createTestDir();
    world.cycle = createCycleWithBets(
      world.kataDir,
      cycleName,
      'active',
      betNames.split(',').map((bet) => bet.trim()).filter(Boolean),
    );
    world.bridge = new SessionExecutionBridge(world.kataDir);
  },
);

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

When('the session bridge prepares the bet {string} for execution', (world: SessionBridgeWorld, betName: string) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected an active cycle and session bridge before preparing a bet.');
  }

  world.prepared = world.bridge.prepare(findBet(world, betName).id);
});

When('the session bridge prepares the cycle for execution', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected a planning cycle and session bridge before preparing a cycle.');
  }

  world.preparedCycle = world.bridge.prepareCycle(world.cycle.id);
  world.initialPreparedRunIds = world.preparedCycle.preparedRuns.map((run) => run.runId);
});

When('the session bridge prepares the same cycle again', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected a prepared cycle before preparing the same cycle again.');
  }

  world.preparedCycle = world.bridge.prepareCycle(world.cycle.id);
});

When('the session bridge reads the cycle execution status', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected a cycle and session bridge before reading status.');
  }

  world.cycleStatus = world.bridge.getCycleStatus(world.cycle.id);
});

When('the session bridge completes the cycle', (world: SessionBridgeWorld) => {
  if (!world.bridge || !world.cycle) {
    throw new Error('Expected a cycle and session bridge before completing the cycle.');
  }

  world.cycleSummary = world.bridge.completeCycle(world.cycle.id, {});
});

When('cooldown runs for the prepared cycle', async (world: SessionBridgeWorld) => {
  if (!world.kataDir || !world.cycle) {
    throw new Error('Expected a prepared cycle before running cooldown.');
  }

  const session = createCooldownSession(world.kataDir);
  world.cooldownResult = await session.run(world.cycle.id, [], { force: true });
});

When(
  'the prepared run for bet {string} completes successfully with {int} total tokens',
  (world: SessionBridgeWorld, betName: string, totalTokens: number) => {
    if (!world.bridge) {
      throw new Error('Expected a session bridge before completing a prepared run.');
    }

    const run = findPreparedRun(world, betName);
    world.bridge.complete(run.runId, {
      success: true,
      tokenUsage: {
        inputTokens: totalTokens,
        outputTokens: 0,
        total: totalTokens,
      },
    });
  },
);

When(
  'the prepared run for bet {string} fails with {int} total tokens',
  (world: SessionBridgeWorld, betName: string, totalTokens: number) => {
    if (!world.bridge) {
      throw new Error('Expected a session bridge before completing a prepared run.');
    }

    const run = findPreparedRun(world, betName);
    world.bridge.complete(run.runId, {
      success: false,
      tokenUsage: {
        inputTokens: totalTokens,
        outputTokens: 0,
        total: totalTokens,
      },
    });
  },
);

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

  const runJsonPath = join(world.kataDir, KATA_DIRS.runs, world.prepared.runId, 'run.json');
  expect(existsSync(runJsonPath)).toBe(true);

  const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
  expect(run.status).toBe('running');
  expect(run.stageSequence).toEqual(['research', 'plan', 'build', 'review']);
});

Then('the bridge metadata is marked {string}', (world: SessionBridgeWorld, status: string) => {
  if (!world.kataDir || !world.prepared) {
    throw new Error('Expected a prepared run and kata directory before reading bridge metadata.');
  }

  const metaPath = join(world.kataDir, KATA_DIRS.bridgeRuns, `${world.prepared.runId}.json`);
  const meta = bridgeRunMetaSchema.parse(JSON.parse(readFileSync(metaPath, 'utf-8')));
  expect(meta.status).toBe(status);
});

Then('the cycle is marked {string}', (world: SessionBridgeWorld, state: string) => {
  if (!world.kataDir || !world.cycle) {
    throw new Error('Expected a cycle before checking its state.');
  }

  const cyclePath = join(world.kataDir, KATA_DIRS.cycles, `${world.cycle.id}.json`);
  const updated = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
  expect(updated.state).toBe(state);
});

Then('the prepared cycle includes {int} runs', (world: SessionBridgeWorld, count: number) => {
  expect(world.preparedCycle?.preparedRuns).toHaveLength(count);
});

Then('each pending bet has exactly one bridge run', (world: SessionBridgeWorld) => {
  if (!world.kataDir || !world.cycle) {
    throw new Error('Expected a kata directory and cycle before reading bridge runs.');
  }

  const files = bridgeRunMetaFiles(world.kataDir);
  expect(files).toHaveLength(world.cycle.bets.length);

  const betIds = files.map((file) => {
    const meta = z.object({ betId: z.string().uuid() }).parse(
      JSON.parse(readFileSync(join(world.kataDir!, KATA_DIRS.bridgeRuns, file), 'utf-8')),
    );
    return meta.betId;
  });
  expect(new Set(betIds).size).toBe(world.cycle.bets.length);
});

Then('each prepared cycle run has a running run record', (world: SessionBridgeWorld) => {
  if (!world.kataDir || !world.preparedCycle) {
    throw new Error('Expected a prepared cycle and kata directory before reading run state.');
  }

  for (const run of world.preparedCycle.preparedRuns) {
    const runJsonPath = join(world.kataDir, KATA_DIRS.runs, run.runId, 'run.json');
    expect(existsSync(runJsonPath)).toBe(true);

    const runJson = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
    expect(runJson.status).toBe('running');
  }
});

Then('the repeated prepare reuses the existing run ids', (world: SessionBridgeWorld) => {
  expect(world.preparedCycle?.preparedRuns.map((run) => run.runId)).toEqual(world.initialPreparedRunIds);
});

Then('the cycle status for bet {string} is {string}', (world: SessionBridgeWorld, betName: string, status: string) => {
  const betStatus = world.cycleStatus?.bets.find((candidate) => candidate.betName === betName);
  expect(betStatus?.status).toBe(status);
});

Then('the cycle status for bet {string} has a run id', (world: SessionBridgeWorld, betName: string) => {
  const betStatus = world.cycleStatus?.bets.find((candidate) => candidate.betName === betName);
  expect(betStatus?.runId).toBeTruthy();
});

Then(
  'the cycle summary reports {int} total bets and {int} completed bets',
  (world: SessionBridgeWorld, totalBets: number, completedBets: number) => {
    expect(world.cycleSummary?.totalBets).toBe(totalBets);
    expect(world.cycleSummary?.completedBets).toBe(completedBets);
  },
);

Then('the cycle summary reports {int} total tokens', (world: SessionBridgeWorld, totalTokens: number) => {
  expect(world.cycleSummary?.tokenUsage?.total).toBe(totalTokens);
});

Then('the cycle history contains {int} entries for the cycle', (world: SessionBridgeWorld, count: number) => {
  if (!world.kataDir || !world.cycle) {
    throw new Error('Expected a cycle and kata directory before reading history.');
  }

  const historyDir = join(world.kataDir, KATA_DIRS.history);
  const entries = readdirSync(historyDir)
    .filter((file) => file.endsWith('.json'))
    .map((file) => JSON.parse(readFileSync(join(historyDir, file), 'utf-8')) as { cycleId?: string })
    .filter((entry) => entry.cycleId === world.cycle!.id);

  expect(entries).toHaveLength(count);
});

Then('the cycle bet outcomes are {string}', (world: SessionBridgeWorld, outcomes: string) => {
  if (!world.kataDir || !world.cycle) {
    throw new Error('Expected a cycle and kata directory before reading bet outcomes.');
  }

  const expected = outcomes.split(',').map((entry) => entry.trim()).filter(Boolean);
  const cyclePath = join(world.kataDir, KATA_DIRS.cycles, `${world.cycle.id}.json`);
  const updated = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));

  expect(updated.bets.map((bet) => bet.outcome)).toEqual(expected);
});

Then('the cooldown report shows {int} percent completion', (world: SessionBridgeWorld, percent: number) => {
  expect(world.cooldownResult?.report.completionRate).toBe(percent);
});

Then('the cooldown report shows {int} total tokens used', (world: SessionBridgeWorld, totalTokens: number) => {
  expect(world.cooldownResult?.report.tokensUsed).toBe(totalTokens);
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
