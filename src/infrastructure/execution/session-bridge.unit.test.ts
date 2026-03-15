import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CycleSchema } from '@domain/types/cycle.js';
import { RunSchema } from '@domain/types/run-state.js';
import type { AgentCompletionResult } from '@domain/ports/session-bridge.js';
import { SessionExecutionBridge } from './session-bridge.js';

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
