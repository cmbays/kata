import type { ExecutionManifest } from '@domain/types/manifest.js';

/**
 * A prepared run ready for in-session agent dispatch.
 *
 * Returned by ISessionExecutionBridge.prepare() — contains everything the
 * sensei needs to spawn an agent via the Agent tool.
 */
export interface PreparedRun {
  /** Unique run ID — agents use this to write kansatsu/maki/kime */
  runId: string;
  /** Bet ID this run is executing */
  betId: string;
  /** Bet description for display */
  betName: string;
  /** Cycle ID this bet belongs to */
  cycleId: string;
  /** Cycle name for display */
  cycleName: string;
  /** The fully-resolved execution manifest */
  manifest: ExecutionManifest;
  /** Absolute path to the shared .kata/ directory */
  kataDir: string;
  /** Stage categories this run will execute */
  stages: string[];
  /** Isolation mode for this run's agent */
  isolation: 'worktree' | 'shared';
  /** ISO timestamp when the run was opened */
  startedAt: string;
}

/**
 * A prepared cycle with all its bets ready for dispatch.
 */
export interface PreparedCycle {
  cycleId: string;
  cycleName: string;
  preparedRuns: PreparedRun[];
}

/**
 * Status of a single bet's run within a cycle.
 */
export interface RunStatus {
  betId: string;
  betName: string;
  runId: string;
  status: 'pending' | 'in-progress' | 'complete' | 'failed';
  kansatsuCount: number;
  artifactCount: number;
  decisionCount: number;
  lastActivity: string | null;
  durationMs: number | null;
}

/**
 * Aggregated cycle status — answers "where are things at?"
 */
export interface CycleExecutionStatus {
  cycleId: string;
  cycleName: string;
  bets: RunStatus[];
  elapsed: string;
  budgetUsed: { percent: number; tokenEstimate: number } | null;
}

/**
 * Summary returned after completing a cycle's runs.
 */
export interface CycleSummary {
  cycleId: string;
  cycleName: string;
  completedBets: number;
  totalBets: number;
  totalDurationMs: number;
  tokenUsage: { inputTokens: number; outputTokens: number; total: number } | null;
}

/**
 * Result data from an agent's completion report.
 */
export interface AgentCompletionResult {
  success: boolean;
  artifacts?: Array<{ name: string; path?: string }>;
  notes?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    total?: number;
  };
}

/**
 * Port interface for the session execution bridge.
 *
 * Splits the adapter lifecycle into prepare/complete halves for in-session
 * execution where the sensei (LLM orchestrator) controls agent dispatch.
 *
 * This is NOT an IExecutionAdapter — it's a fundamentally different execution
 * model where the adapter cannot invoke the Agent tool itself.
 */
export interface ISessionExecutionBridge {
  // ── Run-level primitives ──────────────────────────────────────────────

  /** Prepare a single bet for execution. Opens a run, builds manifest. */
  prepare(betId: string): PreparedRun;

  /** Generate the agent context block from a prepared run. */
  formatAgentContext(prepared: PreparedRun): string;

  /**
   * Generate a fresh agent context block for an already-prepared run.
   *
   * This is the late-bind alternative to reading `preparedRun.agentContext` at
   * dispatch time. Because `agentContext` is no longer stored in the bridge-run
   * metadata, this method reads the persisted `BridgeRunMeta` for `runId`,
   * reconstructs the minimal `PreparedRun` shape, calls `formatAgentContext()`,
   * and returns the result.
   *
   * Generating fresh at dispatch time means agents always receive instructions
   * from the current binary — eliminating the bootstrap ordering problem where
   * agents inherited context from a buggy binary at prepare time (#243).
   */
  getAgentContext(runId: string): string;

  /** Complete a run after the agent finishes. Writes history entry. */
  complete(runId: string, result: AgentCompletionResult): void;

  // ── Cycle-level convenience ───────────────────────────────────────────

  /** Prepare all bets in a cycle. Returns all prepared runs at once. */
  prepareCycle(cycleId: string): PreparedCycle;

  /** Get aggregated status of all runs in a cycle. */
  getCycleStatus(cycleId: string): CycleExecutionStatus;

  /** Complete all runs in a cycle. Returns aggregated summary. */
  completeCycle(cycleId: string, results: Record<string, AgentCompletionResult>): CycleSummary;
}
