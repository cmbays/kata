import type { RunSummary, StageDetail } from './types.js';
import { readRun, readStageState, runPaths } from '@infra/persistence/run-store.js';
import { DecisionEntrySchema, ArtifactIndexEntrySchema } from '@domain/types/run-state.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Load a single run summary from .kata/runs/ state files.
 * Returns null if the run file cannot be read.
 * Skips individual stage states that fail to load (logs a warning).
 *
 * Shared between DataAggregator and CooldownSession to avoid duplication.
 */
export function loadRunSummary(runsDir: string, betId: string, runId: string): RunSummary | null {
  let run: ReturnType<typeof readRun>;
  try {
    run = readRun(runsDir, runId);
  } catch (err) {
    logger.warn(`Failed to read run "${runId}": ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }

  let stagesCompleted = 0;
  let gapCount = 0;
  const gapsBySeverity = { low: 0, medium: 0, high: 0 };
  const stageDetails: StageDetail[] = [];

  for (const category of run.stageSequence) {
    try {
      const stageState = readStageState(runsDir, runId, category);
      if (stageState.status === 'completed') stagesCompleted++;
      for (const gap of stageState.gaps) {
        gapCount++;
        gapsBySeverity[gap.severity]++;
      }
      stageDetails.push({
        category,
        selectedFlavors: stageState.selectedFlavors,
        gaps: stageState.gaps,
      });
    } catch (err) {
      logger.warn(`Failed to read stage "${category}" for run "${runId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const paths = runPaths(runsDir, runId);
  const decisions = JsonlStore.readAll(paths.decisionsJsonl, DecisionEntrySchema);
  const avgConfidence = decisions.length > 0
    ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length
    : null;
  const yoloDecisionCount = decisions.filter((d) => d.lowConfidence === true).length;

  const artifacts = JsonlStore.readAll(paths.artifactIndexJsonl, ArtifactIndexEntrySchema);
  const artifactPaths = artifacts.map((a) => a.filePath);

  return { betId, runId, stagesCompleted, gapCount, gapsBySeverity, avgConfidence, artifactPaths, stageDetails, yoloDecisionCount };
}
