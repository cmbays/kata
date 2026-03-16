import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleSchema } from '@domain/types/cycle.js';
import { RunSchema } from '@domain/types/run-state.js';
import type { AgentCompletionResult } from '@domain/ports/session-bridge.js';
import { logger } from '@shared/lib/logger.js';
import { SessionExecutionBridge } from './session-bridge.js';
import { canTransitionCycleState } from './session-bridge.helpers.js';

function createTestDir(): string {
  const dir = join(tmpdir(), `kata-bridge-unit-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createCycle(
  kataDir: string,
  overrides: Partial<{
    id: string;
    name: string;
    state: 'planning' | 'active' | 'cooldown' | 'complete';
    budget: Record<string, unknown>;
    bets: unknown[];
  }> = {},
): ReturnType<typeof CycleSchema.parse> {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  const cycle = CycleSchema.parse({
    id,
    name: overrides.name ?? 'Test Cycle',
    budget: overrides.budget ?? { tokenBudget: 100000 },
    bets: overrides.bets ?? [
      {
        id: randomUUID(),
        description: 'Fix the login bug',
        appetite: 30,
        outcome: 'pending',
      },
      {
        id: randomUUID(),
        description: 'Tighten tests',
        appetite: 20,
        outcome: 'pending',
      },
    ],
    state: overrides.state ?? 'active',
    createdAt: now,
    updatedAt: now,
  });

  const cyclesDir = join(kataDir, 'cycles');
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${cycle.id}.json`), JSON.stringify(cycle, null, 2));

  return cycle;
}

function writeHistoryEntry(kataDir: string, cycleId: string, total: number): void {
  const historyDir = join(kataDir, 'history');
  mkdirSync(historyDir, { recursive: true });
  writeFileSync(
    join(historyDir, `${randomUUID()}.json`),
    JSON.stringify({
      id: randomUUID(),
      pipelineId: randomUUID(),
      stageType: 'build',
      stageIndex: 0,
      adapter: 'claude-native',
      cycleId,
      tokenUsage: {
        inputTokens: Math.floor(total / 2),
        outputTokens: Math.ceil(total / 2),
        total,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
      },
      startedAt: '2026-03-15T10:00:00.000Z',
      completedAt: '2026-03-15T10:10:00.000Z',
    }),
  );
}

describe('SessionExecutionBridge unit coverage', () => {
  let kataDir: string;

  beforeEach(() => {
    kataDir = createTestDir();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(kataDir, { recursive: true, force: true });
  });

  it('formats agent context through the extracted formatter', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    const context = bridge.formatAgentContext(prepared);

    expect(context).toContain('## Kata Run Context');
    expect(context).toContain(`- **Run ID**: ${prepared.runId}`);
  });

  it('resolves stages for ad-hoc, named, and missing named kata assignments', () => {
    mkdirSync(join(kataDir, 'katas'), { recursive: true });
    writeFileSync(
      join(kataDir, 'katas', 'research-plan.json'),
      JSON.stringify({ stages: ['research', 'plan'] }, null, 2),
    );

    const adHocBetId = randomUUID();
    const namedBetId = randomUUID();
    const missingNamedBetId = randomUUID();
    createCycle(kataDir, {
      bets: [
        {
          id: adHocBetId,
          description: 'Research only',
          appetite: 10,
          outcome: 'pending',
          kata: { type: 'ad-hoc', stages: ['research'] },
        },
        {
          id: namedBetId,
          description: 'Load saved kata',
          appetite: 10,
          outcome: 'pending',
          kata: { type: 'named', pattern: 'research-plan' },
        },
        {
          id: missingNamedBetId,
          description: 'Fall back to defaults',
          appetite: 10,
          outcome: 'pending',
          kata: { type: 'named', pattern: 'missing-kata' },
        },
      ],
    });

    const bridge = new SessionExecutionBridge(kataDir);

    expect(bridge.prepare(adHocBetId).stages).toEqual(['research']);
    expect(bridge.prepare(namedBetId).stages).toEqual(['research', 'plan']);
    expect(bridge.prepare(missingNamedBetId).stages).toEqual(['research', 'plan', 'build', 'review']);
  });

  it('reuses existing prepared runs when an active cycle is renamed and attributed later', () => {
    const cycle = createCycle(kataDir, { state: 'planning', name: 'Original Cycle' });
    const bridge = new SessionExecutionBridge(kataDir);

    const first = bridge.prepareCycle(cycle.id);
    const agentId = randomUUID();
    const second = bridge.prepareCycle(cycle.id, agentId, 'Renamed Cycle');

    expect(second.preparedRuns.map((run) => run.runId)).toEqual(first.preparedRuns.map((run) => run.runId));
    expect(second.preparedRuns.every((run) => run.agentId === agentId)).toBe(true);

    const cycleJson = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
    expect(cycleJson.name).toBe('Renamed Cycle');

    const bridgeMeta = JSON.parse(readFileSync(join(kataDir, 'bridge-runs', `${first.preparedRuns[0]!.runId}.json`), 'utf-8'));
    expect(bridgeMeta.cycleName).toBe('Renamed Cycle');
    expect(bridgeMeta.agentId).toBe(agentId);

    const runJson = RunSchema.parse(JSON.parse(readFileSync(join(kataDir, 'runs', first.preparedRuns[0]!.runId, 'run.json'), 'utf-8')));
    expect(runJson.agentId).toBe(agentId);
    expect(runJson.katakaId).toBe(agentId);
  });

  it('warns and preserves cycle state for invalid state transitions', () => {
    const cycle = createCycle(kataDir, { state: 'planning' });
    const bridge = new SessionExecutionBridge(kataDir);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      (bridge as unknown as { updateCycleState: (cycleId: string, state: 'complete') => void }).updateCycleState(cycle.id, 'complete');

      const persisted = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
      expect(persisted.state).toBe('planning');
      expect(warnSpy).toHaveBeenCalledWith(`Cannot transition cycle "${cycle.id}" from "planning" to "complete".`);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('only allows adjacent forward cycle state transitions', () => {
    expect(canTransitionCycleState('planning', 'active')).toBe(true);
    expect(canTransitionCycleState('active', 'cooldown')).toBe(true);
    expect(canTransitionCycleState('cooldown', 'complete')).toBe(true);
    expect(canTransitionCycleState('planning', 'complete')).toBe(false);
    expect(canTransitionCycleState('active', 'complete')).toBe(false);
    expect(canTransitionCycleState('complete', 'planning')).toBe(false);
  });

  it('warns when updateBetOutcomeInCycle cannot find the cycle file', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      (bridge as unknown as {
        updateBetOutcomeInCycle: (cycleId: string, betId: string, outcome: 'complete') => void;
      }).updateBetOutcomeInCycle('missing-cycle', 'bet-1', 'complete');

      expect(warnSpy).toHaveBeenCalledWith('Cannot update bet outcome: cycle file not found for cycle "missing-cycle".');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('warns when backfillRunIdInCycle cannot find the target bet', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      (bridge as unknown as {
        backfillRunIdInCycle: (cycleId: string, betId: string, runId: string) => void;
      }).backfillRunIdInCycle(cycle.id, 'missing-bet', 'run-123');

      expect(warnSpy).toHaveBeenCalledWith(`Cannot backfill bet.runId: bet "missing-bet" not found in cycle "${cycle.id}".`);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('refreshes prepared-run metadata only when bet or cycle names change', () => {
    const cycle = createCycle(kataDir, { name: 'Renamed Cycle' });
    const bridge = new SessionExecutionBridge(kataDir);
    const writeBridgeRunMeta = vi.spyOn(bridge as never, 'writeBridgeRunMeta').mockImplementation(() => {});
    const updateRunJsonAgentAttribution = vi.spyOn(bridge as never, 'updateRunJsonAgentAttribution').mockImplementation(() => {});
    const meta = {
      runId: 'run-1',
      betId: cycle.bets[0]!.id,
      betName: 'Old Bet Name',
      cycleId: cycle.id,
      cycleName: 'Old Cycle Name',
      stages: ['research', 'build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    };

    const updated = (bridge as unknown as {
      refreshPreparedRunMeta: (meta: typeof meta, bet: typeof cycle.bets[number], cycle: typeof cycle, agentId?: string) => typeof meta;
    }).refreshPreparedRunMeta(meta, { ...cycle.bets[0]!, description: 'New Bet Name' }, cycle);

    expect(updated.betName).toBe('New Bet Name');
    expect(updated.cycleName).toBe('Renamed Cycle');
    expect(writeBridgeRunMeta).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      betName: 'New Bet Name',
      cycleName: 'Renamed Cycle',
    }));
    expect(updateRunJsonAgentAttribution).not.toHaveBeenCalled();
  });

  it('does not rewrite prepared-run metadata when nothing changed and no agent was added', () => {
    const cycle = createCycle(kataDir, { name: 'Stable Cycle' });
    const bridge = new SessionExecutionBridge(kataDir);
    const writeBridgeRunMeta = vi.spyOn(bridge as never, 'writeBridgeRunMeta').mockImplementation(() => {});
    const meta = {
      runId: 'run-1',
      betId: cycle.bets[0]!.id,
      betName: cycle.bets[0]!.description,
      cycleId: cycle.id,
      cycleName: 'Stable Cycle',
      stages: ['research', 'build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    };

    const updated = (bridge as unknown as {
      refreshPreparedRunMeta: (meta: typeof meta, bet: typeof cycle.bets[number], cycle: typeof cycle, agentId?: string) => typeof meta;
    }).refreshPreparedRunMeta(meta, cycle.bets[0]!, cycle);

    expect(updated).toEqual(meta);
    expect(writeBridgeRunMeta).not.toHaveBeenCalled();
  });

  it('rebuilds prepared runs with manifest metadata and canonical agent attribution fallback', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const meta = {
      runId: 'run-1',
      betId: 'bet-1',
      betName: 'Bridge Bet',
      cycleId: 'cycle-1',
      cycleName: 'Bridge Cycle',
      stages: ['research', 'build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
      katakaId: 'agent-123',
    };

    const prepared = (bridge as unknown as {
      rebuildPreparedRun: (meta: typeof meta) => ReturnType<SessionExecutionBridge['prepare']>;
    }).rebuildPreparedRun(meta);

    expect(prepared.manifest.stageType).toBe('research,build');
    expect(prepared.manifest.prompt).toBe('Execute the bet: "Bridge Bet"');
    expect(prepared.manifest.context.metadata).toMatchObject({
      betId: 'bet-1',
      cycleId: 'cycle-1',
      cycleName: 'Bridge Cycle',
      runId: 'run-1',
      adapter: 'claude-native',
    });
    expect(prepared.agentId).toBe('agent-123');
    expect(prepared.katakaId).toBe('agent-123');
  });

  it('lists bridge runs for a cycle while ignoring invalid and non-json files', () => {
    const bridgeRunsDir = join(kataDir, 'bridge-runs');
    mkdirSync(bridgeRunsDir, { recursive: true });
    writeFileSync(join(bridgeRunsDir, 'notes.txt'), JSON.stringify({ cycleId: 'cycle-1', runId: 'txt-run' }));
    writeFileSync(join(bridgeRunsDir, 'broken.json'), '{ broken json ');
    writeFileSync(join(bridgeRunsDir, 'other.json'), JSON.stringify({
      runId: 'run-other',
      betId: 'bet-other',
      betName: 'Other Bet',
      cycleId: 'other-cycle',
      cycleName: 'Other Cycle',
      stages: ['build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    }));
    writeFileSync(join(bridgeRunsDir, 'match.json'), JSON.stringify({
      runId: 'run-match',
      betId: 'bet-match',
      betName: 'Matching Bet',
      cycleId: 'cycle-1',
      cycleName: 'Matching Cycle',
      stages: ['build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    }));

    const bridge = new SessionExecutionBridge(kataDir);
    const metas = (bridge as unknown as {
      listBridgeRunsForCycle: (cycleId: string) => Array<{ runId: string; cycleId: string }>;
    }).listBridgeRunsForCycle('cycle-1');

    expect(metas).toHaveLength(1);
    expect(metas[0]).toMatchObject({ runId: 'run-match', cycleId: 'cycle-1' });
  });

  it('ignores cycle-shaped non-json files when finding the cycle for a bet', () => {
    const realCycle = createCycle(kataDir);
    const fakeBetId = randomUUID();
    const now = new Date().toISOString();
    writeFileSync(join(kataDir, 'cycles', 'ignored.txt'), JSON.stringify({
      id: 'txt-cycle',
      name: 'Ignored Text Cycle',
      budget: { tokenBudget: 100000 },
      bets: [{
        id: fakeBetId,
        description: 'Text-backed bet',
        appetite: 10,
        outcome: 'pending',
      }],
      state: 'active',
      createdAt: now,
      updatedAt: now,
    }, null, 2));

    const bridge = new SessionExecutionBridge(kataDir);
    const findCycleForBet = (bridge as unknown as {
      findCycleForBet: (betId: string) => ReturnType<typeof CycleSchema.parse>;
    }).findCycleForBet.bind(bridge);

    expect(findCycleForBet(realCycle.bets[0]!.id).id).toBe(realCycle.id);
    expect(() => findCycleForBet(fakeBetId)).toThrow(`No cycle found containing bet "${fakeBetId}".`);
  });

  it('ignores cycle-shaped non-json files when loading a cycle by id or name', () => {
    const realCycle = createCycle(kataDir);
    const now = new Date().toISOString();
    writeFileSync(join(kataDir, 'cycles', 'shadow.txt'), JSON.stringify({
      id: 'shadow-cycle',
      name: 'Shadow Cycle',
      budget: { tokenBudget: 100000 },
      bets: [],
      state: 'active',
      createdAt: now,
      updatedAt: now,
    }, null, 2));

    const bridge = new SessionExecutionBridge(kataDir);
    const loadCycle = (bridge as unknown as {
      loadCycle: (cycleId: string) => ReturnType<typeof CycleSchema.parse>;
    }).loadCycle.bind(bridge);

    expect(loadCycle(realCycle.id).id).toBe(realCycle.id);
    expect(() => loadCycle('shadow-cycle')).toThrow('Cycle "shadow-cycle" not found.');
    expect(() => loadCycle('Shadow Cycle')).toThrow('Cycle "Shadow Cycle" not found.');
  });

  it('counts zero run data when jsonl files and stage directories are absent', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const runDir = join(kataDir, 'runs', 'run-1');
    mkdirSync(runDir, { recursive: true });

    const counts = (bridge as unknown as {
      countRunData: (runId: string) => { observations: number; artifacts: number; decisions: number; lastTimestamp: string | null };
    }).countRunData('run-1');

    expect(counts).toEqual({
      observations: 0,
      artifacts: 0,
      decisions: 0,
      lastTimestamp: null,
    });
  });

  it('sums cycle history tokens while ignoring non-json and missing-token entries', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const historyDir = join(kataDir, 'history');
    mkdirSync(historyDir, { recursive: true });

    writeFileSync(join(historyDir, 'first.json'), JSON.stringify({ cycleId: 'cycle-1', tokenUsage: { total: 1200 } }));
    writeFileSync(join(historyDir, 'missing.json'), JSON.stringify({ cycleId: 'cycle-1' }));
    writeFileSync(join(historyDir, 'other.json'), JSON.stringify({ cycleId: 'other-cycle', tokenUsage: { total: 9999 } }));
    writeFileSync(join(historyDir, 'notes.txt'), JSON.stringify({ cycleId: 'cycle-1', tokenUsage: { total: 5000 } }));

    const total = (bridge as unknown as {
      sumCycleHistoryTokens: (historyDir: string, cycleId: string) => number;
    }).sumCycleHistoryTokens(historyDir, 'cycle-1');

    expect(total).toBe(1200);
  });

  it('reports status counts from run data and estimates budget from matching history entries', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepareCycle(cycle.id);
    const runId = prepared.preparedRuns[0]!.runId;

    const runDir = join(kataDir, 'runs', runId);
    mkdirSync(join(runDir, 'stages', 'build'), { recursive: true });
    writeFileSync(join(runDir, 'observations.jsonl'), '{"note":"run"}\n');
    writeFileSync(join(runDir, 'artifacts.jsonl'), '{"name":"artifact"}\n');
    writeFileSync(join(runDir, 'decisions.jsonl'), '{"decision":"ship"}\n');
    writeFileSync(join(runDir, 'stages', 'build', 'observations.jsonl'), '{"note":"stage1"}\n{"note":"stage2"}\n');
    writeFileSync(join(runDir, 'stages', 'build', 'decisions.jsonl'), '{"decision":"refactor"}\n');

    writeHistoryEntry(kataDir, cycle.id, 15000);
    writeHistoryEntry(kataDir, randomUUID(), 9000);
    writeFileSync(join(kataDir, 'history', 'broken.json'), '{not-json');

    const status = bridge.getCycleStatus(cycle.id);
    const preparedBet = status.bets.find((bet) => bet.runId === runId);

    expect(preparedBet).toMatchObject({
      status: 'in-progress',
      kansatsuCount: 3,
      artifactCount: 1,
      decisionCount: 2,
    });
    expect(preparedBet?.lastActivity).toBeTruthy();
    expect(status.elapsed).toMatch(/[smh]/);
    expect(status.budgetUsed).toEqual({ percent: 15, tokenEstimate: 15000 });
  });

  it('returns zero counts when the run directory is missing and null budget when no token budget exists', () => {
    const cycle = createCycle(kataDir, {
      budget: {},
      bets: [
        {
          id: randomUUID(),
          description: 'Single bet',
          appetite: 10,
          outcome: 'pending',
        },
      ],
    });
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepareCycle(cycle.id);
    const runId = prepared.preparedRuns[0]!.runId;

    rmSync(join(kataDir, 'runs', runId), { recursive: true, force: true });

    const status = bridge.getCycleStatus(cycle.id);

    expect(status.budgetUsed).toBeNull();
    expect(status.bets[0]).toMatchObject({
      runId,
      kansatsuCount: 0,
      artifactCount: 0,
      decisionCount: 0,
      lastActivity: null,
    });
  });

  it('completes pending runs, aggregates durations and token usage, and updates outcomes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));

    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepareCycle(cycle.id);

    const firstMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[0]!.runId}.json`);
    const secondMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[1]!.runId}.json`);
    const firstMeta = JSON.parse(readFileSync(firstMetaPath, 'utf-8')) as { startedAt: string };
    const secondMeta = JSON.parse(readFileSync(secondMetaPath, 'utf-8')) as { startedAt: string };
    firstMeta.startedAt = '2026-03-15T11:58:00.000Z';
    secondMeta.startedAt = '2026-03-15T11:59:00.000Z';
    writeFileSync(firstMetaPath, JSON.stringify(firstMeta, null, 2));
    writeFileSync(secondMetaPath, JSON.stringify(secondMeta, null, 2));

    const firstRunId = prepared.preparedRuns[0]!.runId;
    const secondRunId = prepared.preparedRuns[1]!.runId;
    const results: Record<string, AgentCompletionResult> = {
      [firstRunId]: {
        success: false,
        tokenUsage: { inputTokens: 1000, outputTokens: 400, total: 1400 },
      },
    };

    const summary = bridge.completeCycle(cycle.id, results);

    expect(summary.completedBets).toBe(1);
    expect(summary.totalBets).toBe(2);
    expect(summary.totalDurationMs).toBe(180000);
    expect(summary.tokenUsage).toEqual({ inputTokens: 1000, outputTokens: 400, total: 1400 });

    const firstRun = RunSchema.parse(JSON.parse(readFileSync(join(kataDir, 'runs', firstRunId, 'run.json'), 'utf-8')));
    const secondRun = RunSchema.parse(JSON.parse(readFileSync(join(kataDir, 'runs', secondRunId, 'run.json'), 'utf-8')));
    expect(firstRun.status).toBe('failed');
    expect(secondRun.status).toBe('completed');

    const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
    expect(updatedCycle.bets.map((bet) => bet.outcome)).toEqual(expect.arrayContaining(['partial', 'complete']));
    expect(existsSync(join(kataDir, 'history'))).toBe(true);
  });
});
