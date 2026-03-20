import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { countRunData, estimateBudgetUsage, formatDuration } from './session-bridge-run-stats.js';
import type { Cycle } from '@domain/types/cycle.js';

let kataDir: string;

beforeEach(() => {
  kataDir = mkdtempSync(join(tmpdir(), 'kata-run-stats-'));
  mkdirSync(join(kataDir, 'runs'), { recursive: true });
  mkdirSync(join(kataDir, 'bridge-runs'), { recursive: true });
});

afterEach(() => {
  rmSync(kataDir, { recursive: true, force: true });
});

describe('countRunData', () => {
  it('returns zero counts when run directory is missing', () => {
    expect(countRunData(kataDir, 'nonexistent')).toEqual({
      observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null,
    });
  });

  it('returns zero counts when jsonl files are absent', () => {
    const runDir = join(kataDir, 'runs', 'run-1');
    mkdirSync(runDir, { recursive: true });

    expect(countRunData(kataDir, 'run-1')).toEqual({
      observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null,
    });
  });

  it('counts lines in run-level jsonl files', () => {
    const runDir = join(kataDir, 'runs', 'run-1');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, 'observations.jsonl'), '{"a":1}\n{"a":2}\n');
    writeFileSync(join(runDir, 'artifacts.jsonl'), '{"b":1}\n');
    writeFileSync(join(runDir, 'decisions.jsonl'), '{"c":1}\n{"c":2}\n{"c":3}\n');

    const result = countRunData(kataDir, 'run-1');
    expect(result.observations).toBe(2);
    expect(result.artifacts).toBe(1);
    expect(result.decisions).toBe(3);
  });

  it('includes stage-level observations and decisions', () => {
    const runDir = join(kataDir, 'runs', 'run-1');
    mkdirSync(join(runDir, 'stages', 'build'), { recursive: true });
    writeFileSync(join(runDir, 'observations.jsonl'), '{"a":1}\n');
    writeFileSync(join(runDir, 'stages', 'build', 'observations.jsonl'), '{"a":2}\n{"a":3}\n');
    writeFileSync(join(runDir, 'stages', 'build', 'decisions.jsonl'), '{"c":1}\n');

    const result = countRunData(kataDir, 'run-1');
    expect(result.observations).toBe(3);
    expect(result.decisions).toBe(1);
  });

  it('handles stages dir with no subdirectories', () => {
    const runDir = join(kataDir, 'runs', 'run-1');
    mkdirSync(join(runDir, 'stages'), { recursive: true });

    const result = countRunData(kataDir, 'run-1');
    expect(result.observations).toBe(0);
  });
});

describe('estimateBudgetUsage', () => {
  const makeCycle = (tokenBudget?: number): Cycle => ({
    id: 'cycle-1',
    budget: { tokenBudget, timeBudget: '2 weeks' },
    bets: [],
    pipelineMappings: [],
    state: 'active',
    cooldownReserve: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('returns null when cycle has no tokenBudget', () => {
    expect(estimateBudgetUsage(kataDir, makeCycle(undefined))).toBeNull();
  });

  it('returns zero when history directory is missing', () => {
    expect(estimateBudgetUsage(kataDir, makeCycle(100000))).toEqual({
      percent: 0, tokenEstimate: 0,
    });
  });

  it('sums tokens from matching history entries', () => {
    const historyDir = join(kataDir, 'history');
    mkdirSync(historyDir, { recursive: true });

    writeFileSync(join(historyDir, 'a.json'), JSON.stringify({ cycleId: 'cycle-1', tokenUsage: { total: 1200 } }));
    writeFileSync(join(historyDir, 'b.json'), JSON.stringify({ cycleId: 'cycle-1', tokenUsage: { total: 800 } }));
    writeFileSync(join(historyDir, 'c.json'), JSON.stringify({ cycleId: 'other', tokenUsage: { total: 9999 } }));
    writeFileSync(join(historyDir, 'notes.txt'), JSON.stringify({ cycleId: 'cycle-1', tokenUsage: { total: 5000 } }));

    const result = estimateBudgetUsage(kataDir, makeCycle(100000));
    expect(result).toEqual({ percent: 2, tokenEstimate: 2000 });
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(500)).toBe('0s');
    expect(formatDuration(30000)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatDuration(60000)).toBe('1m');
    expect(formatDuration(90000)).toBe('1m');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3660000)).toBe('1h 1m');
  });
});
