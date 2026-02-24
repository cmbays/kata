import type { Stage, StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Decision } from '@domain/types/decision.js';

/**
 * Runtime context available to the Stage Orchestrator when making decisions.
 * Contains everything needed to score Flavor relevance and record decisions.
 */
export interface OrchestratorContext {
  /** Artifact names already available at stage entry (handoff from the prior Stage). */
  availableArtifacts: string[];
  /**
   * Bet context: metadata about the work unit being executed.
   * May include id, title, description, appetite, tags, etc.
   * Used for keyword matching and relevance scoring during flavor selection.
   */
  bet?: Record<string, unknown>;
  /**
   * Learnings from the KnowledgeStore pre-filtered for this stage category.
   * Each string is a human-readable learning that may influence scoring heuristics.
   */
  learnings?: string[];
}

/**
 * Result of executing a single Flavor within a Stage.
 * Collected from all selected Flavors before the synthesis phase.
 */
export interface FlavorExecutionResult {
  /** Name of the Flavor that produced this result. */
  flavorName: string;
  /** All named artifacts collected from the Flavor's steps, keyed by artifact name. */
  artifacts: Record<string, unknown>;
  /**
   * The primary synthesis artifact declared by the Flavor.
   * Its `name` must match the Flavor's `synthesisArtifact` field.
   */
  synthesisArtifact: {
    name: string;
    value: unknown;
  };
}

/**
 * The full result of a Stage orchestration pass.
 * Contains all decisions made, per-flavor results, and the final stage-level artifact.
 */
export interface OrchestratorResult {
  /** Stage category this result covers. */
  stageCategory: StageCategory;
  /** Names of Flavors that were selected and executed. */
  selectedFlavors: string[];
  /** All Decisions recorded during orchestration, in the order they were made. */
  decisions: Decision[];
  /** Per-flavor execution results — one entry per selected Flavor. */
  flavorResults: FlavorExecutionResult[];
  /**
   * Stage-level synthesis artifact — the handoff to the next Stage.
   * Produced by merging or summarizing the per-flavor synthesis artifacts.
   */
  stageArtifact: {
    name: string;
    value: unknown;
  };
  /** Whether selected Flavors were run sequentially or in parallel. */
  executionMode: 'sequential' | 'parallel';
}

/**
 * Dependency-injected executor for running a single Flavor's steps.
 * Decouples the decision-making orchestrator from the step execution mechanism,
 * enabling unit testing without real disk I/O or adapter invocations.
 */
export interface IFlavorExecutor {
  /**
   * Execute all steps in the given Flavor and collect their artifacts.
   * @returns A FlavorExecutionResult with all collected artifacts.
   * @throws OrchestratorError if required step artifacts are missing post-execution.
   */
  execute(flavor: Flavor, context: OrchestratorContext): Promise<FlavorExecutionResult>;
}

/**
 * The Stage Orchestrator — intelligence layer between PipelineRunner and step execution.
 *
 * Responsibilities (in execution order):
 * 1. **Flavor selection** — choose which Flavors to run based on context and scoring.
 * 2. **Execution mode** — decide sequential vs. parallel Flavor execution.
 * 3. **Execution** — run each selected Flavor via IFlavorExecutor.
 * 4. **Synthesis** — merge per-flavor outputs into a single stage-level handoff artifact.
 *
 * Every non-deterministic judgment is recorded as a Decision via IDecisionRegistry.
 */
export interface IStageOrchestrator {
  /**
   * Run the full orchestration for a Stage.
   *
   * @param stage — Stage configuration: availableFlavors, pinnedFlavors, excludedFlavors, orchestratorConfig.
   * @param context — Runtime context: available artifacts, bet metadata, learnings.
   * @returns Full OrchestratorResult with all decisions, flavor results, and stage artifact.
   * @throws OrchestratorError if no resolvable flavors are available.
   * @throws OrchestratorError if a required synthesis artifact is missing after execution.
   */
  run(stage: Stage, context: OrchestratorContext): Promise<OrchestratorResult>;
}
