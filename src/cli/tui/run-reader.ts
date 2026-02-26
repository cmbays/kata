import { readdirSync } from 'node:fs';
import { runPaths, readRun, readStageState } from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import {
  DecisionEntrySchema,
  ArtifactIndexEntrySchema,
  type Run,
  type RunStatus,
  type StageState,
} from '@domain/types/run-state.js';
import type { StageCategory } from '@domain/types/stage.js';
import { getAvatar, getBetColor, type AvatarState } from './avatars.js';
import { logger } from '@shared/lib/logger.js';

export interface WatchStageDetail {
  category: StageCategory;
  status: StageState['status'];
  flavorCount: number;
  artifactCount: number;
  decisionCount: number;
  avgConfidence: number | undefined;
  pendingGateId: string | undefined;
}

export interface WatchRun {
  runId: string;
  betId: string;
  betTitle: string;
  cycleId: string;
  status: RunStatus;
  currentStage: StageCategory | null;
  stageProgress: number;
  pendingGateId: string | undefined;
  avgConfidence: number | undefined;
  avatarState: AvatarState;
  avatarColor: string;
  stageSequence: StageCategory[];
  stageDetails: WatchStageDetail[];
}

export function listActiveRuns(runsDir: string, cycleId?: string): WatchRun[] {
  let runIds: string[];
  try {
    runIds = readdirSync(runsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('kata watch: could not read runs directory', { runsDir, error: String(err) });
    }
    return [];
  }

  const runs: WatchRun[] = [];

  for (const runId of runIds) {
    let run: Run;
    try {
      run = readRun(runsDir, runId);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn('kata watch: skipping run with unreadable run.json', { runId, error: String(err) });
      }
      continue;
    }

    if (run.status !== 'running') continue;
    if (cycleId && run.cycleId !== cycleId) continue;

    const paths = runPaths(runsDir, runId);

    let decisions;
    let artifacts;
    try {
      decisions = JsonlStore.readAll(paths.decisionsJsonl, DecisionEntrySchema);
      artifacts = JsonlStore.readAll(paths.artifactIndexJsonl, ArtifactIndexEntrySchema);
    } catch (err: unknown) {
      logger.warn('kata watch: skipping run with unreadable JSONL files', { runId, error: String(err) });
      continue;
    }

    let completedCount = 0;
    let pendingGateId: string | undefined;
    const stageDetails: WatchStageDetail[] = [];

    for (const category of run.stageSequence) {
      let stageState: StageState | undefined;
      try {
        stageState = readStageState(runsDir, runId, category);
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.warn('kata watch: unreadable stage state treated as pending', { runId, category, error: String(err) });
        }
        stageState = undefined;
      }

      if (stageState?.status === 'completed') completedCount++;
      if (!pendingGateId && stageState?.pendingGate) {
        pendingGateId = stageState.pendingGate.gateId;
      }

      const stageDecisions = decisions.filter((d) => d.stageCategory === category);
      const stageArtifacts = artifacts.filter((a) => a.stageCategory === category);
      const avgConf =
        stageDecisions.length > 0
          ? stageDecisions.reduce((sum, d) => sum + d.confidence, 0) / stageDecisions.length
          : undefined;

      stageDetails.push({
        category,
        status: stageState?.status ?? 'pending',
        flavorCount: stageState?.selectedFlavors.length ?? 0,
        artifactCount: stageArtifacts.length,
        decisionCount: stageDecisions.length,
        avgConfidence: avgConf,
        pendingGateId: stageState?.pendingGate?.gateId,
      });
    }

    const stageProgress =
      run.stageSequence.length > 0 ? completedCount / run.stageSequence.length : 0;

    const avgConfidence =
      decisions.length > 0
        ? decisions.reduce((sum, d) => sum + d.confidence, 0) / decisions.length
        : undefined;

    const currentStage = run.currentStage;
    const avatarStageKey: StageCategory | 'completed' = currentStage ?? 'research';

    runs.push({
      runId,
      betId: run.betId,
      betTitle: run.betPrompt,
      cycleId: run.cycleId,
      status: run.status,
      currentStage,
      stageProgress,
      pendingGateId,
      avgConfidence,
      avatarState: { stage: avatarStageKey },
      avatarColor: getBetColor(run.betId),
      stageSequence: run.stageSequence,
      stageDetails,
    });
  }

  return runs;
}

// Re-export getAvatar for use in components that import from run-reader
export { getAvatar };
