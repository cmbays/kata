import type { Stage, StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Decision } from '@domain/types/decision.js';

/**
 * A named artifact value — used for both Flavor-level synthesis artifacts
 * and the Stage-level artifact produced after synthesis.
 */
export interface ArtifactValue {
  readonly name: string;
  readonly value: unknown;
}

/**
 * Runtime context available to the Stage Orchestrator when making decisions.
 * Contains everything needed to score Flavor relevance and record decisions.
 */
export interface OrchestratorContext {
  /** Artifact names already available at stage entry (handoff from the prior Stage). */
  readonly availableArtifacts: readonly string[];
  /**
   * Bet context: metadata about the work unit being executed.
   * May include `id`, `title`, `description`, `appetite`, `tags`, and arbitrary keys.
   * Used for keyword matching and relevance scoring during flavor selection.
   */
  bet?: Record<string, unknown>;
  /**
   * Learnings from the KnowledgeStore pre-filtered for this stage category.
   * Each string is a human-readable learning that may influence scoring heuristics.
   * Treat `undefined` and `[]` as equivalent ("no applicable learnings").
   */
  readonly learnings?: readonly string[];
}

/**
 * Result of executing a single Flavor within a Stage.
 * Collected from all selected Flavors before the synthesis phase.
 */
export interface FlavorExecutionResult {
  /** Name of the Flavor that produced this result. */
  readonly flavorName: string;
  /** All named artifacts collected from the Flavor's steps, keyed by artifact name. */
  readonly artifacts: Record<string, unknown>;
  /**
   * The primary synthesis artifact declared by the Flavor.
   * The `name` field MUST match the executing Flavor's `synthesisArtifact` field.
   * The `value` field MUST be non-null and non-undefined — `synthesize()` will
   * throw `OrchestratorError` if a null or undefined value is returned here.
   */
  readonly synthesisArtifact: ArtifactValue;
}

/**
 * The full result of a Stage orchestration pass.
 * Contains all decisions made, per-flavor results, and the final stage-level artifact.
 */
export interface OrchestratorResult {
  /** Stage category this result covers. */
  readonly stageCategory: StageCategory;
  /**
   * Names of Flavors that were selected and executed.
   * Always contains at least one entry — the orchestrator throws before producing
   * a result if no flavors could be selected.
   */
  readonly selectedFlavors: [string, ...string[]];
  /**
   * The three Decisions recorded during orchestration, in phase order:
   *   [0] flavor-selection, [1] execution-mode, [2] synthesis-approach
   * Exactly three entries are always present — one per orchestration phase.
   */
  readonly decisions: [Decision, Decision, Decision];
  /** Per-flavor execution results — one entry per selected Flavor. */
  readonly flavorResults: FlavorExecutionResult[];
  /**
   * Stage-level synthesis artifact — the handoff to the next Stage.
   * Produced by merging or summarizing the per-flavor synthesis artifacts.
   */
  readonly stageArtifact: ArtifactValue;
  /** Whether selected Flavors were run sequentially or in parallel. */
  readonly executionMode: 'sequential' | 'parallel';
}

/**
 * Dependency-injected executor for running a single Flavor's steps.
 * Decouples the decision-making orchestrator from the step execution mechanism,
 * enabling unit testing without real disk I/O or adapter invocations.
 */
export interface IFlavorExecutor {
  /**
   * Execute all steps in the given Flavor and collect their artifacts.
   *
   * **Contract**: The returned `synthesisArtifact.name` MUST equal
   * `flavor.synthesisArtifact`, and `synthesisArtifact.value` MUST NOT be
   * `null` or `undefined`. Violations will cause `synthesize()` to throw
   * `OrchestratorError`.
   *
   * @returns A FlavorExecutionResult with all collected artifacts and the synthesis output.
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
