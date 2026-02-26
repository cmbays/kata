import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRunTree, writeStageState, readStageState } from '@infra/persistence/run-store.js';
import { listActiveRuns } from './run-reader.js';
import type { Run } from '@domain/types/run-state.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'kata-run-reader-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true });
});

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Test bet prompt',
    stageSequence: ['research', 'plan'],
    currentStage: 'research',
    status: 'running',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('listActiveRuns', () => {
  it('returns empty array for nonexistent directory', () => {
    expect(listActiveRuns(join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  it('returns empty array for empty runs directory', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);
    expect(listActiveRuns(runsDir)).toEqual([]);
  });

  it('returns only running runs (excludes completed/pending)', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const running = makeRun({ status: 'running' });
    const completed = makeRun({ status: 'completed' });
    const failed = makeRun({ status: 'failed' });

    createRunTree(runsDir, running);
    createRunTree(runsDir, completed);
    createRunTree(runsDir, failed);

    const result = listActiveRuns(runsDir);
    expect(result).toHaveLength(1);
    expect(result[0]?.runId).toBe(running.id);
  });

  it('filters by cycleId when provided', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const cycleA = randomUUID();
    const cycleB = randomUUID();
    const runA = makeRun({ cycleId: cycleA });
    const runB = makeRun({ cycleId: cycleB });

    createRunTree(runsDir, runA);
    createRunTree(runsDir, runB);

    const result = listActiveRuns(runsDir, cycleA);
    expect(result).toHaveLength(1);
    expect(result[0]?.cycleId).toBe(cycleA);
  });

  it('computes stageProgress = 0 when no stages completed', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ stageSequence: ['research', 'plan'] });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.stageProgress).toBe(0);
  });

  it('computes stageProgress based on completed stages', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ stageSequence: ['research', 'plan'] });
    createRunTree(runsDir, run);

    const state = readStageState(runsDir, run.id, 'research');
    state.status = 'completed';
    writeStageState(runsDir, run.id, state);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.stageProgress).toBe(0.5);
  });

  it('detects pending gate across stages', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ stageSequence: ['research'] });
    createRunTree(runsDir, run);

    const state = readStageState(runsDir, run.id, 'research');
    state.pendingGate = {
      gateId: 'gate-pending-123',
      gateType: 'human-approved',
      requiredBy: 'research',
    };
    writeStageState(runsDir, run.id, state);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.pendingGateId).toBe('gate-pending-123');
  });

  it('reports no pendingGateId when no gate is pending', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ stageSequence: ['research'] });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.pendingGateId).toBeUndefined();
  });

  it('includes betTitle from betPrompt', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ betPrompt: 'implement user auth feature' });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.betTitle).toBe('implement user auth feature');
  });

  it('assigns deterministic avatarColor from betId', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const betId = randomUUID();
    const run = makeRun({ betId });
    createRunTree(runsDir, run);

    const result1 = listActiveRuns(runsDir);
    const result2 = listActiveRuns(runsDir);
    expect(result1[0]?.avatarColor).toBe(result2[0]?.avatarColor);
  });

  it('populates stageDetails for each stage in stageSequence', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ stageSequence: ['research', 'plan'] });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.stageDetails).toHaveLength(2);
    expect(result[0]?.stageDetails[0]?.category).toBe('research');
    expect(result[0]?.stageDetails[1]?.category).toBe('plan');
  });

  it('skips invalid (non-run) directories gracefully', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);
    mkdirSync(join(runsDir, 'invalid-dir'));
    writeFileSync(join(runsDir, 'invalid-dir', 'run.json'), '{not valid json}');

    expect(() => listActiveRuns(runsDir)).not.toThrow();
    expect(listActiveRuns(runsDir)).toEqual([]);
  });

  it('returns correct currentStage from run', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ currentStage: 'plan' });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.currentStage).toBe('plan');
    expect(result[0]?.avatarState.stage).toBe('plan');
  });

  it('returns null currentStage when run has no current stage', () => {
    const runsDir = join(tmpDir, 'runs');
    mkdirSync(runsDir);

    const run = makeRun({ currentStage: null });
    createRunTree(runsDir, run);

    const result = listActiveRuns(runsDir);
    expect(result[0]?.currentStage).toBeNull();
    // avatarState falls back to 'research' when currentStage is null
    expect(result[0]?.avatarState.stage).toBe('research');
  });
});
