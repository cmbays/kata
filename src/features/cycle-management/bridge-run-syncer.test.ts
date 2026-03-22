import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import type { Cycle } from '@domain/types/cycle.js';
import { BridgeRunSyncer, type BridgeRunSyncerDeps } from './bridge-run-syncer.js';
import type { BetOutcomeRecord } from './cooldown-session.js';

// ── Helpers ──────────────────────────────────────────────────

function makeBet(overrides: Partial<Cycle['bets'][number]> = {}): Cycle['bets'][number] {
  return {
    id: overrides.id ?? randomUUID(),
    description: overrides.description ?? 'test bet',
    appetite: 30,
    outcome: overrides.outcome ?? 'pending',
    issueRefs: [],
    ...overrides,
  };
}

function makeCycle(bets: Cycle['bets'][number][] = []): Cycle {
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

function makeDeps(overrides: Partial<BridgeRunSyncerDeps> = {}): BridgeRunSyncerDeps & {
  updateBetOutcomesSpy: ReturnType<typeof vi.fn>;
  getCycleSpy: ReturnType<typeof vi.fn>;
} {
  const updateBetOutcomesSpy = vi.fn().mockReturnValue({ unmatchedBetIds: [] });
  const getCycleSpy = vi.fn();
  return {
    bridgeRunsDir: overrides.bridgeRunsDir,
    runsDir: overrides.runsDir,
    cycleManager: {
      get: getCycleSpy,
      updateBetOutcomes: updateBetOutcomesSpy,
    } as unknown as BridgeRunSyncerDeps['cycleManager'],
    updateBetOutcomesSpy,
    getCycleSpy,
    ...overrides,
  };
}

function writeBridgeRun(dir: string, runId: string, meta: Record<string, unknown>): void {
  writeFileSync(join(dir, `${runId}.json`), JSON.stringify(meta));
}

function writeValidRunFile(dir: string, runId: string, status: string): void {
  const runDir = join(dir, runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, 'run.json'),
    JSON.stringify({
      id: runId,
      cycleId: randomUUID(),
      betId: randomUUID(),
      betPrompt: 'test',
      stageSequence: ['build'],
      currentStage: null,
      status,
      startedAt: '2026-03-22T10:00:00.000Z',
    }),
  );
}

// ── syncOutcomes ─────────────────────────────────────────────

describe('BridgeRunSyncer', () => {
  let tmpDir: string;
  let bridgeRunsDir: string;
  let runsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'brs-test-'));
    bridgeRunsDir = join(tmpDir, 'bridge-runs');
    runsDir = join(tmpDir, 'runs');
    mkdirSync(bridgeRunsDir, { recursive: true });
    mkdirSync(runsDir, { recursive: true });
  });

  describe('syncOutcomes', () => {
    it('returns empty array when bridgeRunsDir is undefined', () => {
      const deps = makeDeps();
      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.syncOutcomes('any-id')).toEqual([]);
      expect(deps.getCycleSpy).not.toHaveBeenCalled();
    });

    it('syncs completed bridge-run as "complete" outcome', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ betId: bet.id, outcome: 'complete' });
      expect(deps.updateBetOutcomesSpy).toHaveBeenCalledOnce();
    });

    it('syncs failed bridge-run as "partial" outcome', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'failed' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0].outcome).toBe('partial');
    });

    it('skips bets that already have a non-pending outcome', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'complete', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(0);
      expect(deps.updateBetOutcomesSpy).not.toHaveBeenCalled();
    });

    it('skips bets without a runId', () => {
      const bet = makeBet({ outcome: 'pending' });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(0);
    });

    it('silently skips missing bridge-run files', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);
      // No bridge-run file written

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(0);
    });

    it('silently skips corrupt bridge-run files', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeFileSync(join(bridgeRunsDir, `${runId}.json`), '<<<NOT JSON>>>');

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(0);
    });

    it('skips bridge-runs with in-progress status (not terminal)', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'in-progress' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(0);
    });

    it('handles mixed bets: some syncable, some not', () => {
      const runId1 = randomUUID();
      const runId2 = randomUUID();
      const bet1 = makeBet({ outcome: 'pending', runId: runId1 });
      const bet2 = makeBet({ outcome: 'complete', runId: runId2 });
      const bet3 = makeBet({ outcome: 'pending' }); // no runId
      const cycle = makeCycle([bet1, bet2, bet3]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId1, { status: 'complete' });
      writeBridgeRun(bridgeRunsDir, runId2, { status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.syncOutcomes(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0].betId).toBe(bet1.id);
    });
  });

  // ── checkIncomplete ──────────────────────────────────────────

  describe('checkIncomplete', () => {
    it('returns empty array when neither dir is configured', () => {
      const deps = makeDeps();
      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete('any-id')).toEqual([]);
    });

    it('reports in-progress bridge-run as running', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'in-progress' });

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.checkIncomplete(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ runId, betId: bet.id, status: 'running' });
    });

    it('reports pending run file as pending', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ runsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeValidRunFile(runsDir, runId, 'pending');

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.checkIncomplete(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('pending');
    });

    it('does not report failed bridge-runs as incomplete', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'failed' });

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete(cycle.id)).toHaveLength(0);
    });

    it('does not report completed bridge-runs', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete(cycle.id)).toHaveLength(0);
    });

    it('bridge-run status takes precedence over run file status', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir, runsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      writeBridgeRun(bridgeRunsDir, runId, { status: 'complete' });
      writeValidRunFile(runsDir, runId, 'running');

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete(cycle.id)).toHaveLength(0);
    });

    it('falls back to run file when no bridge-run exists', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir, runsDir });
      deps.getCycleSpy.mockReturnValue(cycle);
      // No bridge-run file written
      writeValidRunFile(runsDir, runId, 'running');

      const syncer = new BridgeRunSyncer(deps);
      const result = syncer.checkIncomplete(cycle.id);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('running');
    });

    it('skips bets without a runId', () => {
      const bet = makeBet({ outcome: 'pending' });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ bridgeRunsDir });
      deps.getCycleSpy.mockReturnValue(cycle);

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete(cycle.id)).toHaveLength(0);
    });

    it('silently skips unreadable run files', () => {
      const runId = randomUUID();
      const bet = makeBet({ outcome: 'pending', runId });
      const cycle = makeCycle([bet]);
      const deps = makeDeps({ runsDir });
      deps.getCycleSpy.mockReturnValue(cycle);
      // No run file written — readRun will throw

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.checkIncomplete(cycle.id)).toHaveLength(0);
    });
  });

  // ── loadBridgeRunIdsByBetId ──────────────────────────────────

  describe('loadBridgeRunIdsByBetId', () => {
    it('returns empty map when bridgeRunsDir is undefined', () => {
      const deps = makeDeps();
      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.loadBridgeRunIdsByBetId('any-id').size).toBe(0);
    });

    it('returns empty map when directory does not exist', () => {
      const deps = makeDeps({ bridgeRunsDir: join(tmpDir, 'nonexistent') });
      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.loadBridgeRunIdsByBetId('any-id').size).toBe(0);
    });

    it('maps betId to runId from matching cycle metadata', () => {
      const betId = randomUUID();
      const runId = randomUUID();
      const cycleId = randomUUID();
      const deps = makeDeps({ bridgeRunsDir });

      writeBridgeRun(bridgeRunsDir, runId, { cycleId, betId, runId, status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      const map = syncer.loadBridgeRunIdsByBetId(cycleId);

      expect(map.size).toBe(1);
      expect(map.get(betId)).toBe(runId);
    });

    it('excludes metadata from different cycles', () => {
      const deps = makeDeps({ bridgeRunsDir });

      writeBridgeRun(bridgeRunsDir, randomUUID(), {
        cycleId: randomUUID(),
        betId: randomUUID(),
        runId: randomUUID(),
      });

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.loadBridgeRunIdsByBetId(randomUUID()).size).toBe(0);
    });

    it('skips files without betId or runId', () => {
      const cycleId = randomUUID();
      const deps = makeDeps({ bridgeRunsDir });

      writeBridgeRun(bridgeRunsDir, randomUUID(), { cycleId, status: 'complete' });

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.loadBridgeRunIdsByBetId(cycleId).size).toBe(0);
    });

    it('skips corrupt JSON files gracefully', () => {
      const deps = makeDeps({ bridgeRunsDir });
      writeFileSync(join(bridgeRunsDir, 'bad.json'), '<<<NOT JSON>>>');

      const syncer = new BridgeRunSyncer(deps);
      expect(syncer.loadBridgeRunIdsByBetId(randomUUID()).size).toBe(0);
    });
  });

  // ── recordBetOutcomes ────────────────────────────────────────

  describe('recordBetOutcomes', () => {
    it('delegates to cycleManager.updateBetOutcomes', () => {
      const deps = makeDeps({ bridgeRunsDir });
      const syncer = new BridgeRunSyncer(deps);
      const outcomes: BetOutcomeRecord[] = [{ betId: randomUUID(), outcome: 'complete' }];

      syncer.recordBetOutcomes('cycle-1', outcomes);

      expect(deps.updateBetOutcomesSpy).toHaveBeenCalledWith('cycle-1', outcomes);
    });

    it('logs a warning for unmatched bet IDs but does not throw', () => {
      const fakeBetId = randomUUID();
      const deps = makeDeps({ bridgeRunsDir });
      deps.updateBetOutcomesSpy.mockReturnValue({ unmatchedBetIds: [fakeBetId] });

      const syncer = new BridgeRunSyncer(deps);
      expect(() => syncer.recordBetOutcomes('cycle-1', [{ betId: fakeBetId, outcome: 'complete' }])).not.toThrow();
    });

    it('does not warn when all bet IDs match', () => {
      const deps = makeDeps({ bridgeRunsDir });
      deps.updateBetOutcomesSpy.mockReturnValue({ unmatchedBetIds: [] });

      const syncer = new BridgeRunSyncer(deps);
      syncer.recordBetOutcomes('cycle-1', [{ betId: randomUUID(), outcome: 'complete' }]);

      // No warning — unmatchedBetIds is empty
      expect(deps.updateBetOutcomesSpy).toHaveBeenCalledOnce();
    });
  });
});
