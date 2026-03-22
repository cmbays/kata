import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect, vi } from 'vitest';
import type { BetOutcome } from '@domain/types/bet.js';
import type { Cycle } from '@domain/types/cycle.js';
import { logger } from '@shared/lib/logger.js';
import type { BetOutcomeRecord, IncompleteRunInfo } from './cooldown-types.js';
import { BridgeRunSyncer, type BridgeRunSyncerDeps } from './bridge-run-syncer.js';

// ── World ────────────────────────────────────────────────────

interface BridgeRunSyncerWorld extends QuickPickleWorld {
  tmpDir: string;
  bridgeRunsDir?: string;
  runsDir?: string;
  cycle: Cycle;
  syncer?: BridgeRunSyncer;
  syncedOutcomes?: BetOutcomeRecord[];
  incompleteRuns?: IncompleteRunInfo[];
  bridgeRunIdMap?: Map<string, string>;
  outcomesToRecord?: BetOutcomeRecord[];
  updateBetOutcomesSpy: ReturnType<typeof vi.fn>;
  loggerWarnSpy: ReturnType<typeof vi.fn>;
  lastError?: Error;
}

// ── Helpers ──────────────────────────────────────────────────

function makeBet(overrides: {
  id?: string;
  description?: string;
  outcome?: BetOutcome;
  runId?: string;
}): Cycle['bets'][number] {
  return {
    id: overrides.id ?? randomUUID(),
    description: overrides.description ?? 'Test bet',
    appetite: 30,
    outcome: overrides.outcome ?? 'pending',
    issueRefs: [],
    ...(overrides.runId ? { runId: overrides.runId } : {}),
  };
}

function makeCycle(bets: Cycle['bets'][number][]): Cycle {
  return {
    id: randomUUID(),
    budget: {},
    bets,
    pipelineMappings: [],
    state: 'active',
    cooldownReserve: 10,
    createdAt: '2026-03-22T10:00:00.000Z',
    updatedAt: '2026-03-22T10:00:00.000Z',
  };
}

function buildSyncer(world: BridgeRunSyncerWorld): BridgeRunSyncer {
  const deps: BridgeRunSyncerDeps = {
    bridgeRunsDir: world.bridgeRunsDir,
    runsDir: world.runsDir,
    cycleManager: {
      get: () => world.cycle,
      updateBetOutcomes: world.updateBetOutcomesSpy,
    } as unknown as BridgeRunSyncerDeps['cycleManager'],
  };
  return new BridgeRunSyncer(deps);
}

function writeBridgeRunFile(
  bridgeRunsDir: string,
  runId: string,
  meta: Record<string, unknown>,
): void {
  writeFileSync(join(bridgeRunsDir, `${runId}.json`), JSON.stringify(meta));
}

function writeRunFile(
  runsDir: string,
  runId: string,
  status: string,
): void {
  const runDir = join(runsDir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      id: runId,
      cycleId: randomUUID(),
      betId: randomUUID(),
      betPrompt: 'Test bet prompt',
      stageSequence: ['build'],
      currentStage: null,
      status,
      startedAt: '2026-03-22T10:00:00.000Z',
    }),
  );
}

// ── Background ───────────────────────────────────────────────

Given(
  'a cycle with bets that have been launched as runs',
  (world: BridgeRunSyncerWorld) => {
    world.tmpDir = mkdtempSync(join(tmpdir(), 'brs-'));
    world.bridgeRunsDir = join(world.tmpDir, 'bridge-runs');
    world.runsDir = join(world.tmpDir, 'runs');
    mkdirSync(world.bridgeRunsDir, { recursive: true });
    mkdirSync(world.runsDir, { recursive: true });
    world.cycle = makeCycle([]);
    world.updateBetOutcomesSpy = vi.fn().mockReturnValue({ unmatchedBetIds: [] });
    world.loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  },
);

// ── Given: bet setup ─────────────────────────────────────────

Given(
  'bet {string} is pending with a bridge-run that completed',
  (world: BridgeRunSyncerWorld, betName: string) => {
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending', runId }));
    writeBridgeRunFile(world.bridgeRunsDir!, runId, { status: 'complete' });
  },
);

Given(
  'bet {string} is pending with a bridge-run that failed',
  (world: BridgeRunSyncerWorld, betName: string) => {
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending', runId }));
    writeBridgeRunFile(world.bridgeRunsDir!, runId, { status: 'failed' });
  },
);

Given(
  'bet {string} already has outcome {string}',
  (world: BridgeRunSyncerWorld, betName: string, outcome: string) => {
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ description: betName, outcome: outcome as BetOutcome, runId }));
  },
);

Given(
  'a bridge-run exists for bet {string}',
  (world: BridgeRunSyncerWorld, betName: string) => {
    const bet = world.cycle.bets.find((b) => b.description === betName);
    if (bet?.runId) {
      writeBridgeRunFile(world.bridgeRunsDir!, bet.runId, { status: 'complete' });
    }
  },
);

Given(
  'bet {string} is pending but has no run ID',
  (world: BridgeRunSyncerWorld, betName: string) => {
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending' }));
  },
);

Given(
  'bet {string} is pending with a run ID',
  (world: BridgeRunSyncerWorld, betName: string) => {
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending', runId }));
  },
);

Given(
  'no bridge-run file exists for that run',
  (_world: BridgeRunSyncerWorld) => {
    // No-op: the bridge-run file was never written
  },
);

Given(
  'the bridge-run file for that run contains invalid JSON',
  (world: BridgeRunSyncerWorld) => {
    const lastBet = world.cycle.bets[world.cycle.bets.length - 1]!;
    if (lastBet?.runId) {
      writeFileSync(join(world.bridgeRunsDir!, `${lastBet.runId}.json`), '<<<NOT JSON>>>');
    }
  },
);

Given(
  'the bridge-runs directory is not configured',
  (world: BridgeRunSyncerWorld) => {
    world.bridgeRunsDir = undefined;
  },
);

Given(
  'no run metadata directories are configured',
  (world: BridgeRunSyncerWorld) => {
    world.bridgeRunsDir = undefined;
    world.runsDir = undefined;
  },
);

Given(
  'neither the bridge-runs directory nor the runs directory is configured',
  (world: BridgeRunSyncerWorld) => {
    world.bridgeRunsDir = undefined;
    world.runsDir = undefined;
  },
);

// ── Given: incomplete run detection ──────────────────────────

Given(
  'bet {string} has a bridge-run with status {string}',
  (world: BridgeRunSyncerWorld, betName: string, status: string) => {
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending', runId }));
    writeBridgeRunFile(world.bridgeRunsDir!, runId, { status });
  },
);

Given(
  'bet {string} has a run file with status {string}',
  (world: BridgeRunSyncerWorld, betName: string, status: string) => {
    const existingBet = world.cycle.bets.find((b) => b.description === betName);
    if (existingBet?.runId) {
      writeRunFile(world.runsDir!, existingBet.runId, status);
    } else {
      const runId = randomUUID();
      world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending', runId }));
      writeRunFile(world.runsDir!, runId, status);
    }
  },
);

Given(
  'the same bet has a run file with status {string}',
  (world: BridgeRunSyncerWorld, status: string) => {
    const lastBet = world.cycle.bets[world.cycle.bets.length - 1]!;
    if (lastBet?.runId) {
      writeRunFile(world.runsDir!, lastBet.runId, status);
    }
  },
);

Given(
  'bet {string} has no run ID',
  (world: BridgeRunSyncerWorld, betName: string) => {
    world.cycle.bets.push(makeBet({ description: betName, outcome: 'pending' }));
  },
);

// ── Given: bridge-run ID lookup ──────────────────────────────

Given(
  'bridge-run metadata files exist linking bets to runs for this cycle',
  (world: BridgeRunSyncerWorld) => {
    const betId = randomUUID();
    const runId = randomUUID();
    world.cycle.bets.push(makeBet({ id: betId, outcome: 'pending', runId }));
    writeBridgeRunFile(world.bridgeRunsDir!, runId, {
      cycleId: world.cycle.id,
      betId,
      runId,
      status: 'complete',
    });
  },
);

Given(
  'bridge-run metadata files exist for a different cycle',
  (world: BridgeRunSyncerWorld) => {
    writeBridgeRunFile(world.bridgeRunsDir!, randomUUID(), {
      cycleId: randomUUID(),
      betId: randomUUID(),
      runId: randomUUID(),
      status: 'complete',
    });
  },
);

Given(
  'the bridge-runs directory does not exist on disk',
  (world: BridgeRunSyncerWorld) => {
    world.bridgeRunsDir = join(world.tmpDir, 'nonexistent-bridge-runs');
    // Directory intentionally not created
  },
);

// ── Given: outcome recording ─────────────────────────────────

Given(
  'bet outcomes to record for the cycle',
  (world: BridgeRunSyncerWorld) => {
    world.outcomesToRecord = [{ betId: randomUUID(), outcome: 'complete' }];
  },
);

Given(
  'bet outcomes referencing a bet ID that does not exist in the cycle',
  (world: BridgeRunSyncerWorld) => {
    const fakeBetId = randomUUID();
    world.outcomesToRecord = [{ betId: fakeBetId, outcome: 'complete' }];
    world.updateBetOutcomesSpy.mockReturnValue({ unmatchedBetIds: [fakeBetId] });
  },
);

// ── When ─────────────────────────────────────────────────────

When(
  'outcomes are reconciled for the cycle',
  (world: BridgeRunSyncerWorld) => {
    world.syncer = buildSyncer(world);
    try {
      world.syncedOutcomes = world.syncer.syncOutcomes(world.cycle.id);
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'cooldown checks for incomplete runs',
  (world: BridgeRunSyncerWorld) => {
    world.syncer = buildSyncer(world);
    try {
      world.incompleteRuns = world.syncer.checkIncomplete(world.cycle.id);
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'bridge-run IDs are loaded by bet',
  (world: BridgeRunSyncerWorld) => {
    world.syncer = buildSyncer(world);
    try {
      world.bridgeRunIdMap = world.syncer.loadBridgeRunIdsByBetId(world.cycle.id);
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'bet outcomes are recorded',
  (world: BridgeRunSyncerWorld) => {
    world.syncer = buildSyncer(world);
    try {
      world.syncer.recordBetOutcomes(world.cycle.id, world.outcomesToRecord ?? []);
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

// ── Then: outcome assertions ─────────────────────────────────

Then(
  'bet {string} outcome is recorded as {string}',
  (world: BridgeRunSyncerWorld, betName: string, expectedOutcome: string) => {
    expect(world.lastError).toBeUndefined();
    const bet = world.cycle.bets.find((b) => b.description === betName);
    expect(bet).toBeDefined();
    const calls = world.updateBetOutcomesSpy.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const outcomes: BetOutcomeRecord[] = calls[0]![1] as BetOutcomeRecord[];
    const match = outcomes.find((o) => o.betId === bet!.id);
    expect(match).toBeDefined();
    expect(match!.outcome).toBe(expectedOutcome);
  },
);

Then(
  'bet {string} is not re-synced',
  (world: BridgeRunSyncerWorld, betName: string) => {
    const bet = world.cycle.bets.find((b) => b.description === betName);
    expect(bet).toBeDefined();
    if (world.updateBetOutcomesSpy.mock.calls.length === 0) return;
    const outcomes = world.updateBetOutcomesSpy.mock.calls[0]![1] as BetOutcomeRecord[];
    const match = outcomes.find((o) => o.betId === bet!.id);
    expect(match).toBeUndefined();
  },
);

Then(
  'no outcomes are recorded',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.syncedOutcomes !== undefined) {
      expect(world.syncedOutcomes).toHaveLength(0);
    }
    expect(world.updateBetOutcomesSpy).not.toHaveBeenCalled();
  },
);

// ── Then: incomplete run assertions ──────────────────────────

Then(
  'bet {string} run is reported as incomplete with status {string}',
  (world: BridgeRunSyncerWorld, betName: string, expectedStatus: string) => {
    expect(world.lastError).toBeUndefined();
    const bet = world.cycle.bets.find((b) => b.description === betName);
    expect(bet).toBeDefined();
    const match = world.incompleteRuns?.find((r) => r.betId === bet!.id);
    expect(match).toBeDefined();
    expect(match!.status).toBe(expectedStatus);
  },
);

Then(
  'no incomplete runs are reported',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.incompleteRuns).toBeDefined();
    expect(world.incompleteRuns).toHaveLength(0);
  },
);

// ── Then: bridge-run ID lookup assertions ────────────────────

Then(
  'a mapping from bet ID to run ID is returned',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.bridgeRunIdMap).toBeDefined();
    expect(world.bridgeRunIdMap!.size).toBeGreaterThan(0);
  },
);

Then(
  'the mapping is empty',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.bridgeRunIdMap).toBeDefined();
    expect(world.bridgeRunIdMap!.size).toBe(0);
  },
);

// ── Then: outcome recording assertions ───────────────────────

Then(
  'the cycle manager receives the outcome updates',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.updateBetOutcomesSpy).toHaveBeenCalledWith(
      world.cycle.id,
      world.outcomesToRecord,
    );
  },
);

Then(
  'a warning is logged for the unmatched bet IDs',
  (world: BridgeRunSyncerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const warnMessage = world.loggerWarnSpy.mock.calls[0]![0] as string;
    expect(warnMessage).toContain('nonexistent bet IDs');
  },
);

// ── Then: safety assertions ──────────────────────────────────

Then(
  'cooldown continues normally',
  (world: BridgeRunSyncerWorld) => {
    expect(world.lastError).toBeUndefined();
  },
);
