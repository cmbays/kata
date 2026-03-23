import type { CycleManager, CooldownReport } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IPersistence } from '@domain/ports/persistence.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import type { SessionBuilder } from '@features/dojo/session-builder.js';
import { logger } from '@shared/lib/logger.js';
import { loadRunSummary } from './run-summary-loader.js';
import { ProposalGenerator, type CycleProposal, type ProposalGeneratorDeps } from './proposal-generator.js';
import { NextKeikoProposalGenerator, type NextKeikoProposalGeneratorDeps, type NextKeikoResult } from './next-keiko-proposal-generator.js';
import type { RunSummary } from './types.js';
import { PredictionMatcher } from '@features/self-improvement/prediction-matcher.js';
import { CalibrationDetector } from '@features/self-improvement/calibration-detector.js';
import { HierarchicalPromoter } from '@infra/knowledge/hierarchical-promoter.js';
import { FrictionAnalyzer } from '@features/self-improvement/friction-analyzer.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import type { BeltCalculator } from '@features/belt/belt-calculator.js';
import type { KataAgentConfidenceCalculator } from '@features/kata-agent/kata-agent-confidence-calculator.js';
import { KataAgentRegistry } from '@infra/registries/kata-agent-registry.js';
import { CooldownBeltComputer, type CooldownAgentRegistry } from './cooldown-belt-computer.js';
import { CooldownDiaryWriter } from './cooldown-diary-writer.js';
import { CooldownFollowUpRunner } from './cooldown-follow-up-runner.js';
import { CooldownSynthesisManager } from './cooldown-synthesis-manager.js';
import {
  buildAgentPerspectiveFromProposals,
  buildCooldownBudgetUsage,
  buildCooldownLearningDrafts,
  filterExecutionHistoryForCycle,
  listCompletedBetDescriptions,
  selectEffectiveBetOutcomes,
  shouldWarnOnIncompleteRuns,
} from './cooldown-session.helpers.js';
import { BridgeRunSyncer } from './bridge-run-syncer.js';
import type { BetOutcomeRecord, IncompleteRunInfo, CooldownSessionResult, CooldownPrepareResult } from './cooldown-types.js';

// Re-export shared types so existing consumers don't break
export type { BetOutcomeRecord, IncompleteRunInfo, CooldownSessionResult, CooldownPrepareResult } from './cooldown-types.js';

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
   * Optional path to the agent registry directory. Required when agentConfidenceCalculator is provided.
   */
  agentDir?: string;
  /**
   * Optional injected agent registry reader for agent confidence computation.
   * When omitted and agentDir is set, CooldownSession constructs KataAgentRegistry automatically.
   */
  agentRegistry?: CooldownAgentRegistry;
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
  private readonly _nextKeikoProposalGenerator: Pick<NextKeikoProposalGenerator, 'generate'> | null;
  private readonly bridgeRunSyncer: BridgeRunSyncer;
  private readonly beltComputer: CooldownBeltComputer;
  private readonly diaryWriter: CooldownDiaryWriter;
  private readonly followUpRunner: CooldownFollowUpRunner;
  private readonly synthesisManager: CooldownSynthesisManager;

  constructor(deps: CooldownSessionDeps) {
    this.deps = deps;
    this.proposalGenerator = this.resolveProposalGenerator(deps);
    this._nextKeikoProposalGenerator = this.resolveNextKeikoProposalGenerator(deps);
    this.bridgeRunSyncer = new BridgeRunSyncer({
      bridgeRunsDir: deps.bridgeRunsDir,
      runsDir: deps.runsDir,
      cycleManager: deps.cycleManager,
    });
    this.beltComputer = new CooldownBeltComputer({
      beltCalculator: deps.beltCalculator,
      projectStateFile: deps.projectStateFile,
      agentConfidenceCalculator: deps.agentConfidenceCalculator,
      agentRegistry: this.resolveAgentRegistry(deps),
    });
    this.diaryWriter = new CooldownDiaryWriter({
      dojoDir: deps.dojoDir,
      dojoSessionBuilder: deps.dojoSessionBuilder,
      knowledgeStore: deps.knowledgeStore,
      cycleManager: deps.cycleManager,
      runsDir: deps.runsDir,
    });
    this.followUpRunner = new CooldownFollowUpRunner({
      predictionMatcher: this.resolvePredictionMatcher(deps),
      calibrationDetector: this.resolveCalibrationDetector(deps),
      hierarchicalPromoter: this.resolveHierarchicalPromoter(deps),
      frictionAnalyzer: this.resolveFrictionAnalyzer(deps),
      knowledgeStore: deps.knowledgeStore,
    });
    this.synthesisManager = new CooldownSynthesisManager({
      synthesisDir: deps.synthesisDir,
      runsDir: deps.runsDir,
      knowledgeStore: deps.knowledgeStore,
      loadBridgeRunIdsByBetId: (cycleId) => this.bridgeRunSyncer.loadBridgeRunIdsByBetId(cycleId),
    });
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

  private resolveAgentRegistry(deps: CooldownSessionDeps): CooldownAgentRegistry | undefined {
    if (deps.agentRegistry) return deps.agentRegistry;
    return deps.agentDir ? new KataAgentRegistry(deps.agentDir) : undefined;
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
    const syncedOutcomes = this.bridgeRunSyncer.syncOutcomes(cycleId);
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
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn(`Failed to load rule suggestions: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private recordExplicitBetOutcomes(cycleId: string, betOutcomes: BetOutcomeRecord[]): void {
    if (betOutcomes.length === 0) return;
    this.bridgeRunSyncer.recordBetOutcomes(cycleId, betOutcomes);
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
    const incompleteRuns = this.bridgeRunSyncer.checkIncomplete(cycleId);
    this.warnOnIncompleteRuns(incompleteRuns, force);
    const previousState = this.beginCooldown(cycleId);

    try {
      const phase = this.buildCooldownPhase(cycleId, betOutcomes);
      this.followUpRunner.run(phase.cycle);
      const beltResult = this.beltComputer.compute();
      this.beltComputer.computeAgentConfidence();
      this.diaryWriter.writeForRun({
        cycleId,
        cycle: phase.cycle,
        betOutcomes: phase.effectiveBetOutcomes,
        proposals: phase.proposals,
        runSummaries: phase.runSummaries,
        learningsCaptured: phase.learningsCaptured,
        ruleSuggestions: phase.ruleSuggestions,
        humanPerspective,
      });
      this.diaryWriter.writeDojoSession(cycleId, phase.cycle.name);
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
    const incompleteRuns = this.bridgeRunSyncer.checkIncomplete(cycleId);
    this.warnOnIncompleteRuns(incompleteRuns, force);
    const previousState = this.beginCooldown(cycleId);

    try {
      const phase = this.buildCooldownPhase(cycleId, betOutcomes);
      this.followUpRunner.run(phase.cycle);
      const effectiveDepth = depth ?? this.deps.synthesisDepth ?? 'standard';
      const { synthesisInputId, synthesisInputPath } = this.synthesisManager.writeInput(
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
    const synthesisProposals = this.synthesisManager.readAndApplyResults(synthesisInputId, acceptedProposalIds);
    this.diaryWriter.writeForComplete({
      cycleId,
      cycle,
      proposals,
      runSummaries,
      ruleSuggestions,
      synthesisProposals,
    });
    this.diaryWriter.writeDojoSession(cycleId, cycle.name);
    const beltResult = this.beltComputer.compute();
    this.beltComputer.computeAgentConfidence();
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
   * Delegate bet outcome recording to the bridge-run syncer.
   * This is a thin delegation wrapper — the canonical implementation lives on BridgeRunSyncer.
   */
  recordBetOutcomes(cycleId: string, outcomes: BetOutcomeRecord[]): void {
    this.bridgeRunSyncer.recordBetOutcomes(cycleId, outcomes);
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
    // Stryker disable next-line ConditionalExpression: gates a warning message — presentation logic
    if (attempts.failed > 0) {
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
   * Delegate incomplete run checks to the bridge-run syncer.
   */
  checkIncompleteRuns(cycleId: string): IncompleteRunInfo[] {
    return this.bridgeRunSyncer.checkIncomplete(cycleId);
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
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
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
