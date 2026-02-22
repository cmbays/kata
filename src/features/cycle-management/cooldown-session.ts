import type { CycleManager, CooldownReport } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IPersistence } from '@domain/ports/persistence.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { BudgetAlertLevel } from '@domain/types/cycle.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { logger } from '@shared/lib/logger.js';
import { ProposalGenerator, type CycleProposal } from './proposal-generator.js';

/**
 * Dependencies injected into CooldownSession for testability.
 */
export interface CooldownSessionDeps {
  cycleManager: CycleManager;
  knowledgeStore: IKnowledgeStore;
  persistence: IPersistence;
  pipelineDir: string;
  historyDir: string;
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
  private readonly proposalGenerator: ProposalGenerator;

  constructor(deps: CooldownSessionDeps) {
    this.deps = deps;
    this.proposalGenerator = new ProposalGenerator({
      cycleManager: deps.cycleManager,
      knowledgeStore: deps.knowledgeStore,
      persistence: deps.persistence,
      pipelineDir: deps.pipelineDir,
      historyDir: deps.historyDir,
    });
  }

  /**
   * Run the full cooldown session.
   *
   * 1. Transition cycle state to 'cooldown'
   * 2. Record per-bet outcomes (data collection, not interactive -- CLI handles prompts)
   * 3. Generate the CooldownReport via CycleManager
   * 4. Enrich report with actual token usage from TokenTracker
   * 5. Generate next-cycle proposals via ProposalGenerator
   * 6. Capture any learnings from the cooldown analysis
   * 7. Transition cycle state to 'complete'
   * 8. Return the full session result
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

      // 5. Generate next-cycle proposals
      const proposals = this.proposalGenerator.generate(cycleId);

      // 6. Capture cooldown learnings (non-critical — errors should not abort)
      const learningsCaptured = this.captureCooldownLearnings(report);

      // 7. Transition to complete
      this.deps.cycleManager.updateState(cycleId, 'complete');

      return {
        report,
        betOutcomes,
        proposals,
        learningsCaptured,
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
   * Load execution history entries associated with this cycle.
   */
  private loadCycleHistory(cycleId: string): ExecutionHistoryEntry[] {
    const allEntries = this.deps.persistence.list(this.deps.historyDir, ExecutionHistoryEntrySchema);
    return allEntries.filter((entry) => entry.cycleId === cycleId);
  }
}
