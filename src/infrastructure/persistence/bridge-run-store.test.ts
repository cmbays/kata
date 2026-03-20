import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  writeBridgeRunMeta,
  readBridgeRunMeta,
  listBridgeRunsForCycle,
} from './bridge-run-store.js';
import type { BridgeRunMeta } from '@domain/types/bridge-run.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-bridge-run-store-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeMeta(overrides?: Partial<BridgeRunMeta>): BridgeRunMeta {
  return {
    runId: 'run-1',
    betId: 'bet-1',
    betName: 'Test Bet',
    cycleId: 'cycle-1',
    cycleName: 'Test Cycle',
    stages: ['research', 'build'],
    isolation: 'shared',
    startedAt: '2026-03-15T10:00:00.000Z',
    status: 'in-progress',
    ...overrides,
  };
}

describe('writeBridgeRunMeta', () => {
  it('creates the directory and writes metadata', () => {
    const meta = makeMeta();
    writeBridgeRunMeta(tempDir, meta);

    const read = readBridgeRunMeta(tempDir, 'run-1');
    expect(read).toEqual(meta);
  });
});

describe('readBridgeRunMeta', () => {
  it('returns null for nonexistent file', () => {
    expect(readBridgeRunMeta(tempDir, 'nonexistent')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    mkdirSync(tempDir, { recursive: true });
    writeFileSync(join(tempDir, 'bad.json'), 'not-json');
    expect(readBridgeRunMeta(tempDir, 'bad')).toBeNull();
  });
});

describe('listBridgeRunsForCycle', () => {
  it('returns empty array when directory does not exist', () => {
    expect(listBridgeRunsForCycle(join(tempDir, 'nonexistent'), 'cycle-1')).toEqual([]);
  });

  it('filters by cycleId', () => {
    writeBridgeRunMeta(tempDir, makeMeta({ runId: 'run-1', cycleId: 'cycle-1' }));
    writeBridgeRunMeta(tempDir, makeMeta({ runId: 'run-2', cycleId: 'cycle-2' }));
    writeBridgeRunMeta(tempDir, makeMeta({ runId: 'run-3', cycleId: 'cycle-1' }));

    const result = listBridgeRunsForCycle(tempDir, 'cycle-1');
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.runId).sort()).toEqual(['run-1', 'run-3']);
  });

  it('ignores non-JSON files', () => {
    writeBridgeRunMeta(tempDir, makeMeta({ runId: 'run-1', cycleId: 'cycle-1' }));
    writeFileSync(join(tempDir, 'notes.txt'), 'not a bridge run');

    const result = listBridgeRunsForCycle(tempDir, 'cycle-1');
    expect(result).toHaveLength(1);
  });

  it('ignores invalid JSON files', () => {
    writeBridgeRunMeta(tempDir, makeMeta({ runId: 'run-1', cycleId: 'cycle-1' }));
    writeFileSync(join(tempDir, 'corrupt.json'), '{invalid');

    const result = listBridgeRunsForCycle(tempDir, 'cycle-1');
    expect(result).toHaveLength(1);
  });
});
