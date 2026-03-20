import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { detectLaunchMode, detectSessionContext } from '@shared/lib/session-context.js';
import type {
  ISessionExecutionBridge,
  PreparedRun,
  PreparedCycle,
  CycleExecutionStatus,
  RunStatus,
  CycleSummary,
  AgentCompletionResult,
} from '@domain/ports/session-bridge.js';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { BridgeRunMeta } from '@domain/types/bridge-run.js';
import { type Bet } from '@domain/types/bet.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  writeBridgeRunMeta,
  readBridgeRunMeta,
  listBridgeRunsForCycle,
} from '@infra/persistence/bridge-run-store.js';
import {
  findEarliestTimestamp,
  hasBridgeRunMetadataChanged,
  resolveAgentId,
} from './session-bridge.helpers.js';
import {
  countRunData,
  estimateBudgetUsage,
  formatDuration,
} from './session-bridge-run-stats.js';
import { createRunTree, readRun, writeRun, runPaths } from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';
import { formatSessionBridgeAgentContext } from './session-bridge-agent-context.js';
import {
  summarizeCycleCompletion,
  type CycleCompletionTotals,
} from '@infra/execution/session-bridge-cycle-completion.js';

/**
 * SessionExecutionBridge — splits the adapter lifecycle for in-session execution.
 *
 * Used by the sensei skill when Claude IS the orchestrator. The bridge prepares
 * runs (builds manifests, generates agent context blocks) and closes them
 * (writes history entries). The sensei handles the middle part (spawning agents
 * via the Agent tool).
 *
 * This is NOT an IExecutionAdapter — the lifecycle model is fundamentally
 * different from the direct stage execution adapter path.
 */
export class SessionExecutionBridge implements ISessionExecutionBridge {
  private readonly cycleManager: CycleManager;
  private readonly bridgeRunsDir: string;

  constructor(private readonly kataDir: string, cycleManager?: CycleManager) {
    this.cycleManager = cycleManager
      ?? new CycleManager(join(kataDir, KATA_DIRS.cycles), JsonStore);
    this.bridgeRunsDir = join(kataDir, KATA_DIRS.bridgeRuns);
  }

  // ── Run-level primitives ──────────────────────────────────────────────

  prepare(betId: string, agentId?: string): PreparedRun {
    const found = this.cycleManager.findBetCycle(betId);
    if (!found) {
      throw new Error(`No cycle found containing bet "${betId}".`);
    }
    const { cycle, bet } = found;

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const stages = this.resolveStages(bet);
    const isolation = this.resolveIsolation(bet);

    // Build a lightweight manifest from the bet context.
    // The manifest is intentionally minimal — the sensei's formatAgentContext()
    // renders the full agent prompt. We don't run the full orchestrator here
    // because the agent IS the orchestrator.
    const manifest = this.buildManifestFromBet(bet, cycle, runId);

    const prepared: PreparedRun = {
      runId,
      betId: bet.id,
      betName: bet.description,
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      manifest,
      kataDir: this.kataDir,
      stages,
      isolation,
      startedAt,
      agentId,
      katakaId: agentId,
    };

    // Persist bridge run metadata so getCycleStatus() can find it
    writeBridgeRunMeta(this.bridgeRunsDir,{
      runId,
      betId: bet.id,
      betName: bet.description,
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      stages,
      isolation,
      startedAt,
      status: 'in-progress',
      agentId,
      katakaId: agentId,
    });

    // Backfill the runId onto the bet record in the cycle JSON so that queries
    // and reports that look up "the run for a bet" can do O(1) forward lookup.
    // Non-critical: errors are logged as warnings — a failed backfill should
    // not abort prepare() since the bridge-run metadata was already persisted.
    try {
      this.cycleManager.setRunId(cycle.id, bet.id, runId);
    } catch (err) {
      logger.warn(`Failed to backfill bet.runId in cycle "${cycle.id}" for bet "${bet.id}": ${err instanceof Error ? err.message : String(err)}`);
    }

    // Write run.json to runs/<run-id>/run.json so kata watch can discover
    // this run. BridgeRunMeta uses status "in-progress" but RunSchema requires
    // "running" — we map on write. Only valid StageCategory values are written
    // (filter guards against hypothetical custom stage strings).
    this.writeRunJson(runId, bet.id, bet.description, cycle.id, stages, startedAt, agentId);

    return prepared;
  }

  formatAgentContext(prepared: PreparedRun): string {
    const repoRoot = dirname(prepared.kataDir);
    const launchMode = detectLaunchMode();
    const sessionCtx = detectSessionContext(repoRoot);

    return formatSessionBridgeAgentContext(prepared, {
      launchMode,
      repoRoot,
      sessionContext: sessionCtx,
    });
  }

  getAgentContext(runId: string): string {
    const meta = readBridgeRunMeta(this.bridgeRunsDir,runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }
    if (meta.status === 'complete' || meta.status === 'failed') {
      throw new Error(`Run "${runId}" is in terminal state "${meta.status}" and cannot be dispatched.`);
    }

    return this.formatAgentContext(this.rebuildPreparedRun(meta));
  }

  complete(runId: string, result: AgentCompletionResult): void {
    const meta = readBridgeRunMeta(this.bridgeRunsDir,runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(meta.startedAt).getTime();
    this.writeHistoryEntry(runId, meta, result, completedAt, durationMs);
    this.writeCompletedBridgeRunMeta(meta, result, completedAt);
    this.updateRunJsonOnComplete(runId, completedAt, result.success, result.tokenUsage);
    try {
      this.cycleManager.setBetOutcome(meta.cycleId, meta.betId, result.success ? 'complete' : 'partial');
    } catch (err) {
      logger.warn(`Failed to update bet outcome in cycle "${meta.cycleId}" for bet "${meta.betId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Cycle-level convenience ───────────────────────────────────────────

  prepareCycle(cycleId: string, agentId?: string, name?: string): PreparedCycle {
    const cycle = this.cycleManager.get(cycleId);
    const pendingBets = cycle.bets.filter((b) => b.outcome === 'pending');

    if (pendingBets.length === 0) {
      throw new Error(`No pending bets in cycle "${cycle.name ?? cycle.id}".`);
    }

    // Write name and transition state BEFORE preparing runs so each bridge-run
    // file is written with the resolved cycle name (#346).
    this.cycleManager.transitionState(cycle.id, 'active', name);
    const updatedCycle = this.cycleManager.get(cycle.id);
    const resolvedName = updatedCycle.name ?? cycle.id;
    const inProgressBridgeRuns = listBridgeRunsForCycle(this.bridgeRunsDir,cycle.id)
      .filter((meta) => meta.status === 'in-progress');
    const bridgeRunsByRunId = new Map(inProgressBridgeRuns.map((meta) => [meta.runId, meta]));
    const bridgeRunsByBetId = new Map<string, BridgeRunMeta>();

    for (const meta of inProgressBridgeRuns) {
      // Stryker disable next-line ConditionalExpression: dedup guard — overwriting is idempotent for single-bet scenarios
      if (!bridgeRunsByBetId.has(meta.betId)) {
        bridgeRunsByBetId.set(meta.betId, meta);
      }
    }

    const preparedRuns = pendingBets.map((bet) => {
      const reusableMeta = (bet.runId ? bridgeRunsByRunId.get(bet.runId) : undefined)
        ?? bridgeRunsByBetId.get(bet.id);

      if (!reusableMeta) {
        return this.prepare(bet.id, agentId);
      }

      const refreshedMeta = this.refreshPreparedRunMeta(reusableMeta, bet, updatedCycle, agentId);
      // Stryker disable next-line ConditionalExpression: backfill is idempotent — always writing is functionally equivalent
      if (bet.runId !== refreshedMeta.runId) {
        try {
          this.cycleManager.setRunId(updatedCycle.id, bet.id, refreshedMeta.runId);
        } catch (err) {
          logger.warn(`Failed to backfill bet.runId: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return this.rebuildPreparedRun(refreshedMeta);
    });

    return {
      cycleId: cycle.id,
      cycleName: resolvedName,
      preparedRuns,
    };
  }

  getCycleStatus(cycleId: string): CycleExecutionStatus {
    const cycle = this.cycleManager.get(cycleId);
    const bridgeRuns = listBridgeRunsForCycle(this.bridgeRunsDir,cycleId);
    const preparedBetStatuses = bridgeRuns.map((meta) => this.buildPreparedBetStatus(meta));
    const pendingBetStatuses = cycle.bets
      .filter((bet) => !bridgeRuns.some((meta) => meta.betId === bet.id))
      .map((bet) => this.buildPendingBetStatus(bet));

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      bets: [...preparedBetStatuses, ...pendingBetStatuses],
      elapsed: this.formatElapsedDuration(bridgeRuns),
      budgetUsed: estimateBudgetUsage(this.kataDir, cycle),
    };
  }

  completeCycle(cycleId: string, results: Record<string, AgentCompletionResult>): CycleSummary {
    const cycle = this.cycleManager.get(cycleId);
    const bridgeRuns = listBridgeRunsForCycle(this.bridgeRunsDir,cycleId);

    this.completePendingCycleRuns(bridgeRuns, results);
    const totals = this.collectCycleCompletionTotals(bridgeRuns);

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      completedBets: totals.completedBets,
      totalBets: cycle.bets.length,
      totalDurationMs: totals.totalDurationMs,
      tokenUsage: totals.tokenUsage,
    };
  }

  private writeHistoryEntry(
    runId: string,
    meta: BridgeRunMeta,
    result: AgentCompletionResult,
    completedAt: string,
    durationMs: number,
  ): void {
    try {
      const id = randomUUID();
      const entry = this.buildHistoryEntryRecord(id, meta, result, completedAt, durationMs);

      const historyDir = join(this.kataDir, KATA_DIRS.history);
      mkdirSync(historyDir, { recursive: true });
      writeFileSync(
        join(historyDir, `${id}.json`),
        // Stryker disable next-line StringLiteral: trailing newline is formatting convention
        JSON.stringify(entry, null, 2) + '\n',
      );
    // Stryker disable next-line all: catch block is error-reporting — re-throws with context
    } catch (err) {
      logger.error('Failed to write history entry for bridge run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw new Error(
        `Bridge run ${runId} history entry failed to write: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
  }

  private buildHistoryEntryRecord(
    id: string,
    meta: BridgeRunMeta,
    result: AgentCompletionResult,
    completedAt: string,
    durationMs: number,
  ) {
    return ExecutionHistoryEntrySchema.parse({
      id,
      pipelineId: randomUUID(),
      stageType: meta.stages.join(','),
      stageIndex: 0,
      adapter: 'claude-native',
      // Stryker disable next-line ArrayDeclaration: empty fallback when no artifacts present
      artifactNames: result.artifacts?.map((artifact) => artifact.name) ?? [],
      startedAt: meta.startedAt,
      completedAt,
      durationMs,
      cycleId: meta.cycleId,
      betId: meta.betId,
      tokenUsage: this.toHistoryTokenUsage(result.tokenUsage),
    });
  }

  private toHistoryTokenUsage(tokenUsage?: AgentCompletionResult['tokenUsage']) {
    if (!tokenUsage) {
      return undefined;
    }

    return {
      inputTokens: tokenUsage.inputTokens ?? 0,
      outputTokens: tokenUsage.outputTokens ?? 0,
      total: tokenUsage.total ?? 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    };
  }

  private writeCompletedBridgeRunMeta(
    meta: BridgeRunMeta,
    result: AgentCompletionResult,
    completedAt: string,
  ): void {
    const updatedMeta = {
      ...meta,
      completedAt,
      status: result.success ? 'complete' : 'failed',
      ...(result.tokenUsage ? {
        tokenUsage: {
          inputTokens: result.tokenUsage.inputTokens ?? 0,
          outputTokens: result.tokenUsage.outputTokens ?? 0,
          totalTokens: result.tokenUsage.total ?? 0,
        },
      } : {}),
    } satisfies BridgeRunMeta;

    writeBridgeRunMeta(this.bridgeRunsDir,updatedMeta);
  }

  private buildPreparedBetStatus(meta: BridgeRunMeta): RunStatus {
    const counts = countRunData(this.kataDir, meta.runId);

    return {
      betId: meta.betId,
      betName: meta.betName,
      runId: meta.runId,
      status: meta.status,
      kansatsuCount: counts.observations,
      artifactCount: counts.artifacts,
      decisionCount: counts.decisions,
      lastActivity: counts.lastTimestamp,
      durationMs: this.calculateRunDuration(meta),
    };
  }

  private buildPendingBetStatus(bet: Bet): RunStatus {
    return {
      betId: bet.id,
      betName: bet.description,
      runId: '',
      status: 'pending',
      kansatsuCount: 0,
      artifactCount: 0,
      decisionCount: 0,
      lastActivity: null,
      durationMs: null,
    };
  }

  private formatElapsedDuration(bridgeRuns: BridgeRunMeta[]): string {
    const earliestStart = findEarliestTimestamp(bridgeRuns.map((meta) => meta.startedAt));

    return earliestStart
      ? formatDuration(Date.now() - new Date(earliestStart).getTime())
      : '0m';
  }

  private calculateRunDuration(meta: BridgeRunMeta): number | null {
    return meta.completedAt
      ? new Date(meta.completedAt).getTime() - new Date(meta.startedAt).getTime()
      : null;
  }

  private completePendingCycleRuns(
    bridgeRuns: BridgeRunMeta[],
    results: Record<string, AgentCompletionResult>,
  ): void {
    for (const meta of bridgeRuns) {
      if (meta.status === 'in-progress') {
        this.complete(meta.runId, results[meta.runId] ?? { success: true });
      }
    }
  }

  private collectCycleCompletionTotals(
    bridgeRuns: BridgeRunMeta[],
  ): CycleCompletionTotals {
    return summarizeCycleCompletion(
      bridgeRuns
        .map((meta) => readBridgeRunMeta(this.bridgeRunsDir,meta.runId))
        // Stryker disable next-line ConditionalExpression: filter redundant — summarize handles null gracefully
        .filter((meta): meta is BridgeRunMeta => meta !== null),
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private resolveStages(bet: Bet): string[] {
    if (bet.kata) {
      if (bet.kata.type === 'ad-hoc') {
        return [...bet.kata.stages];
      }
      // For named katas, try to load the saved kata file
      try {
        const kataPath = join(this.kataDir, KATA_DIRS.katas, `${bet.kata.pattern}.json`);
        // Stryker disable next-line ConditionalExpression: guard redundant with catch — readFileSync throws for missing file
        if (existsSync(kataPath)) {
          const raw = JSON.parse(readFileSync(kataPath, 'utf-8'));
          return raw.stages ?? ['research', 'plan', 'build', 'review'];
        }
      } catch {
        // Fall through to default
      }
    }
    return ['research', 'plan', 'build', 'review'];
  }

  private resolveIsolation(bet: Bet): 'worktree' | 'shared' {
    // Default to shared. Build stages typically need worktree isolation,
    // but the sensei can override based on flavor.isolation fields.
    const stages = this.resolveStages(bet);
    return stages.includes('build') ? 'worktree' : 'shared';
  }

  private buildManifestFromBet(bet: Bet, cycle: Cycle, runId: string): ExecutionManifest {
    return {
      stageType: this.resolveStages(bet).join(','),
      prompt: `Execute the bet: "${bet.description}"\n\nContext: Cycle "${cycle.name ?? cycle.id}" — run ${runId}`,
      context: {
        pipelineId: randomUUID(),
        stageIndex: 0,
        metadata: {
          betId: bet.id,
          cycleId: cycle.id,
          cycleName: cycle.name ?? cycle.id,
          runId,
          adapter: 'claude-native',
        },
      },
      artifacts: [],
      learnings: [],
    };
  }

  private refreshPreparedRunMeta(
    meta: BridgeRunMeta,
    bet: Bet,
    cycle: Cycle,
    agentId?: string,
  ): BridgeRunMeta {
    const refreshed: BridgeRunMeta = {
      ...meta,
      betName: bet.description,
      cycleName: cycle.name ?? cycle.id,
    };

    let changed = hasBridgeRunMetadataChanged(meta, refreshed);

    if (agentId && !meta.agentId) {
      refreshed.agentId = agentId;
      refreshed.katakaId = agentId;
      changed = true;
      this.updateRunJsonAgentAttribution(meta.runId, agentId);
    }

    if (changed) {
      writeBridgeRunMeta(this.bridgeRunsDir,refreshed);
    }

    return refreshed;
  }

  private rebuildPreparedRun(meta: BridgeRunMeta): PreparedRun {
    return {
      runId: meta.runId,
      betId: meta.betId,
      betName: meta.betName,
      cycleId: meta.cycleId,
      cycleName: meta.cycleName,
      manifest: {
        stageType: meta.stages.join(','),
        prompt: `Execute the bet: "${meta.betName}"`,
        context: {
          pipelineId: meta.runId,
          stageIndex: 0,
          metadata: {
            betId: meta.betId,
            cycleId: meta.cycleId,
            cycleName: meta.cycleName,
            runId: meta.runId,
            adapter: 'claude-native',
          },
        },
        artifacts: [],
        learnings: [],
      },
      kataDir: this.kataDir,
      stages: meta.stages,
      isolation: meta.isolation,
      startedAt: meta.startedAt,
      agentId: resolveAgentId(meta.agentId, meta.katakaId),
      katakaId: resolveAgentId(meta.agentId, meta.katakaId),
    };
  }

  // ── run.json writer ───────────────────────────────────────────────────

  /**
   * Write a RunSchema-conforming run.json to runs/<runId>/run.json.
   *
   * This is called by prepare() so that kata watch (which reads RunSchema)
   * can discover bridge-prepared runs immediately (#234).
   *
   * Status mapping: BridgeRunMeta uses "in-progress" but RunSchema uses
   * "running". We always write "running" here. The run.json is NOT updated
   * when the bridge run completes — history entries are the completion record.
   *
   * Stage filtering: RunSchema.stageSequence requires StageCategory values.
   * Any stage string that is not a valid StageCategory is dropped so that
   * Zod validation does not fail on hypothetical custom stage names.
   */
  private writeRunJson(
    runId: string,
    betId: string,
    betPrompt: string,
    cycleId: string,
    stages: string[],
    startedAt: string,
    agentId?: string,
  ): void {
    try {
      const validCategories = StageCategorySchema.options;
      const stageSequence = stages.filter((s): s is typeof validCategories[number] =>
        (validCategories as readonly string[]).includes(s),
      );

      // Fall back to the standard four-stage sequence if all were filtered out
      const finalSequence = stageSequence.length > 0
        ? stageSequence
        : (['research', 'plan', 'build', 'review'] as const);

      const runsDir = join(this.kataDir, KATA_DIRS.runs);
      createRunTree(runsDir, {
        id: runId,
        cycleId,
        betId,
        betPrompt,
        stageSequence: [...finalSequence],
        currentStage: finalSequence[0] ?? null,
        status: 'running',
        startedAt,
        ...(agentId ? { agentId, katakaId: agentId } : {}),
      });
    } catch (err) {
      // Non-critical: log a warning but do not abort prepare(). The bridge-run
      // metadata was already written and the agent can still execute. kata watch
      // will simply not see this run until the issue is resolved.
      logger.warn('Failed to write run.json for bridge run — kata watch will not see this run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── run.json completion update ────────────────────────────────────────

  /**
   * Update run.json on completion: set status, completedAt, and tokenUsage.
   *
   * Non-critical: errors are logged as warnings — run.json is supplementary
   * to the history entry (which is the canonical completion record). If this
   * fails, cooldown token utilization simply won't reflect this run's tokens.
   */
  private updateRunJsonOnComplete(
    runId: string,
    completedAt: string,
    success: boolean,
    tokenUsage?: { inputTokens?: number; outputTokens?: number; total?: number },
  ): void {
    try {
      const runsDir = join(this.kataDir, KATA_DIRS.runs);
      const paths = runPaths(runsDir, runId);
      // Stryker disable next-line ConditionalExpression: guard redundant with outer catch block
      if (!existsSync(paths.runJson)) return;

      const run = readRun(runsDir, runId);
      const updated = {
        ...run,
        status: (success ? 'completed' : 'failed') as 'completed' | 'failed',
        completedAt,
        ...(tokenUsage ? {
          tokenUsage: {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.total,
          },
        } : {}),
      };
      writeRun(runsDir, updated);
    } catch (err) {
      logger.warn('Failed to update run.json on complete — token utilization may be incomplete.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private updateRunJsonAgentAttribution(runId: string, agentId: string): void {
    try {
      const runsDir = join(this.kataDir, KATA_DIRS.runs);
      const paths = runPaths(runsDir, runId);
      // Stryker disable next-line ConditionalExpression: guard redundant with outer catch block
      if (!existsSync(paths.runJson)) return;

      const run = readRun(runsDir, runId);
      writeRun(runsDir, {
        ...run,
        agentId,
        katakaId: agentId,
      });
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn('Failed to update run.json agent attribution for an existing bridge run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

}
