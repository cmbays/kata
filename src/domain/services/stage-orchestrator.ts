import type { Stage, StageCategory, OrchestratorConfig } from '@domain/types/stage.js';
import type { StageVocabulary } from '@domain/types/vocabulary.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Decision } from '@domain/types/decision.js';
import type { CapabilityProfile, MatchReport, ReflectionResult } from '@domain/types/orchestration.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
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
  ruleRegistry?: IStageRuleRegistry;
}

/**
 * Describes a synthesis strategy for merging per-flavor results into a stage artifact.
 */
export interface SynthesisStrategy {
  approach: string;
  alternatives: [string, ...string[]];
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Extract a lowercase string from a bet field for keyword matching.
 */
export function betText(context: OrchestratorContext): string {
  const { bet } = context;
  if (!bet) return '';
  const parts: string[] = [];
  if (typeof bet.title === 'string') parts.push(bet.title);
  if (typeof bet.description === 'string') parts.push(bet.description);
  if (Array.isArray(bet.tags)) {
    for (const tag of bet.tags) {
      if (typeof tag === 'string') parts.push(tag);
    }
  }
  return parts.join(' ').toLowerCase();
}

/**
 * Score a Flavor by how many of the given keywords appear in its name,
 * description, or the bet context. Returns a value in [0, 1].
 */
export function keywordScore(
  flavor: Flavor,
  context: OrchestratorContext,
  keywords: string[],
): number {
  const text = betText(context);
  const flavorName = flavor.name.toLowerCase();
  const description = (flavor.description ?? '').toLowerCase();

  let hits = 0;
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    if (flavorName.includes(kwLower) || description.includes(kwLower) || text.includes(kwLower)) {
      hits++;
    }
  }

  return keywords.length > 0 ? Math.min(1, hits / keywords.length) : 0.5;
}

/**
 * Boost score for learnings that mention a flavor by name.
 */
export function learningBoost(flavor: Flavor, context: OrchestratorContext): number {
  const learnings = context.learnings ?? [];
  const flavorName = flavor.name.toLowerCase();
  return learnings.some((l) => l.toLowerCase().includes(flavorName)) ? 0.1 : 0;
}

// ---------------------------------------------------------------------------
// Internal types for match phase output
// ---------------------------------------------------------------------------

interface MatchPhaseResult {
  candidates: Flavor[];
  pinnedFlavors: Flavor[];
  matchReports: MatchReport[];
  excluded: Set<string>;
  pinned: Set<string>;
}

// ---------------------------------------------------------------------------
// Concrete Stage Orchestrator — vocabulary-driven, 6-phase loop
// ---------------------------------------------------------------------------

/**
 * Concrete Stage Orchestrator driven by vocabulary configuration.
 *
 * Implements the 6-phase orchestration loop:
 *   1. Analyze    — build capability profile from context, artifacts, and active rules.
 *   2. Match      — score all candidate flavors against the profile.
 *   3. Plan       — select flavors and decide sequential vs. parallel execution.
 *   4. Execute    — run each selected Flavor via the injected IFlavorExecutor.
 *   5. Synthesize — merge per-flavor outputs into a single stage-level artifact.
 *   6. Reflect    — capture decision outcomes and generate rule suggestions.
 *
 * Every non-deterministic judgment is recorded as a Decision via IDecisionRegistry.
 * Category-specific intelligence is driven by the injected StageVocabulary config.
 */
export class BaseStageOrchestrator implements IStageOrchestrator {
  constructor(
    protected readonly stageCategory: StageCategory,
    protected readonly deps: StageOrchestratorDeps,
    protected readonly config: OrchestratorConfig,
    protected readonly vocabulary?: StageVocabulary,
  ) {}

  async run(stage: Stage, context: OrchestratorContext): Promise<OrchestratorResult> {
    const decisions: Decision[] = [];

    // Phase 1: Analyze — build capability profile
    const { capabilityProfile, analysisDecision } = this.analyze(stage, context);
    decisions.push(analysisDecision);

    // Phase 2: Match — score all candidate flavors
    const matchResult = this.match(stage, context);

    // Phase 3: Plan — select flavors and decide execution mode
    const { selectedFlavors, executionMode, selectionDecision, modeDecision } =
      this.planExecution(matchResult, context);
    decisions.push(selectionDecision, modeDecision);

    // Phase 4: Execute — run selected flavors via the injected executor
    const flavorResults = await this.executeFlavors(selectedFlavors, executionMode, context);

    // Phase 5: Synthesize — merge per-flavor outputs into stage artifact
    const { stageArtifact, synthesisDecision } = this.synthesize(flavorResults, context);
    decisions.push(synthesisDecision);

    // Phase 6: Reflect — capture outcomes, generate rule suggestions
    const reflection = this.reflect(decisions, flavorResults);

    // selectedFlavors is guaranteed non-empty by planExecution() which throws otherwise.
    const selectedFlavorNames = selectedFlavors.map((f) => f.name) as [string, ...string[]];

    return {
      stageCategory: this.stageCategory,
      selectedFlavors: selectedFlavorNames,
      decisions,
      flavorResults,
      stageArtifact,
      executionMode,
      capabilityProfile,
      matchReports: matchResult.matchReports,
      reflection,
    };
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Analyze
  // ---------------------------------------------------------------------------

  /**
   * Build a CapabilityProfile describing the current execution context.
   * Records a 'capability-analysis' Decision.
   */
  protected analyze(
    stage: Stage,
    context: OrchestratorContext,
  ): { capabilityProfile: CapabilityProfile; analysisDecision: Decision } {
    // Load active rules for this category (if registry is available)
    const activeRuleIds: string[] = [];
    if (this.deps.ruleRegistry) {
      const rules = this.deps.ruleRegistry.loadRules(this.stageCategory);
      activeRuleIds.push(...rules.map((r) => r.id));
    }

    const capabilityProfile: CapabilityProfile = {
      betContext: context.bet,
      availableArtifacts: [...context.availableArtifacts],
      activeRules: activeRuleIds,
      learnings: [...(context.learnings ?? [])],
      stageCategory: this.stageCategory,
    };

    let analysisDecision: Decision;
    try {
      analysisDecision = this.deps.decisionRegistry.record({
        stageCategory: this.stageCategory,
        decisionType: 'capability-analysis',
        context: {
          availableArtifacts: context.availableArtifacts,
          bet: context.bet,
          learningCount: context.learnings?.length ?? 0,
          activeRuleCount: activeRuleIds.length,
          availableFlavorCount: stage.availableFlavors.length,
        },
        options: ['proceed', 'insufficient-context'],
        selection: 'proceed',
        reasoning:
          `Analyzed context for ${this.stageCategory} stage: ` +
          `${context.availableArtifacts.length} artifact(s), ` +
          `${context.learnings?.length ?? 0} learning(s), ` +
          `${activeRuleIds.length} active rule(s), ` +
          `${stage.availableFlavors.length} available flavor(s).`,
        confidence: 0.95,
        decidedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" failed to record capability-analysis decision: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { capabilityProfile, analysisDecision };
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Match
  // ---------------------------------------------------------------------------

  /**
   * Resolve and score all candidate flavors. Produces MatchReport[] with
   * detailed scoring breakdowns. Does not record a decision — scoring is
   * deterministic given the same vocabulary and context.
   */
  protected match(stage: Stage, context: OrchestratorContext): MatchPhaseResult {
    const excluded = new Set(stage.excludedFlavors ?? []);
    const pinned = new Set(stage.pinnedFlavors ?? []);

    // Warn when a flavor appears in both pinnedFlavors and excludedFlavors.
    for (const name of pinned) {
      if (excluded.has(name)) {
        logger.warn(
          `Orchestrator: flavor "${this.stageCategory}/${name}" is both pinned and excluded — excludedFlavors wins.`,
          { name, stageCategory: this.stageCategory },
        );
      }
    }

    // Filter out excluded flavors from the available set
    const candidateNames = stage.availableFlavors.filter((name) => !excluded.has(name));

    // Resolve pinned flavors from registry
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

    // If there are no candidates and no pinned flavors, throw.
    if (candidateNames.length === 0 && pinnedFlavors.length === 0) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" has no available flavors after applying excludedFlavors filter.`,
      );
    }

    // Resolve non-pinned candidate Flavors
    const pinnedNames = new Set(pinnedFlavors.map((f) => f.name));
    const candidates: Flavor[] = [];
    for (const name of candidateNames) {
      if (pinnedNames.has(name)) continue;
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

    // Score each candidate and produce MatchReports
    const keywords = this.vocabulary?.keywords ?? [];
    const matchReports: MatchReport[] = candidates.map((flavor) => {
      const base = this.scoreFlavorForContext(flavor, context);
      const kwHits = this.countKeywordHits(flavor, context, keywords);
      const lBoost = learningBoost(flavor, context);
      const ruleAdj = this.computeRuleAdjustments(flavor);

      return {
        flavorName: flavor.name,
        score: base,
        keywordHits: kwHits,
        ruleAdjustments: ruleAdj,
        learningBoost: lBoost,
        reasoning:
          `Score ${base.toFixed(2)}: ${kwHits} keyword hit(s), ` +
          `learning boost ${lBoost.toFixed(2)}, rule adj ${ruleAdj.toFixed(2)}.`,
      };
    });

    return { candidates, pinnedFlavors, matchReports, excluded, pinned };
  }

  /**
   * Score a Flavor's relevance to the current context using vocabulary config.
   * Falls back to a neutral score of 0.5 if no vocabulary is provided.
   */
  protected scoreFlavorForContext(
    flavor: Flavor,
    context: OrchestratorContext,
  ): number {
    if (!this.vocabulary) {
      return 0.5;
    }

    const base = keywordScore(flavor, context, this.vocabulary.keywords);

    // Apply artifact-based boost rules from vocabulary
    let boostTotal = 0;
    for (const rule of this.vocabulary.boostRules) {
      if (rule.artifactPattern === '*') {
        if (context.availableArtifacts.length > 0) {
          boostTotal += rule.magnitude;
        }
      } else {
        if (context.availableArtifacts.some((a) => a.includes(rule.artifactPattern))) {
          boostTotal += rule.magnitude;
        }
      }
    }

    const boost = learningBoost(flavor, context);
    return Math.min(1, base + boostTotal + boost);
  }

  /**
   * Count how many vocabulary keywords match the flavor name, description, or bet.
   */
  private countKeywordHits(
    flavor: Flavor,
    context: OrchestratorContext,
    keywords: string[],
  ): number {
    const text = betText(context);
    const flavorName = flavor.name.toLowerCase();
    const description = (flavor.description ?? '').toLowerCase();

    let hits = 0;
    for (const kw of keywords) {
      const kwLower = kw.toLowerCase();
      if (flavorName.includes(kwLower) || description.includes(kwLower) || text.includes(kwLower)) {
        hits++;
      }
    }
    return hits;
  }

  /**
   * Compute rule-based score adjustments for a flavor.
   * Returns 0 if no rule registry is available.
   */
  private computeRuleAdjustments(_flavor: Flavor): number {
    // Rule adjustments will be fully implemented when rules are integrated
    // into scoring. For now, returns 0 (no adjustment).
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Phase 3: Plan
  // ---------------------------------------------------------------------------

  /**
   * Select flavors and decide execution mode based on match results.
   * Records 'flavor-selection' and 'execution-mode' Decisions.
   */
  protected planExecution(
    matchResult: MatchPhaseResult,
    context: OrchestratorContext,
  ): {
    selectedFlavors: Flavor[];
    executionMode: 'sequential' | 'parallel';
    selectionDecision: Decision;
    modeDecision: Decision;
  } {
    const { candidates, pinnedFlavors, matchReports, pinned, excluded } = matchResult;

    // Sort non-pinned candidates by descending score using match reports
    const scored = candidates
      .map((flavor) => {
        const report = matchReports.find((r) => r.flavorName === flavor.name);
        return { flavor, score: report?.score ?? this.scoreFlavorForContext(flavor, context) };
      })
      .sort((a, b) => b.score - a.score);

    // Top-scored non-pinned candidate
    const topNonPinned = scored.length > 0 ? [scored[0]!.flavor] : [];

    // Build selected set: pinned first, then top non-pinned (deduplicated)
    const seen = new Set<string>();
    const selected: Flavor[] = [];
    for (const f of [...pinnedFlavors, ...topNonPinned]) {
      if (!seen.has(f.name)) {
        seen.add(f.name);
        selected.push(f);
      }
    }

    // Compute confidence from top scorer
    const topScore = scored[0]?.score ?? 0;
    const confidence = Math.min(1, Math.max(0, topScore));

    // Decision options = all resolvable flavors
    const options = [...candidates, ...pinnedFlavors].map((f) => f.name);
    const selection =
      scored[0]?.flavor.name ??
      (pinnedFlavors[0]?.name ?? candidates[0]!.name);

    if (!options.includes(selection)) {
      options.push(selection);
    }

    const scoreSummary = scored
      .slice(0, 3)
      .map(({ flavor, score }) => `${flavor.name}(${score.toFixed(2)})`)
      .join(', ');

    let selectionDecision: Decision;
    try {
      selectionDecision = this.deps.decisionRegistry.record({
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

    // Decide execution mode
    const maxParallel = this.config.maxParallelFlavors;
    const executionMode: 'sequential' | 'parallel' =
      selected.length > 1 && selected.length <= maxParallel ? 'parallel' : 'sequential';

    const modeReasoning =
      selected.length <= 1
        ? 'Only one flavor selected; sequential is optimal.'
        : selected.length <= maxParallel
          ? `${selected.length} flavors fit within maxParallelFlavors=${maxParallel}; parallelizing for efficiency.`
          : `${selected.length} flavors exceeds maxParallelFlavors=${maxParallel}; running sequentially to respect resource limits.`;

    let modeDecision: Decision;
    try {
      modeDecision = this.deps.decisionRegistry.record({
        stageCategory: this.stageCategory,
        decisionType: 'execution-mode',
        context: {
          flavorCount: selected.length,
          maxParallelFlavors: maxParallel,
          selectedFlavors: selected.map((f) => f.name),
        },
        options: ['sequential', 'parallel'],
        selection: executionMode,
        reasoning: modeReasoning,
        confidence: 0.95,
        decidedAt: new Date().toISOString(),
      });
    } catch (err) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" failed to record execution-mode decision: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return { selectedFlavors: selected, executionMode, selectionDecision, modeDecision };
  }

  // ---------------------------------------------------------------------------
  // Phase 4: Execute
  // ---------------------------------------------------------------------------

  protected async executeFlavors(
    flavors: Flavor[],
    executionMode: 'sequential' | 'parallel',
    context: OrchestratorContext,
  ): Promise<FlavorExecutionResult[]> {
    if (executionMode === 'parallel') {
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

  // ---------------------------------------------------------------------------
  // Phase 5: Synthesize
  // ---------------------------------------------------------------------------

  /**
   * Return the synthesis strategy using vocabulary config.
   * Falls back to merge-all if no vocabulary is provided.
   */
  protected getSynthesisStrategy(
    results: FlavorExecutionResult[],
    _context: OrchestratorContext,
  ): SynthesisStrategy {
    const pref = this.vocabulary?.synthesisPreference ?? 'merge-all';
    const alts = this.vocabulary?.synthesisAlternatives ?? ['merge-all', 'first-wins', 'cascade'];
    const template = this.vocabulary?.reasoningTemplate ??
      'Merging all {count} flavor synthesis artifact(s) into a single keyed record for downstream stage consumption.';

    const reasoning = template.replace('{count}', String(results.length));

    return {
      approach: pref,
      alternatives: alts as [string, ...string[]],
      reasoning,
    };
  }

  protected synthesize(
    flavorResults: FlavorExecutionResult[],
    context: OrchestratorContext,
  ): { stageArtifact: ArtifactValue; synthesisDecision: Decision } {
    const missing = flavorResults.filter(
      (r) => r.synthesisArtifact.value === null || r.synthesisArtifact.value === undefined,
    );
    if (missing.length > 0) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" synthesis failed: ` +
          `synthesis artifact missing from flavor(s): ${missing.map((r) => r.flavorName).join(', ')}.`,
      );
    }

    const strategy = this.getSynthesisStrategy(flavorResults, context);

    if (!strategy.alternatives.includes(strategy.approach)) {
      throw new OrchestratorError(
        `Stage "${this.stageCategory}" getSynthesisStrategy() returned approach ` +
          `"${strategy.approach}" which is not present in alternatives: ` +
          `[${strategy.alternatives.join(', ')}]. Fix the vocabulary configuration.`,
      );
    }

    const mergedValue: Record<string, unknown> = {};
    for (const result of flavorResults) {
      mergedValue[result.flavorName] = result.synthesisArtifact.value;
    }

    const stageArtifact = {
      name: `${this.stageCategory}-synthesis`,
      value: mergedValue,
    };

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

  // ---------------------------------------------------------------------------
  // Phase 6: Reflect
  // ---------------------------------------------------------------------------

  /**
   * Post-execution reflection: update decision outcomes and generate rule suggestions.
   * Skips gracefully when rule registry is absent.
   */
  protected reflect(
    decisions: Decision[],
    flavorResults: FlavorExecutionResult[],
  ): ReflectionResult {
    const allSucceeded = flavorResults.length > 0 &&
      flavorResults.every((r) => r.synthesisArtifact.value !== null && r.synthesisArtifact.value !== undefined);

    const overallQuality = allSucceeded ? 'good' : 'partial';

    // Update outcomes for each decision made during this run
    const decisionOutcomes: ReflectionResult['decisionOutcomes'] = [];
    for (const decision of decisions) {
      const outcome = {
        artifactQuality: overallQuality as 'good' | 'partial' | 'poor',
        gateResult: allSucceeded ? 'passed' as const : undefined,
        reworkRequired: !allSucceeded,
      };

      try {
        this.deps.decisionRegistry.updateOutcome(decision.id, outcome);
        decisionOutcomes.push({ decisionId: decision.id, outcome });
      } catch (err) {
        // Non-fatal: log and continue
        logger.warn(
          `Reflect: failed to update outcome for decision "${decision.id}": ${err instanceof Error ? err.message : String(err)}`,
          { decisionId: decision.id },
        );
      }
    }

    // Generate learnings
    const learnings: string[] = [];
    if (allSucceeded) {
      learnings.push(
        `${this.stageCategory} stage completed successfully with ${flavorResults.length} flavor(s).`,
      );
    } else {
      learnings.push(
        `${this.stageCategory} stage had partial results — review flavor outputs for quality.`,
      );
    }

    // Generate rule suggestions if rule registry is available
    const ruleSuggestions: string[] = [];
    if (this.deps.ruleRegistry && flavorResults.length > 1) {
      // Future: analyze patterns across multiple runs to suggest meaningful rules.
      // For now, rule suggestion generation is a no-op — the infrastructure is ready.
    }

    return {
      decisionOutcomes,
      learnings,
      ruleSuggestions,
      overallQuality,
    };
  }
}
