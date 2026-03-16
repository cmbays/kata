import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  it('getAgentContext rejects a completed run in terminal state', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    bridge.complete(prepared.runId, { success: true });

    expect(() => bridge.getAgentContext(prepared.runId)).toThrow(
      `Run "${prepared.runId}" is in terminal state "complete" and cannot be dispatched.`,
    );
  });

  it('getAgentContext rejects a failed run in terminal state', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    bridge.complete(prepared.runId, { success: false });

    expect(() => bridge.getAgentContext(prepared.runId)).toThrow(
      `Run "${prepared.runId}" is in terminal state "failed" and cannot be dispatched.`,
    );
  });

  it('getAgentContext throws for non-existent run', () => {
    const bridge = new SessionExecutionBridge(kataDir);

    expect(() => bridge.getAgentContext('nonexistent-run')).toThrow(
      'No bridge run found for run ID "nonexistent-run".',
    );
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

  it('estimateBudgetUsage returns null when cycle has no tokenBudget', () => {
    const cycle = createCycle(kataDir, { budget: {} });
    const bridge = new SessionExecutionBridge(kataDir);

    const result = (bridge as unknown as {
      estimateBudgetUsage: (cycle: typeof cycle) => { percent: number; tokenEstimate: number } | null;
    }).estimateBudgetUsage(cycle);

    expect(result).toBeNull();
  });

  it('estimateBudgetUsage returns zero when history dir is missing', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);

    const result = (bridge as unknown as {
      estimateBudgetUsage: (cycle: typeof cycle) => { percent: number; tokenEstimate: number } | null;
    }).estimateBudgetUsage(cycle);

    expect(result).toEqual({ percent: 0, tokenEstimate: 0 });
  });

  it('countJsonlLines returns 0 for missing files and counts lines for present files', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const countJsonlLines = (bridge as unknown as {
      countJsonlLines: (filePath: string) => number;
    }).countJsonlLines.bind(bridge);

    // Missing file should return 0
    expect(countJsonlLines(join(kataDir, 'nonexistent.jsonl'))).toBe(0);

    // Present file with content
    const filePath = join(kataDir, 'test.jsonl');
    writeFileSync(filePath, '{"a":1}\n{"b":2}\n');
    expect(countJsonlLines(filePath)).toBe(2);
  });

  it('countRunData returns zero counts and null lastTimestamp when run directory is missing', () => {
    const bridge = new SessionExecutionBridge(kataDir);

    const counts = (bridge as unknown as {
      countRunData: (runId: string) => { observations: number; artifacts: number; decisions: number; lastTimestamp: string | null };
    }).countRunData('nonexistent-run-id');

    expect(counts).toEqual({ observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null });
  });

  it('countRunData gracefully handles stagesDir that exists but contains no stage subdirectories', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const runDir = join(kataDir, 'runs', 'run-empty-stages');
    mkdirSync(join(runDir, 'stages'), { recursive: true });

    const counts = (bridge as unknown as {
      countRunData: (runId: string) => { observations: number; artifacts: number; decisions: number; lastTimestamp: string | null };
    }).countRunData('run-empty-stages');

    expect(counts).toEqual({ observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null });
  });

  it('prepareCycle deduplicates bridge runs by betId keeping only the first match per bet', () => {
    const betId = randomUUID();
    const cycle = createCycle(kataDir, {
      state: 'planning',
      bets: [
        { id: betId, description: 'Dedup bet', appetite: 10, outcome: 'pending' },
      ],
    });
    const bridge = new SessionExecutionBridge(kataDir);

    // First prepare creates one run
    const first = bridge.prepareCycle(cycle.id);
    expect(first.preparedRuns).toHaveLength(1);

    // Create a second bridge-run for the same bet manually (simulating a duplicate)
    const bridgeRunsDir = join(kataDir, 'bridge-runs');
    writeFileSync(join(bridgeRunsDir, `${randomUUID()}.json`), JSON.stringify({
      runId: randomUUID(),
      betId,
      betName: 'Dedup bet',
      cycleId: cycle.id,
      cycleName: 'Test Cycle',
      stages: ['research', 'plan', 'build', 'review'],
      isolation: 'worktree',
      startedAt: new Date().toISOString(),
      status: 'in-progress',
    }));

    // Re-prepare: should still reuse the first run, not the duplicate
    const second = bridge.prepareCycle(cycle.id);
    expect(second.preparedRuns).toHaveLength(1);
    expect(second.preparedRuns[0]!.runId).toBe(first.preparedRuns[0]!.runId);
  });

  it('prepareCycle backfills runId when bet.runId differs from the reused bridge-run runId', () => {
    const betId = randomUUID();
    const cycle = createCycle(kataDir, {
      state: 'planning',
      bets: [
        { id: betId, description: 'Backfill bet', appetite: 10, outcome: 'pending' },
      ],
    });
    const bridge = new SessionExecutionBridge(kataDir);

    // First prepare — creates bridge run and backfills bet.runId
    const first = bridge.prepareCycle(cycle.id);
    const runId = first.preparedRuns[0]!.runId;

    // Verify bet.runId was set
    const cycleAfterFirst = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
    expect(cycleAfterFirst.bets[0]!.runId).toBe(runId);

    // Second prepare — should reuse the existing run and not change the runId
    const second = bridge.prepareCycle(cycle.id);
    expect(second.preparedRuns[0]!.runId).toBe(runId);

    // bet.runId should still match
    const cycleAfterSecond = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
    expect(cycleAfterSecond.bets[0]!.runId).toBe(runId);
  });

  it('resolveStages reads stages from a named kata file on disk', () => {
    mkdirSync(join(kataDir, 'katas'), { recursive: true });
    writeFileSync(
      join(kataDir, 'katas', 'quick-review.json'),
      JSON.stringify({ stages: ['review'] }, null, 2),
    );

    const betId = randomUUID();
    createCycle(kataDir, {
      bets: [
        {
          id: betId,
          description: 'Named kata stages',
          appetite: 10,
          outcome: 'pending',
          kata: { type: 'named', pattern: 'quick-review' },
        },
      ],
    });

    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(betId);

    expect(prepared.stages).toEqual(['review']);
    // Named kata with only review → shared isolation (no build stage)
    expect(prepared.isolation).toBe('shared');
  });

  it('resolveStages falls back to defaults when named kata file has no stages field', () => {
    mkdirSync(join(kataDir, 'katas'), { recursive: true });
    writeFileSync(
      join(kataDir, 'katas', 'empty-kata.json'),
      JSON.stringify({ name: 'empty-kata' }, null, 2),
    );

    const betId = randomUUID();
    createCycle(kataDir, {
      bets: [
        {
          id: betId,
          description: 'Fallback stages',
          appetite: 10,
          outcome: 'pending',
          kata: { type: 'named', pattern: 'empty-kata' },
        },
      ],
    });

    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(betId);

    expect(prepared.stages).toEqual(['research', 'plan', 'build', 'review']);
  });

  it('writeCycleNameIfChanged skips write when name matches current cycle name', () => {
    const cycle = createCycle(kataDir, { name: 'Same Name' });
    const bridge = new SessionExecutionBridge(kataDir);
    const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);

    const updatedAtBefore = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8'))).updatedAt;

    // Call writeCycleNameIfChanged with the same name
    (bridge as unknown as {
      writeCycleNameIfChanged: (path: string, cycle: typeof cycle, name?: string) => void;
    }).writeCycleNameIfChanged(cyclePath, cycle, 'Same Name');

    const updatedAtAfter = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8'))).updatedAt;
    expect(updatedAtAfter).toBe(updatedAtBefore);
  });

  it('writeCycleNameIfChanged updates when name is different', () => {
    const cycle = createCycle(kataDir, { name: 'Old Name' });
    const bridge = new SessionExecutionBridge(kataDir);
    const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);

    (bridge as unknown as {
      writeCycleNameIfChanged: (path: string, cycle: typeof cycle, name?: string) => void;
    }).writeCycleNameIfChanged(cyclePath, cycle, 'New Name');

    const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
    expect(updatedCycle.name).toBe('New Name');
  });

  it('formatDuration handles hours, minutes, and seconds', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const formatDuration = (bridge as unknown as {
      formatDuration: (ms: number) => string;
    }).formatDuration.bind(bridge);

    expect(formatDuration(500)).toBe('0s');
    expect(formatDuration(30000)).toBe('30s');
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m');
    expect(formatDuration(3660000)).toBe('1h 1m');
  });

  it('updateCycleState is a no-op when cycle is already in the target state', () => {
    const cycle = createCycle(kataDir, { state: 'active', name: 'No-op State' });
    const bridge = new SessionExecutionBridge(kataDir);
    const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);

    const before = readFileSync(cyclePath, 'utf-8');

    (bridge as unknown as {
      updateCycleState: (cycleId: string, state: 'active', name?: string) => void;
    }).updateCycleState(cycle.id, 'active');

    const after = readFileSync(cyclePath, 'utf-8');
    // updatedAt should not change when state is already 'active' and no name change
    expect(JSON.parse(after).updatedAt).toBe(JSON.parse(before).updatedAt);
  });

  it('collectCycleCompletionTotals re-reads bridge run metadata and filters nulls', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepareCycle(cycle.id);

    // Complete one run, leave the other in-progress
    bridge.complete(prepared.preparedRuns[0]!.runId, { success: true });

    // Call collectCycleCompletionTotals directly
    const bridgeRuns = (bridge as unknown as {
      listBridgeRunsForCycle: (cycleId: string) => Array<{ runId: string }>;
    }).listBridgeRunsForCycle(cycle.id);

    const totals = (bridge as unknown as {
      collectCycleCompletionTotals: (bridgeRuns: Array<{ runId: string }>) => { completedBets: number; totalDurationMs: number };
    }).collectCycleCompletionTotals(bridgeRuns);

    expect(totals.completedBets).toBeGreaterThanOrEqual(1);
  });

  it('readBridgeRunMeta returns null when file does not exist', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const result = (bridge as unknown as {
      readBridgeRunMeta: (runId: string) => unknown;
    }).readBridgeRunMeta('nonexistent-run-id');

    expect(result).toBeNull();
  });

  it('updateRunJsonOnComplete is no-op when run.json does not exist', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      // Create a bridge run but delete the run.json
      const cycle = createCycle(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);
      rmSync(join(kataDir, 'runs', prepared.runId, 'run.json'));

      // Complete should succeed (history entry written) even if run.json is missing
      bridge.complete(prepared.runId, { success: true });

      // Check that run.json was NOT recreated
      expect(existsSync(join(kataDir, 'runs', prepared.runId, 'run.json'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('updateRunJsonAgentAttribution is no-op when run.json does not exist', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const first = bridge.prepareCycle(cycle.id);
      const runId = first.preparedRuns[0]!.runId;

      // Delete run.json
      rmSync(join(kataDir, 'runs', runId, 'run.json'));

      // Re-prepare with agent ID — should not crash
      const agentId = randomUUID();
      bridge.prepareCycle(cycle.id, agentId);

      // run.json was NOT recreated
      expect(existsSync(join(kataDir, 'runs', runId, 'run.json'))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('completeCycle filters out null metadata from re-read bridgeRuns', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T10:00:00.000Z'));

    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepareCycle(cycle.id);

    // Delete one bridge-run metadata file to simulate a corrupt/missing state
    const runIdToDelete = prepared.preparedRuns[1]!.runId;
    rmSync(join(kataDir, 'bridge-runs', `${runIdToDelete}.json`));

    // completeCycle should still work, filtering out the null
    const summary = bridge.completeCycle(cycle.id, {});

    // The cycle has 2 bets but only 1 bridge-run remains
    expect(summary.totalBets).toBe(2);
  });

  it('countJsonlLines returns 0 when file exists but is empty', () => {
    const bridge = new SessionExecutionBridge(kataDir);
    const countJsonlLines = (bridge as unknown as {
      countJsonlLines: (filePath: string) => number;
    }).countJsonlLines.bind(bridge);

    const filePath = join(kataDir, 'empty.jsonl');
    writeFileSync(filePath, '');
    expect(countJsonlLines(filePath)).toBe(0);
  });

  it('listBridgeRunsForCycle filters non-json files from results', () => {
    const bridgeRunsDir = join(kataDir, 'bridge-runs');
    mkdirSync(bridgeRunsDir, { recursive: true });

    // Write a valid bridge-run as .txt — should be filtered out by isJsonFile
    writeFileSync(join(bridgeRunsDir, 'valid.txt'), JSON.stringify({
      runId: 'run-txt',
      betId: 'bet-txt',
      betName: 'Text Bet',
      cycleId: 'cycle-1',
      cycleName: 'Test Cycle',
      stages: ['build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    }));

    // Write the same as .json — should be included
    writeFileSync(join(bridgeRunsDir, 'valid.json'), JSON.stringify({
      runId: 'run-json',
      betId: 'bet-json',
      betName: 'Json Bet',
      cycleId: 'cycle-1',
      cycleName: 'Test Cycle',
      stages: ['build'],
      isolation: 'shared',
      startedAt: '2026-03-15T10:00:00.000Z',
      status: 'in-progress',
    }));

    const bridge = new SessionExecutionBridge(kataDir);
    const metas = (bridge as unknown as {
      listBridgeRunsForCycle: (cycleId: string) => Array<{ runId: string }>;
    }).listBridgeRunsForCycle('cycle-1');

    // Only the .json file should be included
    expect(metas).toHaveLength(1);
    expect(metas[0]!.runId).toBe('run-json');
  });

  it('complete writes token usage to run.json when tokens are reported', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    bridge.complete(prepared.runId, {
      success: true,
      tokenUsage: { inputTokens: 500, outputTokens: 200, total: 700 },
    });

    const runJson = RunSchema.parse(JSON.parse(readFileSync(join(kataDir, 'runs', prepared.runId, 'run.json'), 'utf-8')));
    expect(runJson.status).toBe('completed');
    expect(runJson.tokenUsage).toEqual({
      inputTokens: 500,
      outputTokens: 200,
      totalTokens: 700,
    });
  });

  it('complete does not write tokenUsage to run.json when no tokens reported', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    bridge.complete(prepared.runId, { success: true });

    const runJson = JSON.parse(readFileSync(join(kataDir, 'runs', prepared.runId, 'run.json'), 'utf-8'));
    expect(runJson.tokenUsage).toBeUndefined();
  });

  it('toHistoryTokenUsage returns undefined when no tokenUsage provided', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    // Complete without token usage
    bridge.complete(prepared.runId, { success: true });

    // Read the history entry — should not have tokenUsage
    const historyDir = join(kataDir, 'history');
    const historyFiles = readdirSync(historyDir).filter((f: string) => f.endsWith('.json'));
    expect(historyFiles.length).toBeGreaterThan(0);

    const entry = JSON.parse(readFileSync(join(historyDir, historyFiles[0]!), 'utf-8'));
    expect(entry.tokenUsage).toBeUndefined();
  });

  it('toHistoryTokenUsage maps tokenUsage correctly when provided', () => {
    const cycle = createCycle(kataDir);
    const bridge = new SessionExecutionBridge(kataDir);
    const prepared = bridge.prepare(cycle.bets[0]!.id);

    bridge.complete(prepared.runId, {
      success: true,
      tokenUsage: { inputTokens: 100, outputTokens: 50, total: 150 },
    });

    const historyDir = join(kataDir, 'history');
    const historyFiles = readdirSync(historyDir).filter((f: string) => f.endsWith('.json'));
    const entry = JSON.parse(readFileSync(join(historyDir, historyFiles[0]!), 'utf-8'));
    expect(entry.tokenUsage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      total: 150,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it('prepareCycle handles bet.runId already matching reusable bridge run', () => {
    const betId = randomUUID();
    const cycle = createCycle(kataDir, {
      state: 'planning',
      bets: [
        { id: betId, description: 'Match bet', appetite: 10, outcome: 'pending' },
      ],
    });
    const bridge = new SessionExecutionBridge(kataDir);

    // First prepare sets bet.runId
    const first = bridge.prepareCycle(cycle.id);
    const runId = first.preparedRuns[0]!.runId;

    // Verify bet.runId is set
    const cycleJson = CycleSchema.parse(JSON.parse(readFileSync(join(kataDir, 'cycles', `${cycle.id}.json`), 'utf-8')));
    expect(cycleJson.bets[0]!.runId).toBe(runId);

    // Re-prepare: bet.runId already matches the bridge-run runId — no redundant write
    const second = bridge.prepareCycle(cycle.id);
    expect(second.preparedRuns[0]!.runId).toBe(runId);
  });
});
