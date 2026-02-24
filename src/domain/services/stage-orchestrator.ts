import type { Stage, StageCategory, OrchestratorConfig } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Decision } from '@domain/types/decision.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type {
  IStageOrchestrator,
  IFlavorExecutor,
  ArtifactValue,
  OrchestratorContext,
  OrchestratorResult,
  FlavorExecutionResult,
} from '@domain/ports/stage-orchestrator.js';
import { FlavorNotFoundError, OrchestratorError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';

export interface StageOrchestratorDeps {
  flavorRegistry: IFlavorRegistry;
  decisionRegistry: IDecisionRegistry;
  executor: IFlavorExecutor;
}

/**
 * Describes a synthesis strategy for merging per-flavor results into a stage artifact.
 * Returned by the abstract `getSynthesisStrategy()` method.
 */
export interface SynthesisStrategy {
  /**
   * The chosen approach name.
   * MUST be one of the values in `alternatives` — `synthesize()` will throw
   * `OrchestratorError` if this invariant is violated.
   */
  approach: string;
  /**
   * All approaches considered by the subclass, including `approach`.
   * Must contain at least one entry.
   * The Decision `options` array is built directly from this list.
   */
  alternatives: [string, ...string[]];
  /** Human-readable explanation of why this approach was chosen. Must be non-empty. */
  reasoning: string;
}

/**
 * Abstract base class for Stage Orchestrators.
 *
 * Implements the four-phase orchestration loop:
 *   1. Flavor selection — choose the best Flavor(s) from the Stage's available list.
 *   2. Execution mode  — decide sequential vs. parallel execution.
 *   3. Execution       — run each selected Flavor via the injected IFlavorExecutor.
 *   4. Synthesis       — merge per-flavor outputs into a single stage-level artifact.
 *
 * Every non-deterministic judgment is recorded as a Decision via IDecisionRegistry.
 * Subclasses implement `scoreFlavorForContext()` and `getSynthesisStrategy()` for
 * category-specific intelligence.
 */
export abstract class BaseStageOrchestrator implements IStageOrchestrator {
  constructor(
    protected readonly stageCategory: StageCategory,
    protected readonly deps: StageOrchestratorDeps,
    protected readonly config: OrchestratorConfig,
  ) {}

  async run(stage: Stage, context: OrchestratorContext): Promise<OrchestratorResult> {
    // Phase 1: Select flavors — records 'flavor-selection' Decision
    const { selectedFlavors, flavorSelectionDecision } = this.selectFlavors(stage, context);

    // Phase 2: Decide execution mode — records 'execution-mode' Decision
    const { executionMode, executionModeDecision } = this.decideExecutionMode(
      selectedFlavors,
      context,
    );

    // Phase 3: Execute selected flavors via the injected executor
    const flavorResults = await this.executeFlavors(selectedFlavors, executionMode, context);

    // Phase 4: Synthesize results — records 'synthesis-approach' Decision
    const { stageArtifact, synthesisDecision } = this.synthesize(flavorResults, context);

    // selectedFlavors is guaranteed non-empty by selectFlavors() which throws otherwise.
    const selectedFlavorNames = selectedFlavors.map((f) => f.name) as [string, ...string[]];

    return {
      stageCategory: this.stageCategory,
      selectedFlavors: selectedFlavorNames,
      decisions: [flavorSelectionDecision, executionModeDecision, synthesisDecision],
      flavorResults,
      stageArtifact,
      executionMode,
    };
  }

  /**
   * Select which Flavors to run from the Stage's available list.
   *
   * Selection rules:
   * - `excludedFlavors` are always removed from candidates.
   * - Remaining candidates are scored via `scoreFlavorForContext()`.
   * - The top-scoring non-pinned candidate is added to the selected set.
   * - `pinnedFlavors` are always included, regardless of score.
   * - The final set is deduplicated (a pinned flavor that is also top-scored appears once).
   *
   * Records a 'flavor-selection' Decision.
   *
   * @throws OrchestratorError if no candidates remain after exclusion.
   * @throws OrchestratorError if no candidates can be resolved from the FlavorRegistry.
   */
  protected selectFlavors(
    stage: Stage,
    context: OrchestratorContext,
  ): { selectedFlavors: Flavor[]; flavorSelectionDecision: Decision } {
    const excluded = new Set(stage.excludedFlavors ?? []);
    const pinned = new Set(stage.pinnedFlavors ?? []);

    // Warn when a flavor appears in both pinnedFlavors and excludedFlavors.
    // excludedFlavors wins (project-level override takes precedence over stage-level pin).
    for (const name of pinned) {
      if (excluded.has(name)) {
        logger.warn(
          `Orchestrator: flavor "${this.stageCategory}/${name}" is both pinned and excluded — excludedFlavors wins. ` +
            `Remove the conflict in your Stage or project configuration.`,
          { name, stageCategory: this.stageCategory },
        );
      }
    }

    // Filter out excluded flavors from the available set
    const candidateNames = stage.availableFlavors.filter((name) => !excluded.has(name));

    // Resolve pinned flavors directly from the registry — they bypass the availableFlavors
    // list so that stages can pin flavors that are not in their declared available set.
    // Pinned flavors that are also excluded are NOT resolved (excluded wins, see warning above).
    const pinnedFlavors: Flavor[] = [];
    for (const name of pinned) {
      if (excluded.has(name)) continue;
      try {
        pinnedFlavors.push(this.deps.flavorRegistry.get(this.stageCategory, name));
      } catch (err) {
        if (!(err instanceof FlavorNotFoundError)) {
          throw new OrchestratorError(
            `Stage "${this.stageCategory}" failed to resolve pinned flavor "${name}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
        logger.warn(
          `Orchestrator: pinned flavor "${this.stageCategory}/${name}" not found in registry — skipping.`,
          { name, error: err.message },
        );
      }
    }

    // If there are no non-excluded available candidates and no pinned flavors, throw.
    if (candidateNames.length === 0 && pinnedFlavors.length === 0) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" has no available flavors after applying excludedFlavors filter. ` +
          `Check that excludedFlavors does not cover all entries in availableFlavors and pinnedFlavors.`,
      );
    }

    // Resolve Flavor objects from availableFlavors (excluding excluded); skip unresolvable with a warning.
    // Pinned flavors already resolved above are not re-resolved here.
    const pinnedNames = new Set(pinnedFlavors.map((f) => f.name));
    const candidates: Flavor[] = [];
    for (const name of candidateNames) {
      if (pinnedNames.has(name)) continue; // already resolved as pinned
      try {
        candidates.push(this.deps.flavorRegistry.get(this.stageCategory, name));
      } catch (err) {
        if (!(err instanceof FlavorNotFoundError)) {
          throw new OrchestratorError(
            `Stage "${this.stageCategory}" failed to resolve flavor "${name}": ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
        }
        logger.warn(
          `Orchestrator: flavor "${this.stageCategory}/${name}" not found in registry — skipping.`,
          { name, error: err.message },
        );
      }
    }

    if (candidates.length === 0 && pinnedFlavors.length === 0) {
      logger.error(`Orchestrator: stage "${this.stageCategory}" has no resolvable flavors.`, {
        stageCategory: this.stageCategory,
        candidateNames,
      });
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" has no resolvable flavors. ` +
          `Ensure all flavors listed in availableFlavors are registered in FlavorRegistry.`,
      );
    }

    // Score non-pinned candidates; pinned flavors always run and skip scoring
    const nonPinned = candidates;

    // Sort non-pinned by descending score
    const scored = nonPinned
      .map((flavor) => ({ flavor, score: this.scoreFlavorForContext(flavor, context) }))
      .sort((a, b) => b.score - a.score);

    // Top-scored non-pinned candidate (if any)
    const topNonPinned = scored.length > 0 ? [scored[0]!.flavor] : [];

    // Build selected set: pinned first, then top non-pinned (deduplicated by name)
    const seen = new Set<string>();
    const selected: Flavor[] = [];
    for (const f of [...pinnedFlavors, ...topNonPinned]) {
      if (!seen.has(f.name)) {
        seen.add(f.name);
        selected.push(f);
      }
    }

    // Compute confidence from top scorer's score (normalised to [0, 1])
    const topScore = scored[0]?.score ?? 0;
    const confidence = Math.min(1, Math.max(0, topScore));

    // Decision options = all resolvable flavors (non-pinned candidates + pinned).
    // selection = top-scored non-pinned name, or first pinned name if no non-pinned candidates.
    const options = [...candidates, ...pinnedFlavors].map((f) => f.name);
    const selection =
      scored[0]?.flavor.name ??
      (pinnedFlavors[0]?.name ?? candidates[0]!.name);

    // Ensure selection is in options (invariant required by DecisionSchema)
    if (!options.includes(selection)) {
      options.push(selection);
    }

    const scoreSummary = scored
      .slice(0, 3)
      .map(({ flavor, score }) => `${flavor.name}(${score.toFixed(2)})`)
      .join(', ');

    let flavorSelectionDecision: Decision;
    try {
      flavorSelectionDecision = this.deps.decisionRegistry.record({
        stageCategory: this.stageCategory,
        decisionType: 'flavor-selection',
        context: {
          availableArtifacts: context.availableArtifacts,
          bet: context.bet,
          learningCount: context.learnings?.length ?? 0,
          candidateCount: candidates.length,
          pinnedFlavors: [...pinned],
          excludedFlavors: [...excluded],
        },
        options,
        selection,
        reasoning:
          `Scored candidates: [${scoreSummary || 'none (all pinned)'}]. ` +
          `Pinned: [${[...pinned].join(', ') || 'none'}]. ` +
          `Selected: "${selection}" as primary, with ${pinnedFlavors.length} pinned flavor(s).`,
        confidence,
        decidedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" failed to record flavor-selection decision: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { selectedFlavors: selected, flavorSelectionDecision };
  }

  /**
   * Decide whether to execute selected Flavors sequentially or in parallel.
   *
   * Decision rules:
   * - 1 flavor  → sequential (no benefit to parallelism).
   * - ≤ maxParallelFlavors → parallel (within resource limits).
   * - > maxParallelFlavors → sequential (avoid overwhelming the executor).
   *
   * Records an 'execution-mode' Decision with high confidence (deterministic rule).
   */
  protected decideExecutionMode(
    flavors: Flavor[],
    _context: OrchestratorContext,
  ): { executionMode: 'sequential' | 'parallel'; executionModeDecision: Decision } {
    const maxParallel = this.config.maxParallelFlavors;
    const executionMode: 'sequential' | 'parallel' =
      flavors.length > 1 && flavors.length <= maxParallel ? 'parallel' : 'sequential';

    const reasoning =
      flavors.length <= 1
        ? 'Only one flavor selected; sequential is optimal.'
        : flavors.length <= maxParallel
          ? `${flavors.length} flavors fit within maxParallelFlavors=${maxParallel}; parallelizing for efficiency.`
          : `${flavors.length} flavors exceeds maxParallelFlavors=${maxParallel}; running sequentially to respect resource limits.`;

    let executionModeDecision: Decision;
    try {
      executionModeDecision = this.deps.decisionRegistry.record({
        stageCategory: this.stageCategory,
        decisionType: 'execution-mode',
        context: {
          flavorCount: flavors.length,
          maxParallelFlavors: maxParallel,
          selectedFlavors: flavors.map((f) => f.name),
        },
        options: ['sequential', 'parallel'],
        selection: executionMode,
        reasoning,
        // Execution mode is a deterministic rule — confidence is always high
        confidence: 0.95,
        decidedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" failed to record execution-mode decision: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { executionMode, executionModeDecision };
  }

  /**
   * Execute selected Flavors via the injected IFlavorExecutor.
   *
   * - sequential: Flavors run one at a time in order. Useful when downstream Flavors
   *   may consume artifacts produced by earlier ones.
   * - parallel: All Flavors are launched concurrently via Promise.all.
   */
  protected async executeFlavors(
    flavors: Flavor[],
    executionMode: 'sequential' | 'parallel',
    context: OrchestratorContext,
  ): Promise<FlavorExecutionResult[]> {
    if (executionMode === 'parallel') {
      // Use allSettled so all flavors run even if some fail — collect all failures before throwing.
      const settled = await Promise.allSettled(
        flavors.map((flavor) => this.deps.executor.execute(flavor, context)),
      );
      const failures = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failures.length > 0) {
        const messages = failures
          .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
          .join('; ');
        throw new OrchestratorError(
          `Stage "${this.stageCategory}" parallel execution failed (${failures.length}/${flavors.length} flavors): ${messages}`,
        );
      }
      return settled.map((r) => (r as PromiseFulfilledResult<FlavorExecutionResult>).value);
    }

    const results: FlavorExecutionResult[] = [];
    for (const flavor of flavors) {
      results.push(await this.deps.executor.execute(flavor, context));
    }
    return results;
  }

  /**
   * Synthesize per-flavor results into a single stage-level artifact.
   *
   * Validates that all synthesis artifacts are present (non-null/undefined),
   * then merges them into a keyed record: `{ [flavorName]: synthesisArtifactValue }`.
   * Records a 'synthesis-approach' Decision.
   *
   * @throws OrchestratorError if any FlavorExecutionResult has a missing synthesis artifact.
   */
  protected synthesize(
    flavorResults: FlavorExecutionResult[],
    context: OrchestratorContext,
  ): { stageArtifact: ArtifactValue; synthesisDecision: Decision } {
    // Guard: all synthesis artifacts must be present.
    // Intentionally uses strict null/undefined checks — 0, false, and "" are valid artifact values.
    const missing = flavorResults.filter(
      (r) => r.synthesisArtifact.value === null || r.synthesisArtifact.value === undefined,
    );
    if (missing.length > 0) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" synthesis failed: ` +
          `synthesis artifact missing from flavor(s): ${missing.map((r) => r.flavorName).join(', ')}. ` +
          `Ensure each Flavor's executor returns a non-null synthesisArtifact value.`,
      );
    }

    // Delegate strategy selection to the subclass
    const strategy = this.getSynthesisStrategy(flavorResults, context);

    // Guard: approach must be one of the declared alternatives — a missing entry
    // indicates a buggy subclass implementation, not a user error.
    if (!strategy.alternatives.includes(strategy.approach)) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" getSynthesisStrategy() returned approach ` +
          `"${strategy.approach}" which is not present in alternatives: ` +
          `[${strategy.alternatives.join(', ')}]. Fix the subclass implementation.`,
      );
    }

    // Build merged artifact: keyed by flavor name
    const mergedValue: Record<string, unknown> = {};
    for (const result of flavorResults) {
      mergedValue[result.flavorName] = result.synthesisArtifact.value;
    }

    const stageArtifact = {
      name: `${this.stageCategory}-synthesis`,
      value: mergedValue,
    };

    // Use alternatives directly as options (approach is already guaranteed to be in alternatives)
    const options = strategy.alternatives;

    let synthesisDecision: Decision;
    try {
      synthesisDecision = this.deps.decisionRegistry.record({
        stageCategory: this.stageCategory,
        decisionType: 'synthesis-approach',
        context: {
          flavorCount: flavorResults.length,
          flavorNames: flavorResults.map((r) => r.flavorName),
        },
        options,
        selection: strategy.approach,
        reasoning: strategy.reasoning,
        confidence: 0.9,
        decidedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" failed to record synthesis-approach decision: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { stageArtifact, synthesisDecision };
  }

  /**
   * Score a Flavor's relevance to the current context.
   *
   * Score must be in the range [0, 1].
   * Higher scores mean the Flavor is more appropriate for this context.
   * Subclasses implement category-specific keyword matching and heuristics.
   */
  protected abstract scoreFlavorForContext(
    flavor: Flavor,
    context: OrchestratorContext,
  ): number;

  /**
   * Return the synthesis strategy to use for merging Flavor results.
   *
   * The returned `approach` must appear in `alternatives` (or be the only option).
   * This is used to build the 'synthesis-approach' Decision with well-formed options.
   */
  protected abstract getSynthesisStrategy(
    results: FlavorExecutionResult[],
    context: OrchestratorContext,
  ): SynthesisStrategy;
}
