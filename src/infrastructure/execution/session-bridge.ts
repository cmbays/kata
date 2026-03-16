import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
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
import { CycleSchema, type Cycle, type CycleState } from '@domain/types/cycle.js';
import { type Bet } from '@domain/types/bet.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import { z } from 'zod/v4';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  canTransitionCycleState,
  hasBridgeRunMetadataChanged,
  isJsonFile,
} from './session-bridge.helpers.js';
import { createRunTree, readRun, writeRun, runPaths } from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';
import { formatSessionBridgeAgentContext } from './session-bridge-agent-context.js';
import {
  summarizeCycleCompletion,
  type CycleCompletionTotals,
} from '@infra/execution/session-bridge-cycle-completion.js';

/**
 * Schema for bridge-run metadata stored at .kata/bridge-runs/<runId>.json.
 */
const BridgeRunMetaSchema = z.object({
  runId: z.string(),
  betId: z.string(),
  betName: z.string(),
  cycleId: z.string(),
  cycleName: z.string(),
  stages: z.array(z.string()),
  isolation: z.enum(['worktree', 'shared']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(['in-progress', 'complete', 'failed']),
  /** Canonical agent attribution for this run — written to run.json on prepare. */
  agentId: z.string().uuid().optional(),
  /** Compatibility alias for older kataka-attributed metadata. */
  katakaId: z.string().uuid().optional(),
  /**
   * Token usage for this run — populated by complete() when the agent
   * reports token counts via AgentCompletionResult.tokenUsage.
   */
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }).optional(),
});

type BridgeRunMeta = z.infer<typeof BridgeRunMetaSchema>;

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
  constructor(private readonly kataDir: string) {}

  // ── Run-level primitives ──────────────────────────────────────────────

  prepare(betId: string, agentId?: string): PreparedRun {
    const cycle = this.findCycleForBet(betId);
    const bet = cycle.bets.find((b) => b.id === betId);
    if (!bet) {
      throw new Error(`Bet "${betId}" not found in cycle "${cycle.name ?? cycle.id}".`);
    }

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
    this.writeBridgeRunMeta({
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
    this.backfillRunIdInCycle(cycle.id, bet.id, runId);

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
    const meta = this.readBridgeRunMeta(runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }
    if (meta.status === 'complete' || meta.status === 'failed') {
      throw new Error(`Run "${runId}" is in terminal state "${meta.status}" and cannot be dispatched.`);
    }

    return this.formatAgentContext(this.rebuildPreparedRun(meta));
  }

  complete(runId: string, result: AgentCompletionResult): void {
    const meta = this.readBridgeRunMeta(runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(meta.startedAt).getTime();
    this.writeHistoryEntry(runId, meta, result, completedAt, durationMs);
    this.writeCompletedBridgeRunMeta(meta, result, completedAt);
    this.updateRunJsonOnComplete(runId, completedAt, result.success, result.tokenUsage);
    this.updateBetOutcomeInCycle(meta.cycleId, meta.betId, result.success ? 'complete' : 'partial');
  }

  // ── Cycle-level convenience ───────────────────────────────────────────

  prepareCycle(cycleId: string, agentId?: string, name?: string): PreparedCycle {
    const cycle = this.loadCycle(cycleId);
    const pendingBets = cycle.bets.filter((b) => b.outcome === 'pending');

    if (pendingBets.length === 0) {
      throw new Error(`No pending bets in cycle "${cycle.name ?? cycle.id}".`);
    }

    // Write name and transition state BEFORE preparing runs so each bridge-run
    // file is written with the resolved cycle name (#346).
    this.updateCycleState(cycle.id, 'active', name);
    const updatedCycle = this.loadCycle(cycle.id);
    const resolvedName = updatedCycle.name ?? cycle.id;
    const inProgressBridgeRuns = this.listBridgeRunsForCycle(cycle.id)
      .filter((meta) => meta.status === 'in-progress');
    const bridgeRunsByRunId = new Map(inProgressBridgeRuns.map((meta) => [meta.runId, meta]));
    const bridgeRunsByBetId = new Map<string, BridgeRunMeta>();

    for (const meta of inProgressBridgeRuns) {
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
      if (bet.runId !== refreshedMeta.runId) {
        this.backfillRunIdInCycle(updatedCycle.id, bet.id, refreshedMeta.runId);
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
    const cycle = this.loadCycle(cycleId);
    const bridgeRuns = this.listBridgeRunsForCycle(cycleId);
    const preparedBetStatuses = bridgeRuns.map((meta) => this.buildPreparedBetStatus(meta));
    const pendingBetStatuses = cycle.bets
      .filter((bet) => !bridgeRuns.some((meta) => meta.betId === bet.id))
      .map((bet) => this.buildPendingBetStatus(bet));

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      bets: [...preparedBetStatuses, ...pendingBetStatuses],
      elapsed: this.formatElapsedDuration(bridgeRuns),
      budgetUsed: this.estimateBudgetUsage(cycle),
    };
  }

  completeCycle(cycleId: string, results: Record<string, AgentCompletionResult>): CycleSummary {
    const cycle = this.loadCycle(cycleId);
    const bridgeRuns = this.listBridgeRunsForCycle(cycleId);

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
        JSON.stringify(entry, null, 2) + '\n',
      );
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

    this.writeBridgeRunMeta(updatedMeta);
  }

  private buildPreparedBetStatus(meta: BridgeRunMeta): RunStatus {
    const counts = this.countRunData(meta.runId);

    return {
      betId: meta.betId,
      betName: meta.betName,
      runId: meta.runId,
      status: meta.status === 'in-progress' ? 'in-progress' : meta.status,
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
    const earliestStart = bridgeRuns
      .map((meta) => meta.startedAt)
      .sort()[0];

    return earliestStart
      ? this.formatDuration(Date.now() - new Date(earliestStart).getTime())
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
        .map((meta) => this.readBridgeRunMeta(meta.runId))
        .filter((meta): meta is BridgeRunMeta => meta !== null),
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private findCycleForBet(betId: string): Cycle {
    const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
    if (!existsSync(cyclesDir)) {
      throw new Error('No cycles directory found. Run "kata cycle new" first.');
    }

    const files = readdirSync(cyclesDir).filter(isJsonFile);
    for (const file of files) {
      try {
        const cycle = JsonStore.read(join(cyclesDir, file), CycleSchema);
        if (cycle.bets.some((b) => b.id === betId)) {
          return cycle;
        }
      } catch {
        // Skip invalid cycle files
      }
    }

    throw new Error(`No cycle found containing bet "${betId}".`);
  }

  private loadCycle(cycleId: string): Cycle {
    const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
    const files = readdirSync(cyclesDir).filter(isJsonFile);

    for (const file of files) {
      try {
        const cycle = JsonStore.read(join(cyclesDir, file), CycleSchema);
        if (cycle.id === cycleId || cycle.name === cycleId) {
          return cycle;
        }
      } catch {
        // Skip invalid cycle files
      }
    }

    throw new Error(`Cycle "${cycleId}" not found.`);
  }

  private resolveStages(bet: Bet): string[] {
    if (bet.kata) {
      if (bet.kata.type === 'ad-hoc') {
        return [...bet.kata.stages];
      }
      // For named katas, try to load the saved kata file
      try {
        const kataPath = join(this.kataDir, KATA_DIRS.katas, `${bet.kata.pattern}.json`);
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

  // ── Cycle JSON update ─────────────────────────────────────────────────

  /**
   * Transition cycle state directly in the cycle JSON file.
   * Called by prepareCycle() to move a planning cycle to active (#322).
   * Optionally sets a human-readable name on the cycle at launch time (#346).
   */
  private updateCycleState(cycleId: string, state: CycleState, name?: string): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot update cycle state: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      if (cycle.state === state) {
        this.writeCycleNameIfChanged(cyclePath, cycle, name);
        return;
      }
      if (!this.canTransition(cycle.state, state)) {
        logger.warn(`Cannot transition cycle "${cycleId}" from "${cycle.state}" to "${state}".`);
        return;
      }

      this.writeCycleState(cyclePath, cycle, state, name);
    } catch (err) {
      logger.warn(`Failed to update cycle state for cycle "${cycleId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Delegates to the extracted pure helper for testability.
  private canTransition(from: CycleState, to: CycleState): boolean {
    return canTransitionCycleState(from, to);
  }

  private writeCycleNameIfChanged(cyclePath: string, cycle: Cycle, name?: string): void {
    if (name === undefined || cycle.name === name) {
      return;
    }

    cycle.name = name;
    cycle.updatedAt = new Date().toISOString();
    JsonStore.write(cyclePath, cycle, CycleSchema);
  }

  private writeCycleState(cyclePath: string, cycle: Cycle, state: CycleState, name?: string): void {
    cycle.state = state;
    if (name !== undefined) {
      cycle.name = name;
    }
    cycle.updatedAt = new Date().toISOString();
    JsonStore.write(cyclePath, cycle, CycleSchema);
  }

  /**
   * Update a bet's outcome field directly in the cycle JSON file.
   * Non-critical: errors are logged as warnings — a failed update should not
   * abort the run completion, since the history entry was already persisted.
   *
   * Only updates bets that are currently 'pending' to avoid overwriting
   * a manually-set outcome (e.g. user ran kata cooldown before bridge complete).
   */
  private updateBetOutcomeInCycle(
    cycleId: string,
    betId: string,
    outcome: 'complete' | 'partial',
  ): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot update bet outcome: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      const bet = cycle.bets.find((b) => b.id === betId);
      if (!bet) {
        logger.warn(`Cannot update bet outcome: bet "${betId}" not found in cycle "${cycleId}".`);
        return;
      }

      // Only update if still pending — don't overwrite a manually-set outcome
      if (bet.outcome !== 'pending') {
        return;
      }

      bet.outcome = outcome;
      cycle.updatedAt = new Date().toISOString();
      JsonStore.write(cyclePath, cycle, CycleSchema);
    } catch (err) {
      logger.warn(`Failed to update bet outcome in cycle "${cycleId}" for bet "${betId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Backfill the runId onto the bet record in the cycle JSON file.
   *
   * Called by prepare() after the bridge-run metadata and run.json are written.
   * This is the staged-workflow equivalent of CycleManager.setRunId() used by
   * `kata cycle start` — it enables O(1) forward lookup of "the run for a bet".
   *
   * Idempotent: overwrites any previously stored runId without error (safe on retry).
   * Non-critical: errors are logged as warnings — the bridge-run metadata was already
   * persisted and the agent can still execute.
   */
  private backfillRunIdInCycle(cycleId: string, betId: string, runId: string): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot backfill bet.runId: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      const bet = cycle.bets.find((b) => b.id === betId);
      if (!bet) {
        logger.warn(`Cannot backfill bet.runId: bet "${betId}" not found in cycle "${cycleId}".`);
        return;
      }

      bet.runId = runId;
      cycle.updatedAt = new Date().toISOString();
      JsonStore.write(cyclePath, cycle, CycleSchema);
    } catch (err) {
      logger.warn(`Failed to backfill bet.runId in cycle "${cycleId}" for bet "${betId}": ${err instanceof Error ? err.message : String(err)}`);
    }
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
      this.writeBridgeRunMeta(refreshed);
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
      agentId: meta.agentId ?? meta.katakaId,
      katakaId: meta.agentId ?? meta.katakaId,
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
      if (!existsSync(paths.runJson)) return;

      const run = readRun(runsDir, runId);
      writeRun(runsDir, {
        ...run,
        agentId,
        katakaId: agentId,
      });
    } catch (err) {
      logger.warn('Failed to update run.json agent attribution for an existing bridge run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Bridge run metadata persistence ───────────────────────────────────

  private bridgeRunsDir(): string {
    return join(this.kataDir, KATA_DIRS.bridgeRuns);
  }

  private writeBridgeRunMeta(meta: BridgeRunMeta): void {
    const dir = this.bridgeRunsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${meta.runId}.json`),
      JSON.stringify(meta, null, 2) + '\n',
    );
  }

  private readBridgeRunMeta(runId: string): BridgeRunMeta | null {
    const path = join(this.bridgeRunsDir(), `${runId}.json`);
    if (!existsSync(path)) return null;
    try {
      return BridgeRunMetaSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
    } catch {
      return null;
    }
  }

  private listBridgeRunsForCycle(cycleId: string): BridgeRunMeta[] {
    const dir = this.bridgeRunsDir();
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const meta = BridgeRunMetaSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
          return meta.cycleId === cycleId ? meta : null;
        } catch {
          return null;
        }
      })
      .filter((m): m is BridgeRunMeta => m !== null);
  }

  // ── Data counting for status ──────────────────────────────────────────

  private countRunData(runId: string): {
    observations: number;
    artifacts: number;
    decisions: number;
    lastTimestamp: string | null;
  } {
    const runsDir = join(this.kataDir, KATA_DIRS.runs);
    const runDir = join(runsDir, runId);

    if (!existsSync(runDir)) {
      return { observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null };
    }

    // Standard run-store paths
    let observations = this.countJsonlLines(join(runDir, 'observations.jsonl'));
    const artifacts = this.countJsonlLines(join(runDir, 'artifacts.jsonl'));
    let decisions = this.countJsonlLines(join(runDir, 'decisions.jsonl'));

    // Also check stage-level observations
    const stagesDir = join(runDir, 'stages');
    if (existsSync(stagesDir)) {
      for (const stageDir of readdirSync(stagesDir)) {
        observations += this.countJsonlLines(join(stagesDir, stageDir, 'observations.jsonl'));
        decisions += this.countJsonlLines(join(stagesDir, stageDir, 'decisions.jsonl'));
      }
    }

    const lastTimestamp = this.resolveLastActivityTimestamp(runId);

    return { observations, artifacts, decisions, lastTimestamp };
  }

  private countJsonlLines(filePath: string): number {
    if (!existsSync(filePath)) return 0;
    try {
      const content = readFileSync(filePath, 'utf-8').trim();
      return content ? content.split('\n').length : 0;
    } catch {
      return 0;
    }
  }

  private resolveLastActivityTimestamp(runId: string): string | null {
    const meta = this.readBridgeRunMeta(runId);

    if (meta?.completedAt) {
      return meta.completedAt;
    }
    if (meta?.startedAt) {
      return meta.startedAt;
    }

    return null;
  }

  private estimateBudgetUsage(cycle: Cycle): { percent: number; tokenEstimate: number } | null {
    if (!cycle.budget.tokenBudget) return null;

    const historyDir = join(this.kataDir, KATA_DIRS.history);
    if (!existsSync(historyDir)) return { percent: 0, tokenEstimate: 0 };

    const totalTokens = this.sumCycleHistoryTokens(historyDir, cycle.id);

    return {
      percent: Math.round((totalTokens / cycle.budget.tokenBudget) * 100),
      tokenEstimate: totalTokens,
    };
  }

  private sumCycleHistoryTokens(historyDir: string, cycleId: string): number {
    let totalTokens = 0;

    for (const file of readdirSync(historyDir).filter((entry) => entry.endsWith('.json'))) {
      const entryTotal = this.readHistoryTokenTotal(join(historyDir, file), cycleId);
      totalTokens += entryTotal ?? 0;
    }

    return totalTokens;
  }

  private readHistoryTokenTotal(filePath: string, cycleId: string): number | null {
    try {
      const entry = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (entry.cycleId !== cycleId) {
        return null;
      }

      return entry.tokenUsage?.total ?? null;
    } catch {
      return null;
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }
}
