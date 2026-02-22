import { join } from 'node:path';
import type { CycleManager, CooldownReport } from '@domain/services/cycle-manager.js';
import type { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { TokenTracker } from '@infra/tracking/token-tracker.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { BudgetAlertLevel } from '@domain/types/cycle.js';
import { CycleSchema } from '@domain/types/cycle.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { ProposalGenerator, type CycleProposal } from './proposal-generator.js';

/**
 * Dependencies injected into CooldownSession for testability.
 */
export interface CooldownSessionDeps {
  cycleManager: CycleManager;
  knowledgeStore: KnowledgeStore;
  tokenTracker: TokenTracker;
  /** Directory where cycles are stored (same as CycleManager's basePath) */
  cyclesDir: string;
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
    // 1. Transition to cooldown state
    this.deps.cycleManager.updateState(cycleId, 'cooldown');

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

    // 6. Capture cooldown learnings
    const learningsCaptured = this.captureCooldownLearnings(report);

    // 7. Transition to complete
    this.deps.cycleManager.updateState(cycleId, 'complete');

    return {
      report,
      betOutcomes,
      proposals,
      learningsCaptured,
    };
  }

  /**
   * Apply bet outcomes to the cycle.
   * Reads the cycle, updates each bet's outcome/notes, and persists to disk.
   */
  recordBetOutcomes(cycleId: string, outcomes: BetOutcomeRecord[]): void {
    const cycle = this.deps.cycleManager.get(cycleId);

    for (const record of outcomes) {
      const bet = cycle.bets.find((b) => b.id === record.betId);
      if (bet) {
        bet.outcome = record.outcome;
        if (record.notes) {
          bet.outcomeNotes = record.notes;
        }
      }
    }

    cycle.updatedAt = new Date().toISOString();
    const cyclePath = join(this.deps.cyclesDir, `${cycle.id}.json`);
    JsonStore.write(cyclePath, cycle, CycleSchema);
  }

  /**
   * Enhance the basic cooldown report with actual token usage data.
   * Uses the TokenTracker to sum up real token consumption from pipeline executions.
   */
  enrichReportWithTokens(report: CooldownReport, cycleId: string): CooldownReport {
    const totalUsage = this.deps.tokenTracker.getTotalUsage();

    // Also load history entries for this cycle to get per-pipeline usage
    const historyEntries = this.loadCycleHistory(cycleId);
    const cycleTokens = historyEntries.reduce((sum, entry) => {
      return sum + (entry.tokenUsage?.total ?? 0);
    }, 0);

    // Use cycle-specific tokens if available, otherwise fall back to total tracker
    const tokensUsed = cycleTokens > 0 ? cycleTokens : totalUsage;

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

    // Capture a learning if completion rate is notably low
    if (report.bets.length > 0 && report.completionRate < 50) {
      this.deps.knowledgeStore.capture({
        tier: 'category',
        category: 'cycle-management',
        content: `Cycle "${report.cycleName ?? report.cycleId}" had low completion rate (${report.completionRate.toFixed(1)}%). Consider reducing scope or breaking bets into smaller chunks.`,
        confidence: 0.6,
        evidence: [
          {
            pipelineId: report.cycleId,
            stageType: 'cooldown',
            observation: `${report.bets.length} bets, ${report.completionRate.toFixed(1)}% completion`,
            recordedAt: new Date().toISOString(),
          },
        ],
      });
      captured++;
    }

    // Capture a learning if budget was significantly over/under-utilized
    if (report.budget.tokenBudget) {
      if (report.utilizationPercent > 100) {
        this.deps.knowledgeStore.capture({
          tier: 'category',
          category: 'budget-management',
          content: `Cycle "${report.cycleName ?? report.cycleId}" exceeded token budget (${report.utilizationPercent.toFixed(1)}% utilization). Consider more conservative estimates.`,
          confidence: 0.7,
          evidence: [
            {
              pipelineId: report.cycleId,
              stageType: 'cooldown',
              observation: `${report.tokensUsed} tokens used of ${report.budget.tokenBudget} budget`,
              recordedAt: new Date().toISOString(),
            },
          ],
        });
        captured++;
      } else if (report.utilizationPercent < 30 && report.bets.length > 0) {
        this.deps.knowledgeStore.capture({
          tier: 'category',
          category: 'budget-management',
          content: `Cycle "${report.cycleName ?? report.cycleId}" significantly under-utilized token budget (${report.utilizationPercent.toFixed(1)}%). Could have taken on more work.`,
          confidence: 0.5,
          evidence: [
            {
              pipelineId: report.cycleId,
              stageType: 'cooldown',
              observation: `${report.tokensUsed} tokens used of ${report.budget.tokenBudget} budget`,
              recordedAt: new Date().toISOString(),
            },
          ],
        });
        captured++;
      }
    }

    return captured;
  }

  /**
   * Load execution history entries associated with this cycle.
   */
  private loadCycleHistory(cycleId: string): ExecutionHistoryEntry[] {
    const allEntries = JsonStore.list(this.deps.historyDir, ExecutionHistoryEntrySchema);
    return allEntries.filter((entry) => entry.cycleId === cycleId);
  }
}
