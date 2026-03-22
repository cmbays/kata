import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { CycleManager } from '@domain/services/cycle-manager.js';
import { logger } from '@shared/lib/logger.js';
import { JsonStoreError } from '@infra/persistence/json-store.js';
import { readRun } from '@infra/persistence/run-store.js';
import type { BetOutcomeRecord, IncompleteRunInfo } from './cooldown-types.js';
import {
  collectBridgeRunIds,
  isJsonFile,
  isSyncableBet,
  mapBridgeRunStatusToIncompleteStatus,
  mapBridgeRunStatusToSyncedOutcome,
} from './cooldown-session.helpers.js';

/**
 * Dependencies injected into BridgeRunSyncer for testability.
 */
export interface BridgeRunSyncerDeps {
  bridgeRunsDir?: string;
  runsDir?: string;
  cycleManager: CycleManager;
}

/**
 * Syncs bet outcomes from bridge-run metadata and checks for incomplete runs.
 *
 * Extracted from CooldownSession to isolate bridge-run filesystem scanning
 * from the cooldown orchestration logic.
 */
export class BridgeRunSyncer {
  constructor(private readonly deps: BridgeRunSyncerDeps) {}

  /**
   * Auto-derive bet outcomes from bridge-run metadata for any bets still marked 'pending'.
   *
   * bridge-run/<runId>.json is updated by `execute complete` / `kiai complete`, unlike run.json which is
   * written once as "running" and never updated. This ensures cooldown always reflects
   * actual run completion even if the caller passed empty betOutcomes (fixes #216).
   *
   * Non-critical: bridge-run file read errors (ENOENT, corrupt JSON) are swallowed
   * so a missing/corrupt bridge-run file does not abort the cooldown.
   * CycleNotFoundError from cycleManager.get() still propagates.
   */
  syncOutcomes(cycleId: string): BetOutcomeRecord[] {
    const bridgeRunsDir = this.deps.bridgeRunsDir;
    if (!bridgeRunsDir) return [];

    const cycle = this.deps.cycleManager.get(cycleId);
    const toSync: BetOutcomeRecord[] = [];

    for (const bet of cycle.bets) {
      // Stryker disable next-line ConditionalExpression: guard redundant — readBridgeRunOutcome returns undefined for missing runId
      if (!isSyncableBet(bet)) continue;

      const outcome = this.readBridgeRunOutcome(bridgeRunsDir, bet.runId!);
      if (outcome) {
        toSync.push({ betId: bet.id, outcome });
      }
    }

    if (toSync.length > 0) {
      this.recordBetOutcomes(cycleId, toSync);
    }

    return toSync;
  }

  /**
   * Check whether any bets in the cycle have runs that are still in-progress.
   * Returns an array of IncompleteRunInfo for every run with status 'pending' or 'running'.
   * Returns an empty array when runsDir is not configured or all runs are complete/failed.
   * Read errors for individual run files are swallowed (the run is skipped silently).
   */
  checkIncomplete(cycleId: string): IncompleteRunInfo[] {
    // Stryker disable next-line ConditionalExpression: guard redundant — loop skips bets without runId
    if (!this.deps.runsDir && !this.deps.bridgeRunsDir) return [];

    const cycle = this.deps.cycleManager.get(cycleId);
    const incomplete: IncompleteRunInfo[] = [];

    for (const bet of cycle.bets) {
      if (!bet.runId) continue;
      const status = this.resolveIncompleteRunStatus(bet.id, bet.runId);
      if (status) {
        incomplete.push({ runId: bet.runId, betId: bet.id, status });
      }
    }

    return incomplete;
  }

  /**
   * Build a betId → runId map by scanning bridge-run files for the given cycle.
   *
   * This is the fallback lookup used by synthesis input writing when bet.runId is
   * not set on the cycle record (e.g., staged-workflow cycles launched before
   * backfillRunIdInCycle was introduced — fixes #335).
   *
   * Returns an empty Map when bridgeRunsDir is missing or unreadable.
   */
  loadBridgeRunIdsByBetId(cycleId: string): Map<string, string> {
    if (!this.deps.bridgeRunsDir) return new Map();
    const files = this.listJsonFiles(this.deps.bridgeRunsDir);
    const metas = files
      .map((file) => this.readBridgeRunMeta(join(this.deps.bridgeRunsDir!, file)))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);
    return collectBridgeRunIds(metas, cycleId);
  }

  /**
   * Apply bet outcomes to the cycle via CycleManager.
   * Logs a warning for any unmatched bet IDs.
   */
  recordBetOutcomes(cycleId: string, outcomes: BetOutcomeRecord[]): void {
    if (outcomes.length === 0) return;
    const { unmatchedBetIds } = this.deps.cycleManager.updateBetOutcomes(cycleId, outcomes);
    if (unmatchedBetIds.length > 0) {
      // Stryker disable next-line StringLiteral: presentation text — join separator in warning message
      logger.warn(`Bet outcome(s) for cycle "${cycleId}" referenced nonexistent bet IDs: ${unmatchedBetIds.join(', ')}`);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private readBridgeRunOutcome(
    bridgeRunsDir: string,
    runId: string,
  ): BetOutcomeRecord['outcome'] | undefined {
    const bridgeRunPath = join(bridgeRunsDir, `${runId}.json`);
    const status = this.readBridgeRunMeta(bridgeRunPath)?.status;
    return mapBridgeRunStatusToSyncedOutcome(status);
  }

  private listJsonFiles(dir: string): string[] {
    try {
      // Stryker disable next-line MethodExpression: filter redundant — readBridgeRunMeta catches non-json parse errors
      return readdirSync(dir).filter(isJsonFile);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Unexpected error listing bridge-run directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return [];
    }
  }

  private readBridgeRunMeta(filePath: string): { cycleId?: string; betId?: string; runId?: string; status?: string } | undefined {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as { cycleId?: string; betId?: string; runId?: string; status?: string };
    // Stryker disable next-line all: equivalent mutant — catch returns undefined for expected errors
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) {
        logger.warn(`Unexpected error reading bridge-run file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return undefined;
    }
  }

  private resolveIncompleteRunStatus(
    betId: string,
    runId: string,
  ): IncompleteRunInfo['status'] | undefined {
    const bridgeStatus = this.readIncompleteBridgeRunStatus(runId);
    if (bridgeStatus !== undefined) return bridgeStatus ?? undefined;
    return this.readIncompleteRunFileStatus(betId, runId);
  }

  private readIncompleteBridgeRunStatus(runId: string): IncompleteRunInfo['status'] | null | undefined {
    if (!this.deps.bridgeRunsDir) return undefined;

    const bridgeRunPath = join(this.deps.bridgeRunsDir, `${runId}.json`);
    if (!existsSync(bridgeRunPath)) return undefined;
    const status = this.readBridgeRunMeta(bridgeRunPath)?.status;
    const incompleteStatus = mapBridgeRunStatusToIncompleteStatus(status);
    return incompleteStatus ?? null;
  }

  private readIncompleteRunFileStatus(
    _betId: string,
    runId: string,
  ): IncompleteRunInfo['status'] | undefined {
    if (!this.deps.runsDir) return undefined;

    try {
      const run = readRun(this.deps.runsDir, runId);
      return run.status === 'pending' || run.status === 'running' ? run.status : undefined;
    // Stryker disable next-line all: equivalent mutant — catch returns undefined for expected errors
    } catch (err) {
      // readRun wraps all file/parse errors as JsonStoreError — only warn for truly unexpected errors
      if (!(err instanceof JsonStoreError)) {
        logger.warn(`Unexpected error reading run file for ${runId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return undefined;
    }
  }
}
