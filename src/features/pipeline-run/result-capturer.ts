import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ExecutionHistoryEntrySchema,
  type ExecutionHistoryEntry,
} from '@domain/types/history.js';
import type { CaptureOptions } from '@domain/ports/result-capturer.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';

export type { CaptureOptions } from '@domain/ports/result-capturer.js';

/**
 * Result Capturer — records execution results as history entries.
 *
 * Persists ExecutionHistoryEntry objects to `.kata/history/{id}.json`.
 * Token tracking is handled separately by PipelineRunner via TokenTracker.
 */
export class ResultCapturer {
  private readonly historyDir: string;

  constructor(basePath: string) {
    this.historyDir = join(basePath, KATA_DIRS.history);
  }

  /**
   * Record an execution result as a history entry and persist to disk.
   */
  capture(options: CaptureOptions): ExecutionHistoryEntry {
    const id = randomUUID();
    const now = new Date().toISOString();

    const entry: ExecutionHistoryEntry = ExecutionHistoryEntrySchema.parse({
      id,
      pipelineId: options.pipelineId,
      stageType: options.stageType,
      stageFlavor: options.stageFlavor,
      stageIndex: options.stageIndex,
      adapter: options.adapterName,
      tokenUsage: options.result.tokenUsage,
      durationMs: options.result.durationMs,
      artifactNames: options.result.artifacts.map((a) => a.name),
      entryGatePassed: undefined,
      exitGatePassed: undefined,
      learningIds: [],
      cycleId: options.cycleId,
      betId: options.betId,
      startedAt: now,
      completedAt: options.result.completedAt,
    });

    // Persist the history entry
    const filePath = join(this.historyDir, `${entry.id}.json`);
    JsonStore.write(filePath, entry, ExecutionHistoryEntrySchema);

    return entry;
  }

  /**
   * Get all history entries for a specific pipeline.
   */
  getForPipeline(pipelineId: string): ExecutionHistoryEntry[] {
    const all = this.listAll();
    return all.filter((entry) => entry.pipelineId === pipelineId);
  }

  /**
   * Get all history entries.
   */
  listAll(): ExecutionHistoryEntry[] {
    return JsonStore.list(this.historyDir, ExecutionHistoryEntrySchema);
  }
}
