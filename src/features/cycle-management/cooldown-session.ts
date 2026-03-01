import { join } from 'node:path';
import type { CycleManager, CooldownReport } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IPersistence } from '@domain/ports/persistence.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { BudgetAlertLevel, Cycle } from '@domain/types/cycle.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { DiaryWriter } from '@features/dojo/diary-writer.js';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import { logger } from '@shared/lib/logger.js';
import { loadRunSummary } from './run-summary-loader.js';
import { ProposalGenerator, type CycleProposal, type ProposalGeneratorDeps } from './proposal-generator.js';
import type { RunSummary } from './types.js';
import { PredictionMatcher } from '@features/self-improvement/prediction-matcher.js';
import { HierarchicalPromoter } from '@infra/knowledge/hierarchical-promoter.js';

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
}

/**
 * Record of a bet's outcome after cooldown review.
 */
export interface BetOutcomeRecord {
  betId: string;
  outcome: 'complete' | 'partial' | 'abandoned';
  notes?: string;
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
  private readonly hierarchicalPromoter: Pick<HierarchicalPromoter, 'promoteStepToFlavor' | 'promoteFlavorToStage' | 'promoteStageToCategory'>;

  constructor(deps: CooldownSessionDeps) {
    this.deps = deps;
    const generatorDeps: ProposalGeneratorDeps = {
      cycleManager: deps.cycleManager,
      knowledgeStore: deps.knowledgeStore,
      persistence: deps.persistence,
      pipelineDir: deps.pipelineDir,
    };
    this.proposalGenerator = deps.proposalGenerator ?? new ProposalGenerator(generatorDeps);
    this.predictionMatcher = deps.predictionMatcher ?? (deps.runsDir ? new PredictionMatcher(deps.runsDir) : null);
    this.hierarchicalPromoter = deps.hierarchicalPromoter ?? new HierarchicalPromoter(deps.knowledgeStore);
  }

  /**
   * Run the full cooldown session.
   *
   * 1. Transition cycle state to 'cooldown'
   * 2. Record per-bet outcomes (data collection, not interactive -- CLI handles prompts)
   * 3. Generate the CooldownReport via CycleManager
   * 4. Enrich report with actual token usage from TokenTracker
   * 5. Load run summaries when runsDir provided
   * 6. Generate next-cycle proposals via ProposalGenerator
   * 7. Load pending rule suggestions when ruleRegistry provided
   * 8. Capture any learnings from the cooldown analysis
   * 9. Transition cycle state to 'complete'
   * 10. Return the full session result
   */
  async run(cycleId: string, betOutcomes: BetOutcomeRecord[] = []): Promise<CooldownSessionResult> {
    // Save previous state for rollback on failure
    const previousState = this.deps.cycleManager.get(cycleId).state;

    // 1. Transition to cooldown state
    this.deps.cycleManager.updateState(cycleId, 'cooldown');

    try {
      // 2. Record bet outcomes if provided
      if (betOutcomes.length > 0) {
        this.recordBetOutcomes(cycleId, betOutcomes);
      }

      // 3. Generate the base cooldown report
      let report = this.deps.cycleManager.generateCooldown(cycleId);

      // 4. Enrich with actual token usage
      report = this.enrichReportWithTokens(report, cycleId);

      // 5. Load run summaries when runsDir provided (enrich proposals)
      const cycle = this.deps.cycleManager.get(cycleId);
      const runSummaries = this.deps.runsDir
        ? this.loadRunSummaries(cycle)
        : undefined;

      // 6. Generate next-cycle proposals (enriched with run data when available)
      const proposals = this.proposalGenerator.generate(cycleId, runSummaries);

      // 7. Load pending rule suggestions (non-critical — errors must not abort a completed cooldown)
      let ruleSuggestions: RuleSuggestion[] | undefined;
      if (this.deps.ruleRegistry) {
        try {
          ruleSuggestions = this.deps.ruleRegistry.getPendingSuggestions();
        } catch (err) {
          logger.warn(`Failed to load rule suggestions: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // 8. Capture cooldown learnings (non-critical — errors should not abort)
      const learningsCaptured = this.captureCooldownLearnings(report);

      // 8a. Match cycle predictions to outcomes (non-critical)
      this.runPredictionMatching(cycle);

      // 8b. Bubble step-tier learnings up the hierarchy (non-critical)
      this.runHierarchicalPromotion();

      // 8c. Scan for expired/stale learnings (non-critical)
      this.runExpiryCheck();

      // 8.5. Write dojo diary entry (non-critical — failure never aborts cooldown)
      if (this.deps.dojoDir) {
        const effectiveBetOutcomes: BetOutcomeRecord[] = betOutcomes.length > 0
          ? betOutcomes
          : cycle.bets
              .filter((b) => b.outcome !== 'pending')
              .map((b) => ({ betId: b.id, outcome: b.outcome as BetOutcomeRecord['outcome'], notes: b.outcomeNotes }));
        this.writeDiaryEntry({
          cycleId,
          cycleName: cycle.name,
          betOutcomes: effectiveBetOutcomes,
          proposals,
          runSummaries,
          learningsCaptured,
          ruleSuggestions,
        });
      }

      // 9. Transition to complete
      this.deps.cycleManager.updateState(cycleId, 'complete');

      return {
        report,
        betOutcomes,
        proposals,
        learningsCaptured,
        runSummaries,
        ruleSuggestions,
      };
    } catch (error) {
      // Attempt to roll back to previous state so the user can retry
      try {
        this.deps.cycleManager.updateState(cycleId, previousState);
      } catch (rollbackError) {
        logger.error(`Failed to roll back cycle "${cycleId}" from cooldown to "${previousState}". Manual intervention may be required.`, {
          rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        });
      }
      throw error;
    }
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
    const tokenBudget = report.budget.tokenBudget;
    const utilizationPercent = tokenBudget && tokenBudget > 0
      ? (tokensUsed / tokenBudget) * 100
      : 0;

    // Determine alert level
    let alertLevel: BudgetAlertLevel | undefined = report.alertLevel;
    if (tokenBudget) {
      if (utilizationPercent >= 100) {
        alertLevel = 'critical';
      } else if (utilizationPercent >= 90) {
        alertLevel = 'warning';
      } else if (utilizationPercent >= 75) {
        alertLevel = 'info';
      } else {
        alertLevel = undefined;
      }
    }

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
    let captured = 0;
    let failed = 0;

    // Capture a learning if completion rate is notably low
    if (report.bets.length > 0 && report.completionRate < 50) {
      if (this.safeCaptureLearning({
        tier: 'category',
        category: 'cycle-management',
        content: `Cycle "${report.cycleName ?? report.cycleId}" had low completion rate (${report.completionRate.toFixed(1)}%). Consider reducing scope or breaking bets into smaller chunks.`,
        confidence: 0.6,
        evidence: [{
          pipelineId: report.cycleId,
          stageType: 'cooldown',
          observation: `${report.bets.length} bets, ${report.completionRate.toFixed(1)}% completion`,
          recordedAt: new Date().toISOString(),
        }],
      })) {
        captured++;
      } else {
        failed++;
      }
    }

    // Capture a learning if budget was significantly over/under-utilized
    if (report.budget.tokenBudget) {
      if (report.utilizationPercent > 100) {
        if (this.safeCaptureLearning({
          tier: 'category',
          category: 'budget-management',
          content: `Cycle "${report.cycleName ?? report.cycleId}" exceeded token budget (${report.utilizationPercent.toFixed(1)}% utilization). Consider more conservative estimates.`,
          confidence: 0.7,
          evidence: [{
            pipelineId: report.cycleId,
            stageType: 'cooldown',
            observation: `${report.tokensUsed} tokens used of ${report.budget.tokenBudget} budget`,
            recordedAt: new Date().toISOString(),
          }],
        })) {
          captured++;
        } else {
          failed++;
        }
      } else if (report.utilizationPercent < 30 && report.bets.length > 0) {
        if (this.safeCaptureLearning({
          tier: 'category',
          category: 'budget-management',
          content: `Cycle "${report.cycleName ?? report.cycleId}" significantly under-utilized token budget (${report.utilizationPercent.toFixed(1)}%). Could have taken on more work.`,
          confidence: 0.5,
          evidence: [{
            pipelineId: report.cycleId,
            stageType: 'cooldown',
            observation: `${report.tokensUsed} tokens used of ${report.budget.tokenBudget} budget`,
            recordedAt: new Date().toISOString(),
          }],
        })) {
          captured++;
        } else {
          failed++;
        }
      }
    }

    if (failed > 0) {
      logger.warn(`${failed} of ${captured + failed} cooldown learnings failed to capture. Check previous warnings for details.`);
    }

    return captured;
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
   */
  private loadCycleHistory(cycleId: string): ExecutionHistoryEntry[] {
    const allEntries = this.deps.persistence.list(this.deps.historyDir, ExecutionHistoryEntrySchema);
    return allEntries.filter((entry) => entry.cycleId === cycleId);
  }

  /**
   * For each bet with a runId, run PredictionMatcher to match predictions to outcomes.
   * Writes validation/unmatched reflections to the run's JSONL file.
   * No-op when runsDir is absent or no prediction matcher is available.
   */
  private runPredictionMatching(cycle: Cycle): void {
    if (!this.predictionMatcher) return;

    for (const bet of cycle.bets) {
      if (!bet.runId) continue;
      try {
        this.predictionMatcher.match(bet.runId);
      } catch (err) {
        logger.warn(`Prediction matching failed for run ${bet.runId}: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      if (typeof this.deps.knowledgeStore.checkExpiry !== 'function') return;
      const { archived, flaggedStale } = this.deps.knowledgeStore.checkExpiry();
      if (archived.length > 0) {
        logger.debug(`Expiry check: auto-archived ${archived.length} expired operational learnings`);
      }
      if (flaggedStale.length > 0) {
        logger.debug(`Expiry check: flagged ${flaggedStale.length} stale strategic learnings for review`);
      }
    } catch (err) {
      logger.warn(`Learning expiry check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private writeDiaryEntry(input: {
    cycleId: string;
    cycleName?: string;
    betOutcomes: BetOutcomeRecord[];
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    learningsCaptured: number;
    ruleSuggestions?: RuleSuggestion[];
  }): void {
    try {
      const diaryDir = join(this.deps.dojoDir!, 'diary');
      const store = new DiaryStore(diaryDir);
      const writer = new DiaryWriter(store);
      writer.write(input);
    } catch (err) {
      logger.warn(`Failed to write dojo diary entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
