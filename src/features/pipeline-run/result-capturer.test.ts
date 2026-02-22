import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ExecutionResult } from '@domain/types/manifest.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { ResultCapturer, type CaptureOptions } from './result-capturer.js';

describe('ResultCapturer', () => {
  let basePath: string;
  let capturer: ResultCapturer;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'kata-result-capturer-'));
    capturer = new ResultCapturer(basePath);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  function makeResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
    return {
      success: true,
      artifacts: [{ name: 'pitch-doc', path: '/tmp/pitch.md' }],
      completedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeOptions(overrides?: Partial<CaptureOptions>): CaptureOptions {
    return {
      pipelineId: '550e8400-e29b-41d4-a716-446655440000',
      stageType: 'research',
      stageIndex: 0,
      adapterName: 'manual',
      result: makeResult(),
      ...overrides,
    };
  }

  describe('capture', () => {
    it('should create a history entry with a UUID', () => {
      const entry = capturer.capture(makeOptions());

      expect(entry.id).toBeDefined();
      expect(entry.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('should persist the entry to .kata/history/', () => {
      const entry = capturer.capture(makeOptions());

      const historyDir = join(basePath, 'history');
      expect(existsSync(historyDir)).toBe(true);

      const filePath = join(historyDir, `${entry.id}.json`);
      expect(existsSync(filePath)).toBe(true);

      const persisted = JsonStore.read(filePath, ExecutionHistoryEntrySchema);
      expect(persisted.id).toBe(entry.id);
      expect(persisted.pipelineId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(persisted.stageType).toBe('research');
    });

    it('should map pipeline/stage metadata correctly', () => {
      const entry = capturer.capture(makeOptions({
        pipelineId: '550e8400-e29b-41d4-a716-446655440001',
        stageType: 'build',
        stageFlavor: 'frontend',
        stageIndex: 2,
        adapterName: 'claude-cli',
      }));

      expect(entry.pipelineId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(entry.stageType).toBe('build');
      expect(entry.stageFlavor).toBe('frontend');
      expect(entry.stageIndex).toBe(2);
      expect(entry.adapter).toBe('claude-cli');
    });

    it('should capture artifact names from the result', () => {
      const result = makeResult({
        artifacts: [
          { name: 'pitch-doc', path: '/tmp/pitch.md' },
          { name: 'breadboard' },
        ],
      });

      const entry = capturer.capture(makeOptions({ result }));

      expect(entry.artifactNames).toEqual(['pitch-doc', 'breadboard']);
    });

    it('should capture token usage from the result', () => {
      const result = makeResult({
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 1500,
        },
      });

      const entry = capturer.capture(makeOptions({ result }));

      expect(entry.tokenUsage).toBeDefined();
      expect(entry.tokenUsage?.inputTokens).toBe(1000);
      expect(entry.tokenUsage?.outputTokens).toBe(500);
      expect(entry.tokenUsage?.total).toBe(1500);
    });

    it('should capture duration from the result', () => {
      const result = makeResult({ durationMs: 5000 });

      const entry = capturer.capture(makeOptions({ result }));

      expect(entry.durationMs).toBe(5000);
    });

    it('should capture cycle and bet IDs when provided', () => {
      const entry = capturer.capture(makeOptions({
        cycleId: '550e8400-e29b-41d4-a716-446655440010',
        betId: '550e8400-e29b-41d4-a716-446655440020',
      }));

      expect(entry.cycleId).toBe('550e8400-e29b-41d4-a716-446655440010');
      expect(entry.betId).toBe('550e8400-e29b-41d4-a716-446655440020');
    });

    it('should set startedAt and completedAt timestamps', () => {
      const completedAt = new Date().toISOString();
      const result = makeResult({ completedAt });

      const entry = capturer.capture(makeOptions({ result }));

      expect(entry.startedAt).toBeDefined();
      expect(entry.completedAt).toBe(completedAt);
    });

    it('should not create tracking files (token tracking is handled by PipelineRunner)', () => {
      const result = makeResult({
        tokenUsage: {
          inputTokens: 200,
          outputTokens: 100,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 300,
        },
      });

      capturer.capture(makeOptions({ result }));

      // ResultCapturer is a pure history writer — token tracking lives in PipelineRunner
      const trackingDir = join(basePath, 'tracking');
      expect(existsSync(trackingDir)).toBe(false);
    });
  });

  describe('getForPipeline', () => {
    it('should return entries matching the pipeline ID', () => {
      const pipelineA = '550e8400-e29b-41d4-a716-446655440000';
      const pipelineB = '550e8400-e29b-41d4-a716-446655440001';

      capturer.capture(makeOptions({ pipelineId: pipelineA, stageIndex: 0 }));
      capturer.capture(makeOptions({ pipelineId: pipelineA, stageIndex: 1 }));
      capturer.capture(makeOptions({ pipelineId: pipelineB, stageIndex: 0 }));

      const entriesA = capturer.getForPipeline(pipelineA);
      const entriesB = capturer.getForPipeline(pipelineB);

      expect(entriesA).toHaveLength(2);
      expect(entriesB).toHaveLength(1);
      expect(entriesA.every((e) => e.pipelineId === pipelineA)).toBe(true);
      expect(entriesB[0]?.pipelineId).toBe(pipelineB);
    });

    it('should return empty array for unknown pipeline', () => {
      capturer.capture(makeOptions());

      const entries = capturer.getForPipeline('550e8400-e29b-41d4-a716-446655440099');
      expect(entries).toHaveLength(0);
    });
  });

  describe('listAll', () => {
    it('should return all captured entries', () => {
      capturer.capture(makeOptions({ stageIndex: 0 }));
      capturer.capture(makeOptions({ stageIndex: 1 }));
      capturer.capture(makeOptions({ stageIndex: 2 }));

      const all = capturer.listAll();
      expect(all).toHaveLength(3);
    });

    it('should return empty array when no entries exist', () => {
      const all = capturer.listAll();
      expect(all).toHaveLength(0);
    });
  });
});
