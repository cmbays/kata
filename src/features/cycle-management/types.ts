import type { StageCategory } from '@domain/types/stage.js';

/**
 * Per-stage detail captured during a run for cross-run analysis.
 */
export interface StageDetail {
  category: StageCategory;
  selectedFlavors: string[];
  gaps: Array<{ description: string; severity: 'low' | 'medium' | 'high' }>;
}

/**
 * Review record for a single rule suggestion during cooldown.
 */
export interface SuggestionReviewRecord {
  id: string;
  decision: 'accepted' | 'rejected' | 'deferred';
  rejectionReason?: string;
}

/**
 * Summary of a single run's execution data for cooldown analysis.
 * Loaded from .kata/runs/<run-id>/ state files by CooldownSession.loadRunSummaries().
 * Shared between CooldownSession (which loads it) and ProposalGenerator (which consumes it).
 */
export interface RunSummary {
  betId: string;
  runId: string;
  /** Number of stages that reached 'completed' status. */
  stagesCompleted: number;
  /** Total number of gaps found across all stages. */
  gapCount: number;
  /** Breakdown of gap counts by severity level. */
  gapsBySeverity: { low: number; medium: number; high: number };
  /**
   * Average confidence across all decisions recorded in the run.
   * null when no decisions were recorded — prevents false "low-confidence" proposals
   * for bets where the orchestrator made no explicit decisions.
   */
  avgConfidence: number | null;
  /** Relative file paths of all artifacts produced in the run. */
  artifactPaths: string[];
  /** Per-stage detail including selected flavors and gaps — used for cross-run analysis. */
  stageDetails: StageDetail[];
  /**
   * Number of decisions that bypassed a confidence gate via --yolo in this run.
   * Populated from DecisionEntry.lowConfidence === true.
   */
  yoloDecisionCount: number;
}
