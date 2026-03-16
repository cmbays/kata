import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import type { CycleManager, CooldownReport } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IPersistence } from '@domain/ports/persistence.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { DiaryWriter } from '@features/dojo/diary-writer.js';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import type { SessionBuilder } from '@features/dojo/session-builder.js';
import { DataAggregator } from '@features/dojo/data-aggregator.js';
import { logger } from '@shared/lib/logger.js';
import { loadRunSummary } from './run-summary-loader.js';
import { ProposalGenerator, type CycleProposal, type ProposalGeneratorDeps } from './proposal-generator.js';
import { NextKeikoProposalGenerator, type NextKeikoProposalGeneratorDeps, type NextKeikoResult } from './next-keiko-proposal-generator.js';
import type { RunSummary } from './types.js';
import { PredictionMatcher } from '@features/self-improvement/prediction-matcher.js';
import { CalibrationDetector } from '@features/self-improvement/calibration-detector.js';
import { HierarchicalPromoter } from '@infra/knowledge/hierarchical-promoter.js';
import { FrictionAnalyzer } from '@features/self-improvement/friction-analyzer.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { readAllObservationsForRun, readRun } from '@infra/persistence/run-store.js';
import type { Observation } from '@domain/types/observation.js';
import {
  SynthesisInputSchema,
  SynthesisResultSchema,
  type SynthesisProposal,
} from '@domain/types/synthesis.js';
import type { BeltCalculator } from '@features/belt/belt-calculator.js';
import { loadProjectState, type BeltComputeResult } from '@features/belt/belt-calculator.js';
import type { KataAgentConfidenceCalculator } from '@features/kata-agent/kata-agent-confidence-calculator.js';
import { KataAgentRegistry } from '@infra/registries/kata-agent-registry.js';
import {
  buildAgentPerspectiveFromProposals,
  buildBeltAdvancementMessage,
  buildCooldownBudgetUsage,
  buildExpiryCheckMessages,
  buildCooldownLearningDrafts,
  buildDiaryBetOutcomesFromCycleBets,
  buildDojoSessionBuildRequest,
  buildSynthesisInputRecord,
  clampConfidenceWithDelta,
  filterExecutionHistoryForCycle,
  listCompletedBetDescriptions,
  mapBridgeRunStatusToIncompleteStatus,
  mapBridgeRunStatusToSyncedOutcome,
  resolveAppliedProposalIds,
  selectEffectiveBetOutcomes,
  shouldRecordBetOutcomes,
  shouldWarnOnIncompleteRuns,
  shouldWriteDojoDiary,
  shouldWriteDojoSession,
  isJsonFile,
  isSynthesisPendingFile,
  hasFailedCaptures,
  isSyncableBet,
  collectBridgeRunIds,
  hasObservations,
  shouldSyncOutcomes,
  hasMethod,
} from './cooldown-session.helpers.js';

/**
 * Dependencies injected into CooldownSession for testability.
 */
export interface CooldownSessionDeps {
  cycleManager: CycleManager;
  knowledgeStore: IKnowledgeStore;
  persistence: IPersistence;
  pipelineDir: string;
  historyDir: string;
  /** Optional — injected for testability; defaults to a standard ProposalGenerator. */
  proposalGenerator?: Pick<ProposalGenerator, 'generate'>;
  /**
   * Optional path to .kata/runs/ directory. When provided, CooldownSession loads
   * run summaries (decisions, gaps, artifacts) and passes them to ProposalGenerator.
   * Backward compatible — omitting this field leaves existing behavior unchanged.
   */
  runsDir?: string;
  /**
   * Optional rule registry for loading pending rule suggestions during cooldown.
   * Backward compatible — omitting this field leaves existing behavior unchanged.
   */
  ruleRegistry?: IStageRuleRegistry;
  /**
   * Optional path to .kata/dojo/ directory. When provided, CooldownSession writes
   * a diary entry during cooldown. Backward compatible — omitting this field skips diary writing.
   */
  dojoDir?: string;
  /**
   * Optional PredictionMatcher for matching cycle predictions to outcomes.
   * When omitted and runsDir is set, a PredictionMatcher is constructed automatically.
   * Backward compatible — omitting skips prediction matching.
   */
  predictionMatcher?: Pick<PredictionMatcher, 'match'>;
  /**
   * Optional HierarchicalPromoter for bubbling step-tier learnings up the hierarchy.
   * When omitted, a HierarchicalPromoter is constructed automatically using knowledgeStore.
   * Backward compatible — omitting skips hierarchical promotion.
   */
  hierarchicalPromoter?: Pick<HierarchicalPromoter, 'promoteStepToFlavor' | 'promoteFlavorToStage' | 'promoteStageToCategory'>;
  /**
   * Optional FrictionAnalyzer for resolving friction observations per run.
   * When omitted and runsDir is set, a FrictionAnalyzer is constructed automatically.
   * Backward compatible — omitting this field skips friction analysis.
   */
  frictionAnalyzer?: Pick<FrictionAnalyzer, 'analyze'>;
  /**
   * Optional CalibrationDetector for detecting systematic prediction biases per run.
   * When omitted and runsDir is set, a CalibrationDetector is constructed automatically.
   * Backward compatible — omitting this field skips calibration detection.
   */
  calibrationDetector?: Pick<CalibrationDetector, 'detect'>;
  /**
   * Optional path to .kata/synthesis/ directory. When provided, CooldownSession writes
   * synthesis input files during prepare() and reads synthesis results during complete().
   * Defaults to join(kataDir, 'synthesis') when not provided — consumers must pass it explicitly.
   * Backward compatible — omitting this field skips synthesis file writing.
   */
  synthesisDir?: string;
  /**
   * Cooldown synthesis depth — controls how much data is included in the synthesis input.
   * Defaults to 'standard'.
   */
  synthesisDepth?: import('@domain/types/synthesis.js').SynthesisDepth;
  /**
   * Optional path to .kata/bridge-runs/ directory. When provided, CooldownSession
   * auto-syncs pending bet outcomes from bridge-run metadata before generating the
   * cooldown report, and uses bridge-run status (not run.json) in checkIncompleteRuns.
   * Backward compatible — omitting this field leaves existing behavior unchanged.
   */
  bridgeRunsDir?: string;
  /**
   * Optional BeltCalculator for computing belt level after cooldown.
   * Backward compatible — omitting skips belt computation.
   */
  beltCalculator?: Pick<BeltCalculator, 'computeAndStore'>;
  /**
   * Optional path to .kata/project-state.json for belt computation.
   * Required when beltCalculator is provided.
   */
  projectStateFile?: string;
  /**
   * Optional KataAgentConfidenceCalculator for computing per-agent confidence profiles.
   * Backward compatible — omitting skips confidence computation.
   */
  agentConfidenceCalculator?: Pick<KataAgentConfidenceCalculator, 'compute'>;
  /**
   * Compatibility alias for older callers still passing kataka-named deps.
   */
  katakaConfidenceCalculator?: Pick<KataAgentConfidenceCalculator, 'compute'>;
  /**
   * Optional path to the agent registry directory. Required when agentConfidenceCalculator is provided.
   */
  agentDir?: string;
  /**
   * Compatibility alias for older callers still passing katakaDir.
   */
  katakaDir?: string;
  /**
   * Optional injected NextKeikoProposalGenerator for testability.
   * When omitted and runsDir is set, a NextKeikoProposalGenerator is constructed automatically.
   * Backward compatible — omitting this field skips next-keiko proposal generation.
   */
  nextKeikoProposalGenerator?: Pick<NextKeikoProposalGenerator, 'generate'>;
  /**
   * Optional milestone name for next-keiko proposals.
   * When provided, open issues in this milestone are fetched via `gh issue list` and
   * included in the synthesis prompt.
   */
  nextKeikoMilestoneName?: string;
  /**
   * Optional injectable NextKeikoProposalGeneratorDeps for the auto-constructed generator.
   * Primarily used for testing to inject mock claude/gh invocations.
   */
  nextKeikoGeneratorDeps?: NextKeikoProposalGeneratorDeps;
  /**
   * Optional SessionBuilder for generating a dojo session during cooldown complete.
   * When provided (alongside dojoDir), CooldownSession generates a DojoSession that
   * satisfies the belt criterion dojoSessionsGenerated >= N.
   * Backward compatible — omitting this field skips dojo session generation.
   */
  dojoSessionBuilder?: Pick<SessionBuilder, 'build'>;
}

/**
 * A run that was found to be incomplete when cooldown was triggered.
 */
export interface IncompleteRunInfo {
  runId: string;
  betId: string;
  status: 'pending' | 'running';
}

/**
 * Record of a bet's outcome after cooldown review.
 */
export interface BetOutcomeRecord {
  betId: string;
  outcome: 'complete' | 'partial' | 'abandoned';
  notes?: string;
  /** Human-readable bet description, for display in diary entries. */
  betDescription?: string;
}

/**
 * Full result of a cooldown session.
 */
export interface CooldownSessionResult {
  report: CooldownReport;
  betOutcomes: BetOutcomeRecord[];
  proposals: CycleProposal[];
  learningsCaptured: number;
  /** Per-bet run summaries from .kata/runs/ data. Present when runsDir was provided. */
  runSummaries?: RunSummary[];
  /** Pending rule suggestions loaded during cooldown. Present when ruleRegistry was provided. */
  ruleSuggestions?: RuleSuggestion[];
  /** ID of the synthesis input file written by prepare(). */
  synthesisInputId?: string;
  /** Path to the synthesis input file written by prepare(). */
  synthesisInputPath?: string;
  /** Synthesis proposals that were applied during complete(). */
  synthesisProposals?: SynthesisProposal[];
  /** Belt computation result. Present when beltCalculator was provided. */
  beltResult?: BeltComputeResult;
  /**
   * Runs that were found to be incomplete (pending/running) when cooldown was triggered.
   * Non-empty only when runsDir is provided and incomplete runs were detected.
   * Always present (may be empty array) when runsDir is configured.
   */
  incompleteRuns?: IncompleteRunInfo[];
  /**
   * LLM-generated next-keiko bet proposals. Present when runsDir is configured
   * and NextKeikoProposalGenerator ran successfully during complete().
   */
  nextKeikoResult?: NextKeikoResult;
}

/**
 * Intermediate result returned by prepare() before synthesis.
 * Does NOT include completedAt (cycle not yet 'complete').
 */
export interface CooldownPrepareResult {
  report: CooldownReport;
  betOutcomes: BetOutcomeRecord[];
  proposals: CycleProposal[];
  learningsCaptured: number;
  runSummaries?: RunSummary[];
  ruleSuggestions?: RuleSuggestion[];
  synthesisInputId: string;
  synthesisInputPath: string;
  /**
   * Runs that were found to be incomplete (pending/running) when cooldown was triggered.
   * Non-empty only when runsDir is provided and incomplete runs were detected.
   * Always present (may be empty array) when runsDir is configured.
   */
  incompleteRuns?: IncompleteRunInfo[];
}

/**
 * Orchestrates the full cooldown experience for a cycle.
 *
 * The existing CycleManager.generateCooldown() produces a basic CooldownReport.
 * This class adds interactive features on top:
 * - Transition cycle state through cooldown -> complete
 * - Enrich report with actual token usage
 * - Record bet outcomes
 * - Generate next-cycle proposals
 * - Capture learnings from the cooldown analysis
 */
export class CooldownSession {
  private readonly deps: CooldownSessionDeps;
  private readonly proposalGenerator: Pick<ProposalGenerator, 'generate'>;
  private readonly predictionMatcher: Pick<PredictionMatcher, 'match'> | null;
  private readonly calibrationDetector: Pick<CalibrationDetector, 'detect'> | null;
  private readonly hierarchicalPromoter: Pick<HierarchicalPromoter, 'promoteStepToFlavor' | 'promoteFlavorToStage' | 'promoteStageToCategory'>;
  private readonly frictionAnalyzer: Pick<FrictionAnalyzer, 'analyze'> | null;
  private readonly _nextKeikoProposalGenerator: Pick<NextKeikoProposalGenerator, 'generate'> | null;

  constructor(deps: CooldownSessionDeps) {
    this.deps = deps;
    this.proposalGenerator = this.resolveProposalGenerator(deps);
    this.predictionMatcher = this.resolvePredictionMatcher(deps);
    this.calibrationDetector = this.resolveCalibrationDetector(deps);
    this.hierarchicalPromoter = this.resolveHierarchicalPromoter(deps);
    this.frictionAnalyzer = this.resolveFrictionAnalyzer(deps);
    this._nextKeikoProposalGenerator = this.resolveNextKeikoProposalGenerator(deps);
  }

  private resolveProposalGenerator(deps: CooldownSessionDeps): Pick<ProposalGenerator, 'generate'> {
    if (deps.proposalGenerator) return deps.proposalGenerator;

    const generatorDeps: ProposalGeneratorDeps = {
      cycleManager: deps.cycleManager,
      knowledgeStore: deps.knowledgeStore,
      persistence: deps.persistence,
      pipelineDir: deps.pipelineDir,
    };
    return new ProposalGenerator(generatorDeps);
  }

  private resolvePredictionMatcher(deps: CooldownSessionDeps): Pick<PredictionMatcher, 'match'> | null {
    if (deps.predictionMatcher) return deps.predictionMatcher;
    return deps.runsDir ? new PredictionMatcher(deps.runsDir) : null;
  }

  private resolveCalibrationDetector(deps: CooldownSessionDeps): Pick<CalibrationDetector, 'detect'> | null {
    if (deps.calibrationDetector) return deps.calibrationDetector;
    return deps.runsDir ? new CalibrationDetector(deps.runsDir) : null;
  }

  private resolveHierarchicalPromoter(
    deps: CooldownSessionDeps,
  ): Pick<HierarchicalPromoter, 'promoteStepToFlavor' | 'promoteFlavorToStage' | 'promoteStageToCategory'> {
    return deps.hierarchicalPromoter ?? new HierarchicalPromoter(deps.knowledgeStore);
  }

  private resolveFrictionAnalyzer(deps: CooldownSessionDeps): Pick<FrictionAnalyzer, 'analyze'> | null {
    if (deps.frictionAnalyzer) return deps.frictionAnalyzer;
    return deps.runsDir ? new FrictionAnalyzer(deps.runsDir, deps.knowledgeStore) : null;
  }

  private resolveNextKeikoProposalGenerator(
    deps: CooldownSessionDeps,
  ): Pick<NextKeikoProposalGenerator, 'generate'> | null {
    if (deps.nextKeikoProposalGenerator) return deps.nextKeikoProposalGenerator;
    return deps.nextKeikoGeneratorDeps ? new NextKeikoProposalGenerator(deps.nextKeikoGeneratorDeps) : null;
  }

  private warnOnIncompleteRuns(incompleteRuns: IncompleteRunInfo[], force: boolean): void {
    if (!shouldWarnOnIncompleteRuns(incompleteRuns.length, force)) return;
    logger.warn(
      `Warning: ${incompleteRuns.length} run(s) are still in progress. Cooldown data may be incomplete. Proceeding — use --force to suppress this warning.`,
    );
  }

  private beginCooldown(cycleId: string): Cycle['state'] {
    const previousState = this.deps.cycleManager.get(cycleId).state;
    this.deps.cycleManager.updateState(cycleId, 'cooldown');
    return previousState;
  }

  private rollbackCycleState(cycleId: string, previousState: Cycle['state']): void {
    try {
      this.deps.cycleManager.updateState(cycleId, previousState);
    } catch (rollbackError) {
      logger.error(`Failed to roll back cycle "${cycleId}" from cooldown to "${previousState}". Manual intervention may be required.`, {
        rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
  }

  private buildCooldownPhase(cycleId: string, betOutcomes: BetOutcomeRecord[]): {
    cycle: Cycle;
    report: CooldownReport;
    runSummaries?: RunSummary[];
    proposals: CycleProposal[];
    ruleSuggestions?: RuleSuggestion[];
    learningsCaptured: number;
    effectiveBetOutcomes: BetOutcomeRecord[];
  } {
    const syncedOutcomes = this.autoSyncBetOutcomesFromBridgeRuns(cycleId);
    this.recordExplicitBetOutcomes(cycleId, betOutcomes);
    const cycle = this.deps.cycleManager.get(cycleId);
    const report = this.buildCooldownReport(cycleId);
    const runSummaries = this.maybeLoadRunSummaries(cycle);

    return {
      cycle,
      report,
      runSummaries,
      proposals: this.proposalGenerator.generate(cycleId, runSummaries),
      ruleSuggestions: this.loadRuleSuggestions(),
      learningsCaptured: this.captureCooldownLearnings(report),
      effectiveBetOutcomes: selectEffectiveBetOutcomes(betOutcomes, syncedOutcomes) as BetOutcomeRecord[],
    };
  }

  private buildCooldownReport(cycleId: string): CooldownReport {
    const report = this.deps.cycleManager.generateCooldown(cycleId);
    return this.enrichReportWithTokens(report, cycleId);
  }

  private maybeLoadRunSummaries(cycle: Cycle): RunSummary[] | undefined {
    return this.deps.runsDir ? this.loadRunSummaries(cycle) : undefined;
  }

  private loadRuleSuggestions(): RuleSuggestion[] | undefined {
    if (!this.deps.ruleRegistry) return undefined;

    try {
      return this.deps.ruleRegistry.getPendingSuggestions();
    } catch (err) {
      logger.warn(`Failed to load rule suggestions: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private recordExplicitBetOutcomes(cycleId: string, betOutcomes: BetOutcomeRecord[]): void {
    if (!shouldRecordBetOutcomes(betOutcomes)) return;
    this.recordBetOutcomes(cycleId, betOutcomes);
  }

  private runCooldownFollowUps(cycle: Cycle): void {
    this.runPredictionMatching(cycle);
    this.runCalibrationDetection(cycle);
    this.runHierarchicalPromotion();
    this.runExpiryCheck();
    this.runFrictionAnalysis(cycle);
  }

  private computeOptionalBeltResult(): BeltComputeResult | undefined {
    if (!this.deps.beltCalculator || !this.deps.projectStateFile) return undefined;

    try {
      const state = loadProjectState(this.deps.projectStateFile);
      const beltResult = this.deps.beltCalculator.computeAndStore(this.deps.projectStateFile, state);
      const beltAdvanceMessage = buildBeltAdvancementMessage(beltResult);
      if (beltAdvanceMessage) {
        logger.info(beltAdvanceMessage);
      }
      return beltResult;
    } catch (err) {
      logger.warn(`Belt computation failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private computeOptionalAgentConfidence(): void {
    const agentConfidenceCalculator = this.deps.agentConfidenceCalculator ?? this.deps.katakaConfidenceCalculator;
    const agentDir = this.deps.agentDir ?? this.deps.katakaDir;
    if (!agentConfidenceCalculator || !agentDir) return;

    try {
      const registry = new KataAgentRegistry(agentDir);
      for (const agent of registry.list()) {
        agentConfidenceCalculator.compute(agent.id, agent.name);
      }
    } catch (err) {
      logger.warn(`Agent confidence computation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private writeRunDiary(input: {
    cycleId: string;
    cycleName?: string;
    cycle: Cycle;
    betOutcomes: BetOutcomeRecord[];
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    learningsCaptured: number;
    ruleSuggestions?: RuleSuggestion[];
    humanPerspective?: string;
  }): void {
    if (!shouldWriteDojoDiary(this.deps.dojoDir)) return;

    this.writeDiaryEntry({
      cycleId: input.cycleId,
      cycleName: input.cycleName,
      betOutcomes: this.enrichBetOutcomesWithDescriptions(input.cycle, input.betOutcomes),
      proposals: input.proposals,
      runSummaries: input.runSummaries,
      learningsCaptured: input.learningsCaptured,
      ruleSuggestions: input.ruleSuggestions,
      humanPerspective: input.humanPerspective,
    });
  }

  private enrichBetOutcomesWithDescriptions(cycle: Cycle, betOutcomes: BetOutcomeRecord[]): BetOutcomeRecord[] {
    const betDescriptionMap = new Map(cycle.bets.map((bet) => [bet.id, bet.description]));
    return betOutcomes.map((betOutcome) => ({
      ...betOutcome,
      betDescription: betOutcome.betDescription ?? betDescriptionMap.get(betOutcome.betId),
    }));
  }

  private writeCompleteDiary(input: {
    cycleId: string;
    cycleName?: string;
    cycle: Cycle;
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    ruleSuggestions?: RuleSuggestion[];
    synthesisProposals?: SynthesisProposal[];
  }): void {
    if (!shouldWriteDojoDiary(this.deps.dojoDir)) return;

    this.writeDiaryEntry({
      cycleId: input.cycleId,
      cycleName: input.cycleName,
      betOutcomes: buildDiaryBetOutcomesFromCycleBets(input.cycle.bets) as BetOutcomeRecord[],
      proposals: input.proposals,
      runSummaries: input.runSummaries,
      learningsCaptured: 0,
      ruleSuggestions: input.ruleSuggestions,
      agentPerspective: buildAgentPerspectiveFromProposals(input.synthesisProposals ?? []),
    });
  }

  private writeOptionalDojoSession(cycleId: string, cycleName?: string): void {
    if (!shouldWriteDojoSession(this.deps.dojoDir, this.deps.dojoSessionBuilder)) return;
    this.writeDojoSession(cycleId, cycleName);
  }

  private readAppliedSynthesisProposals(
    synthesisInputId?: string,
    acceptedProposalIds?: readonly string[],
  ): SynthesisProposal[] | undefined {
    const resultPath = this.resolveSynthesisResultPath(synthesisInputId);
    if (!resultPath || !existsSync(resultPath)) return undefined;

    try {
      const synthesisResult = JsonStore.read(resultPath, SynthesisResultSchema);
      return this.applyAcceptedSynthesisProposals(synthesisResult.proposals, acceptedProposalIds);
    } catch (err) {
      logger.warn(`Failed to read synthesis result for input ${synthesisInputId}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private resolveSynthesisResultPath(synthesisInputId?: string): string | undefined {
    if (!synthesisInputId || !this.deps.synthesisDir) return undefined;
    return join(this.deps.synthesisDir, `result-${synthesisInputId}.json`);
  }

  private applyAcceptedSynthesisProposals(
    proposals: readonly SynthesisProposal[],
    acceptedProposalIds?: readonly string[],
  ): SynthesisProposal[] {
    const idsToApply = resolveAppliedProposalIds(proposals, acceptedProposalIds);
    const appliedProposals: SynthesisProposal[] = [];

    for (const proposal of proposals) {
      if (!idsToApply.has(proposal.id)) continue;
      if (this.tryApplyProposal(proposal)) {
        appliedProposals.push(proposal);
      }
    }

    return appliedProposals;
  }

  private tryApplyProposal(proposal: SynthesisProposal): boolean {
    try {
      this.applyProposal(proposal);
      return true;
    } catch (err) {
      logger.warn(`Failed to apply synthesis proposal ${proposal.id} (${proposal.type}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  /**
   * Run the full cooldown session.
   *
   * 1. Check for incomplete runs (pending/running) — warn if found; --force bypasses
   * 2. Transition cycle state to 'cooldown'
   * 3. Record per-bet outcomes (data collection, not interactive -- CLI handles prompts)
   * 4. Generate the CooldownReport via CycleManager
   * 5. Enrich report with actual token usage from TokenTracker
   * 6. Load run summaries when runsDir provided
   * 7. Generate next-cycle proposals via ProposalGenerator
   * 8. Load pending rule suggestions when ruleRegistry provided
   * 9. Capture any learnings from the cooldown analysis
   * 10. Transition cycle state to 'complete'
   * 11. Return the full session result
   *
   * @param force When true, skips the incomplete-run guard and proceeds even if runs are in-progress.
   */
  async run(cycleId: string, betOutcomes: BetOutcomeRecord[] = [], { force = false, humanPerspective }: { force?: boolean; humanPerspective?: string } = {}): Promise<CooldownSessionResult> {
    const incompleteRuns = this.checkIncompleteRuns(cycleId);
    this.warnOnIncompleteRuns(incompleteRuns, force);
    const previousState = this.beginCooldown(cycleId);

    try {
      const phase = this.buildCooldownPhase(cycleId, betOutcomes);
      this.runCooldownFollowUps(phase.cycle);
      const beltResult = this.computeOptionalBeltResult();
      this.computeOptionalAgentConfidence();
      this.writeRunDiary({
        cycleId,
        cycleName: phase.cycle.name,
        cycle: phase.cycle,
        betOutcomes: phase.effectiveBetOutcomes,
        proposals: phase.proposals,
        runSummaries: phase.runSummaries,
        learningsCaptured: phase.learningsCaptured,
        ruleSuggestions: phase.ruleSuggestions,
        humanPerspective,
      });
      this.writeOptionalDojoSession(cycleId, phase.cycle.name);
      const nextKeikoResult = this.runNextKeikoProposals(phase.cycle);
      this.deps.cycleManager.updateState(cycleId, 'complete');

      return {
        report: phase.report,
        betOutcomes: phase.effectiveBetOutcomes,
        proposals: phase.proposals,
        learningsCaptured: phase.learningsCaptured,
        runSummaries: phase.runSummaries,
        ruleSuggestions: phase.ruleSuggestions,
        synthesisInputId: undefined,
        synthesisInputPath: undefined,
        synthesisProposals: undefined,
        beltResult,
        incompleteRuns: this.deps.runsDir ? incompleteRuns : undefined,
        nextKeikoResult,
      };
    } catch (error) {
      this.rollbackCycleState(cycleId, previousState);
      throw error;
    }
  }

  /**
   * Prepare the cooldown for LLM synthesis.
   *
   * Steps 1–9 from run(), but WITHOUT transitioning to 'complete'. Writes a
   * SynthesisInput file to .kata/synthesis/pending-<id>.json and returns its
   * location so the caller (or sensei) can run synthesis against it.
   *
   * Returns CooldownPrepareResult with synthesisInputId and synthesisInputPath.
   *
   * @param force When true, skips the incomplete-run guard and proceeds even if runs are in-progress.
   */
  async prepare(cycleId: string, betOutcomes: BetOutcomeRecord[] = [], depth?: import('@domain/types/synthesis.js').SynthesisDepth, { force = false }: { force?: boolean } = {}): Promise<CooldownPrepareResult> {
    const incompleteRuns = this.checkIncompleteRuns(cycleId);
    this.warnOnIncompleteRuns(incompleteRuns, force);
    const previousState = this.beginCooldown(cycleId);

    try {
      const phase = this.buildCooldownPhase(cycleId, betOutcomes);
      this.runCooldownFollowUps(phase.cycle);
      const effectiveDepth = depth ?? this.deps.synthesisDepth ?? 'standard';
      const { synthesisInputId, synthesisInputPath } = this.writeSynthesisInput(
        cycleId,
        phase.cycle,
        phase.report,
        effectiveDepth,
      );

      return {
        report: phase.report,
        betOutcomes,
        proposals: phase.proposals,
        learningsCaptured: phase.learningsCaptured,
        runSummaries: phase.runSummaries,
        ruleSuggestions: phase.ruleSuggestions,
        synthesisInputId,
        synthesisInputPath,
        incompleteRuns: this.deps.runsDir ? incompleteRuns : undefined,
      };
    } catch (error) {
      this.rollbackCycleState(cycleId, previousState);
      throw error;
    }
  }

  /**
   * Complete the cooldown after (optional) synthesis.
   *
   * 1. Reads the synthesis result from .kata/synthesis/result-<synthesisInputId>.json if it exists
   * 2. Applies accepted proposals to KnowledgeStore
   * 3. Writes dojo diary entry
   * 4. Transitions cycle to 'complete'
   * 5. Returns CooldownSessionResult with synthesisProposals populated
   */
  async complete(
    cycleId: string,
    synthesisInputId?: string,
    acceptedProposalIds?: string[],
  ): Promise<CooldownSessionResult> {
    const cycle = this.deps.cycleManager.get(cycleId);
    const report = this.buildCooldownReport(cycleId);
    const runSummaries = this.maybeLoadRunSummaries(cycle);
    const proposals = this.proposalGenerator.generate(cycleId, runSummaries);
    const ruleSuggestions = this.loadRuleSuggestions();
    const synthesisProposals = this.readAppliedSynthesisProposals(synthesisInputId, acceptedProposalIds);
    this.writeCompleteDiary({
      cycleId,
      cycleName: cycle.name,
      cycle,
      proposals,
      runSummaries,
      ruleSuggestions,
      synthesisProposals,
    });
    this.writeOptionalDojoSession(cycleId, cycle.name);
    const beltResult = this.computeOptionalBeltResult();
    this.computeOptionalAgentConfidence();
    const nextKeikoResult = this.runNextKeikoProposals(cycle);

    this.deps.cycleManager.updateState(cycleId, 'complete');

    return {
      report,
      betOutcomes: [],
      proposals,
      learningsCaptured: 0,
      runSummaries,
      ruleSuggestions,
      synthesisInputId,
      synthesisProposals,
      beltResult,
      nextKeikoResult,
    };
  }

  /**
   * Apply a single synthesis proposal to the KnowledgeStore.
   */
  private applyProposal(proposal: SynthesisProposal): void {
    switch (proposal.type) {
      case 'new-learning':
        this.deps.knowledgeStore.capture({
          tier: proposal.proposedTier,
          category: proposal.proposedCategory,
          content: proposal.proposedContent,
          confidence: proposal.confidence,
          source: 'synthesized',
        });
        break;

      case 'update-learning': {
        const existing = this.deps.knowledgeStore.get(proposal.targetLearningId);
        const newConfidence = clampConfidenceWithDelta(existing.confidence, proposal.confidenceDelta);
        this.deps.knowledgeStore.update(proposal.targetLearningId, {
          content: proposal.proposedContent,
          confidence: newConfidence,
        });
        break;
      }

      case 'promote':
        this.deps.knowledgeStore.promoteTier(proposal.targetLearningId, proposal.toTier);
        break;

      case 'archive':
        this.deps.knowledgeStore.archiveLearning(proposal.targetLearningId, proposal.reason);
        break;

      case 'methodology-recommendation':
        // Sensei writes methodology-recommendation to KATA.md — we only log here
        logger.info(`Methodology recommendation (area: ${proposal.area}): ${proposal.recommendation}`);
        break;
    }
  }

  /**
   * Read all observations for every bet in the cycle (across all levels: run,
   * stage, flavor, step), then write a SynthesisInput file to
   * .kata/synthesis/pending-<id>.json.
   * Returns the synthesisInputId and synthesisInputPath.
   * Non-critical: if synthesisDir is not configured, returns placeholder values.
   *
   * Run ID resolution order for each bet:
   *   1. bet.runId (set by CycleManager.setRunId / backfillRunIdInCycle on prepare)
   *   2. Bridge-run lookup by cycleId+betId (fallback for staged-workflow cycles
   *      launched before backfillRunIdInCycle was wired — fixes #337 / #335)
   */
  private writeSynthesisInput(
    cycleId: string,
    cycle: Cycle,
    report: CooldownReport,
    depth: import('@domain/types/synthesis.js').SynthesisDepth,
  ): { synthesisInputId: string; synthesisInputPath: string } {
    const target = this.createSynthesisTarget();
    if (!target.synthesisDir) {
      return { synthesisInputId: target.id, synthesisInputPath: '' };
    }

    const synthesisInput = buildSynthesisInputRecord({
      id: target.id,
      cycleId,
      createdAt: new Date().toISOString(),
      depth,
      observations: this.collectSynthesisObservations(cycleId, cycle),
      learnings: this.loadSynthesisLearnings(),
      cycleName: cycle.name,
      tokenBudget: report.budget.tokenBudget,
      tokensUsed: report.tokensUsed,
    });

    this.cleanupStaleSynthesisInputs(target.synthesisDir, cycleId);
    JsonStore.write(target.filePath, synthesisInput, SynthesisInputSchema);

    return { synthesisInputId: target.id, synthesisInputPath: target.filePath };
  }

  private createSynthesisTarget(): { id: string; synthesisDir?: string; filePath: string } {
    const id = crypto.randomUUID();
    const synthesisDir = this.deps.synthesisDir;
    const filePath = synthesisDir ? join(synthesisDir, `pending-${id}.json`) : '';
    return { id, synthesisDir, filePath };
  }

  private collectSynthesisObservations(cycleId: string, cycle: Cycle): Observation[] {
    const observations: Observation[] = [];
    if (!this.deps.runsDir) return observations;

    const bridgeRunIdByBetId = this.deps.bridgeRunsDir
      ? this.loadBridgeRunIdsByBetId(cycleId, this.deps.bridgeRunsDir)
      : new Map<string, string>();

    for (const bet of cycle.bets) {
      const runId = bet.runId ?? bridgeRunIdByBetId.get(bet.id);
      if (!runId) continue;

      const runObs = this.readObservationsForRun(runId, bet.id);
      if (hasObservations(runObs)) {
        observations.push(...runObs);
      }
    }

    return observations;
  }

  private readObservationsForRun(runId: string, betId: string): Observation[] {
    try {
      const stageSequence = this.readStageSequence(runId);
      return readAllObservationsForRun(this.deps.runsDir!, runId, stageSequence);
    } catch (err) {
      logger.warn(`Failed to read observations for run ${runId} (bet ${betId}): ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private readStageSequence(runId: string): import('@domain/types/stage.js').StageCategory[] {
    try {
      return readRun(this.deps.runsDir!, runId).stageSequence;
    } catch {
      return [];
    }
  }

  private loadSynthesisLearnings(): import('@domain/types/learning.js').Learning[] {
    try {
      return this.deps.knowledgeStore.query({});
    } catch (err) {
      logger.warn(`Failed to query learnings for synthesis input: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private cleanupStaleSynthesisInputs(synthesisDir: string, cycleId: string): void {
    try {
      const existing = readdirSync(synthesisDir).filter(isSynthesisPendingFile);
      for (const file of existing) {
        this.removeStaleSynthesisInputFile(synthesisDir, file, cycleId);
      }
    } catch {
      // Non-critical — if cleanup fails, still write the new file
    }
  }

  private removeStaleSynthesisInputFile(synthesisDir: string, file: string, cycleId: string): void {
    try {
      const raw = readFileSync(join(synthesisDir, file), 'utf-8');
      const meta = JSON.parse(raw) as { cycleId?: string };
      if (meta.cycleId !== cycleId) return;
      unlinkSync(join(synthesisDir, file));
      logger.debug(`Removed stale synthesis input file: ${file}`);
    } catch {
      // Skip unreadable / already-deleted files
    }
  }

  /**
   * Build a betId → runId map by scanning bridge-run files for the given cycle.
   *
   * This is the fallback lookup used by writeSynthesisInput() when bet.runId is
   * not set on the cycle record (e.g., staged-workflow cycles launched before
   * backfillRunIdInCycle was introduced in SessionExecutionBridge — fixes #335).
   *
   * Returns an empty Map when bridgeRunsDir is missing or unreadable.
   */
  private loadBridgeRunIdsByBetId(cycleId: string, bridgeRunsDir: string): Map<string, string> {
    const files = this.listJsonFiles(bridgeRunsDir);
    const metas = files
      .map((file) => this.readBridgeRunMeta(join(bridgeRunsDir, file)))
      .filter((meta): meta is NonNullable<typeof meta> => meta !== undefined);
    return collectBridgeRunIds(metas, cycleId);
  }

  private listJsonFiles(dir: string): string[] {
    try {
      return readdirSync(dir).filter(isJsonFile);
    } catch {
      return [];
    }
  }

  private readBridgeRunMeta(filePath: string): { cycleId?: string; betId?: string; runId?: string; status?: string } | undefined {
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as { cycleId?: string; betId?: string; runId?: string; status?: string };
    } catch {
      return undefined;
    }
  }

  /**
   * Auto-derive bet outcomes from bridge-run metadata for any bets still marked 'pending'.
   *
   * bridge-run/<runId>.json is updated by `execute complete` / `kiai complete`, unlike run.json which is
   * written once as "running" and never updated. This ensures cooldown always reflects
   * actual run completion even if the caller passed empty betOutcomes (fixes #216).
   *
   * Non-critical: any errors are swallowed so a missing/corrupt bridge-run file
   * does not abort the cooldown.
   */
  private autoSyncBetOutcomesFromBridgeRuns(cycleId: string): BetOutcomeRecord[] {
    const bridgeRunsDir = this.deps.bridgeRunsDir;
    if (!bridgeRunsDir) return [];

    const cycle = this.deps.cycleManager.get(cycleId);
    const toSync: BetOutcomeRecord[] = [];

    for (const bet of cycle.bets) {
      if (!isSyncableBet(bet)) continue;

      const outcome = this.readBridgeRunOutcome(bridgeRunsDir, bet.runId!);
      if (outcome) {
        toSync.push({ betId: bet.id, outcome });
      }
    }

    if (shouldSyncOutcomes(toSync)) {
      this.recordBetOutcomes(cycleId, toSync);
    }

    return toSync;
  }

  private readBridgeRunOutcome(
    bridgeRunsDir: string,
    runId: string,
  ): BetOutcomeRecord['outcome'] | undefined {
    const bridgeRunPath = join(bridgeRunsDir, `${runId}.json`);
    const status = this.readBridgeRunMeta(bridgeRunPath)?.status;
    return mapBridgeRunStatusToSyncedOutcome(status);
  }

  /**
   * Apply bet outcomes to the cycle via CycleManager.
   * Logs a warning for any unmatched bet IDs.
   */
  recordBetOutcomes(cycleId: string, outcomes: BetOutcomeRecord[]): void {
    const { unmatchedBetIds } = this.deps.cycleManager.updateBetOutcomes(cycleId, outcomes);
    if (unmatchedBetIds.length > 0) {
      logger.warn(`Bet outcome(s) for cycle "${cycleId}" referenced nonexistent bet IDs: ${unmatchedBetIds.join(', ')}`);
    }
  }

  /**
   * Enhance the basic cooldown report with actual token usage data.
   * Sums cycle-specific token consumption from execution history entries.
   */
  enrichReportWithTokens(report: CooldownReport, cycleId: string): CooldownReport {
    // Load history entries for this cycle to get per-pipeline usage
    const historyEntries = this.loadCycleHistory(cycleId);
    const cycleTokens = historyEntries.reduce((sum, entry) => {
      return sum + (entry.tokenUsage?.total ?? 0);
    }, 0);

    // Use cycle-specific tokens only — global fallback would be misleading
    const tokensUsed = cycleTokens;

    // Recalculate utilization
    const { utilizationPercent, alertLevel } = buildCooldownBudgetUsage(
      report.budget.tokenBudget,
      tokensUsed,
      report.alertLevel,
    );

    return {
      ...report,
      tokensUsed,
      utilizationPercent,
      alertLevel,
    };
  }

  /**
   * Capture learnings from the cooldown analysis itself.
   * Creates a learning if the cycle had interesting patterns.
   */
  private captureCooldownLearnings(report: CooldownReport): number {
    const attempts = this.captureCooldownLearningDrafts(report);
    if (hasFailedCaptures(attempts.failed)) {
      logger.warn(`${attempts.failed} of ${attempts.captured + attempts.failed} cooldown learnings failed to capture. Check previous warnings for details.`);
    }

    return attempts.captured;
  }

  private captureCooldownLearningDrafts(report: CooldownReport): { captured: number; failed: number } {
    let captured = 0;
    let failed = 0;
    const recordedAt = new Date().toISOString();
    const drafts = buildCooldownLearningDrafts({
      cycleId: report.cycleId,
      cycleName: report.cycleName,
      completionRate: report.completionRate,
      betCount: report.bets.length,
      tokenBudget: report.budget.tokenBudget,
      utilizationPercent: report.utilizationPercent,
      tokensUsed: report.tokensUsed,
    });

    for (const draft of drafts) {
      const capturedDraft = this.safeCaptureLearning({
        tier: 'category',
        category: draft.category,
        content: draft.content,
        confidence: draft.confidence,
        evidence: [{
          pipelineId: report.cycleId,
          stageType: 'cooldown',
          observation: draft.observation,
          recordedAt,
        }],
      });

      if (capturedDraft) {
        captured++;
      } else {
        failed++;
      }
    }

    return { captured, failed };
  }

  private safeCaptureLearning(params: Parameters<IKnowledgeStore['capture']>[0]): boolean {
    try {
      this.deps.knowledgeStore.capture(params);
      return true;
    } catch (error) {
      logger.warn(`Failed to capture cooldown learning: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Check whether any bets in the cycle have runs that are still in-progress.
   * Returns an array of IncompleteRunInfo for every run with status 'pending' or 'running'.
   * Returns an empty array when runsDir is not configured or all runs are complete/failed.
   * Read errors for individual run files are swallowed (the run is skipped silently).
   */
  checkIncompleteRuns(cycleId: string): IncompleteRunInfo[] {
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
    } catch {
      return undefined;
    }
  }

  /**
   * Load per-bet run summaries from .kata/runs/ state files.
   * Bets without a runId are skipped silently.
   * Missing run files or stage state files are skipped with a logger.warn.
   */
  private loadRunSummaries(cycle: Cycle): RunSummary[] {
    const runsDir = this.deps.runsDir!;
    const summaries: RunSummary[] = [];

    for (const bet of cycle.bets) {
      if (!bet.runId) continue;
      const summary = loadRunSummary(runsDir, bet.id, bet.runId);
      if (summary) summaries.push(summary);
    }

    return summaries;
  }

  /**
   * Load execution history entries associated with this cycle.
   *
   * Uses warnOnInvalid: false to suppress validation warnings for legacy
   * pre-schema history files that predate required fields (pipelineId,
   * stageType, stageIndex, adapter, startedAt, completedAt). These files
   * are expected to exist in long-running projects and are silently skipped
   * rather than flooding cooldown output with noise. See issue #238.
   */
  private loadCycleHistory(cycleId: string): ExecutionHistoryEntry[] {
    const allEntries = this.deps.persistence.list(
      this.deps.historyDir,
      ExecutionHistoryEntrySchema,
      { warnOnInvalid: false },
    );
    return filterExecutionHistoryForCycle(allEntries, cycleId);
  }

  /**
   * For each bet with a runId, run PredictionMatcher to match predictions to outcomes.
   * Writes validation/unmatched reflections to the run's JSONL file.
   * No-op when runsDir is absent or no prediction matcher is available.
   */
  private runPredictionMatching(cycle: Cycle): void {
    if (!this.predictionMatcher) return;
    this.runForEachBetRun(cycle, (runId) => this.predictionMatcher!.match(runId), 'Prediction matching');
  }

  /**
   * For each bet with a runId, run CalibrationDetector to detect systematic prediction biases.
   * Writes CalibrationReflections to the run's JSONL file.
   * Must run after runPredictionMatching (reads validation reflections it produces).
   * No-op when runsDir is absent or no calibration detector is available.
   */
  private runCalibrationDetection(cycle: Cycle): void {
    if (!this.calibrationDetector) return;
    this.runForEachBetRun(cycle, (runId) => this.calibrationDetector!.detect(runId), 'Calibration detection');
  }

  private runForEachBetRun(
    cycle: Cycle,
    runner: (runId: string) => void,
    label: string,
  ): void {
    for (const bet of cycle.bets) {
      if (!bet.runId) continue;
      this.runForBetRun(bet.runId, runner, label);
    }
  }

  private runForBetRun(
    runId: string,
    runner: (runId: string) => void,
    label: string,
  ): void {
    try {
      runner(runId);
    } catch (err) {
      logger.warn(`${label} failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Promote step-tier learnings up through flavor → stage → category.
   * Non-critical: errors are logged and swallowed.
   */
  private runHierarchicalPromotion(): void {
    try {
      const stepLearnings = this.deps.knowledgeStore.query({ tier: 'step' });
      const { learnings: flavorLearnings } = this.hierarchicalPromoter.promoteStepToFlavor(stepLearnings, 'cooldown-retrospective');
      const { learnings: stageLearnings } = this.hierarchicalPromoter.promoteFlavorToStage(flavorLearnings, 'cooldown');
      this.hierarchicalPromoter.promoteStageToCategory(stageLearnings);
    } catch (err) {
      logger.warn(`Hierarchical learning promotion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Scan all learnings for expiry: auto-archives expired operational ones,
   * flags stale strategic ones. Non-critical: errors are logged and swallowed.
   */
  private runExpiryCheck(): void {
    try {
      if (!hasMethod(this.deps.knowledgeStore, 'checkExpiry')) return;
      const result = this.deps.knowledgeStore.checkExpiry();
      for (const message of buildExpiryCheckMessages(result)) {
        logger.debug(message);
      }
    } catch (err) {
      logger.warn(`Learning expiry check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * For each bet with a runId, run FrictionAnalyzer to resolve contradiction observations.
   * Writes ResolutionReflections and optionally archives/captures learnings.
   * No-op when runsDir is absent or no friction analyzer is available.
   */
  private runFrictionAnalysis(cycle: Cycle): void {
    if (!this.frictionAnalyzer) return;
    this.runForEachBetRun(cycle, (runId) => this.frictionAnalyzer!.analyze(runId), 'Friction analysis');
  }

  private writeDiaryEntry(input: {
    cycleId: string;
    cycleName?: string;
    betOutcomes: BetOutcomeRecord[];
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    learningsCaptured: number;
    ruleSuggestions?: RuleSuggestion[];
    /** Part 2 — synthesis proposals summary or sensei reflection. */
    agentPerspective?: string;
    /** Part 3 — human input captured during collaborative cooldown. */
    humanPerspective?: string;
  }): void {
    try {
      const diaryDir = join(this.deps.dojoDir!, 'diary');
      const store = new DiaryStore(diaryDir);
      const writer = new DiaryWriter(store);
      writer.write({
        ...input,
        agentPerspective: input.agentPerspective,
        humanPerspective: input.humanPerspective,
      });
    } catch (err) {
      logger.warn(`Failed to write dojo diary entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Generate a DojoSession record for this cooldown.
   *
   * Constructs a DataAggregator from available deps, gathers cycle data, then
   * delegates to the injected dojoSessionBuilder (already wired with its SessionStore).
   * Non-critical — any error is caught and logged so it never aborts cooldown.
   *
   * Requires: dojoDir and dojoSessionBuilder both set in deps.
   */
  private writeDojoSession(cycleId: string, cycleName?: string): void {
    try {
      const request = this.buildDojoSessionRequest(cycleId, cycleName);
      const data = this.gatherDojoSessionData(request);
      this.deps.dojoSessionBuilder!.build(data, { title: request.title });
    } catch (err) {
      logger.warn(`Failed to generate dojo session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private buildDojoSessionRequest(cycleId: string, cycleName?: string): {
    diaryDir: string;
    runsDir: string;
    title: string;
  } {
    return buildDojoSessionBuildRequest({
      dojoDir: this.deps.dojoDir!,
      cycleId,
      cycleName,
      runsDir: this.deps.runsDir,
    });
  }

  private gatherDojoSessionData(request: { diaryDir: string; runsDir: string }): ReturnType<DataAggregator['gather']> {
    const diaryStore = new DiaryStore(request.diaryDir);
    const aggregator = new DataAggregator({
      knowledgeStore: this.deps.knowledgeStore as import('@features/dojo/data-aggregator.js').IDojoKnowledgeStore,
      diaryStore,
      cycleManager: this.deps.cycleManager,
      runsDir: request.runsDir,
    });

    return aggregator.gather({ maxDiaries: 5 });
  }

  /**
   * Build a text summary of synthesis proposals for use as the diary's agentPerspective.
   * Returns undefined when there are no proposals.
   */
  static buildAgentPerspectiveFromProposals(proposals: SynthesisProposal[]): string | undefined {
    return buildAgentPerspectiveFromProposals(proposals);
  }

  /**
   * Generate LLM-driven next-keiko proposals using NextKeikoProposalGenerator.
   * Non-critical: errors are caught and logged; returns undefined on failure.
   * No-op when runsDir is not configured or _nextKeikoProposalGenerator is null.
   */
  private runNextKeikoProposals(cycle: Cycle): NextKeikoResult | undefined {
    if (!this._nextKeikoProposalGenerator || !this.deps.runsDir) return undefined;

    try {
      return this.generateNextKeikoProposals(cycle);
    } catch (err) {
      logger.warn(
        `Next-keiko proposal generation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }

  private generateNextKeikoProposals(cycle: Cycle): NextKeikoResult {
    return this._nextKeikoProposalGenerator!.generate({
      cycle,
      runsDir: this.deps.runsDir!,
      bridgeRunsDir: this.deps.bridgeRunsDir,
      milestoneName: this.deps.nextKeikoMilestoneName,
      completedBets: listCompletedBetDescriptions(cycle.bets),
    });
  }
}
