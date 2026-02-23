import type { StageCategory } from '@domain/types/stage.js';
import type { Decision, DecisionType, DecisionOutcome } from '@domain/types/decision.js';

/**
 * Filter parameters for listing decisions.
 * All fields are optional — omitting a field means "no filter on that dimension".
 */
export interface DecisionQuery {
  stageCategory?: StageCategory;
  decisionType?: DecisionType;
  /** Minimum confidence (inclusive). */
  confidenceMin?: number;
  /** Maximum confidence (inclusive). */
  confidenceMax?: number;
  /** ISO 8601 lower bound on decidedAt (inclusive). */
  from?: string;
  /** ISO 8601 upper bound on decidedAt (inclusive). */
  to?: string;
}

/**
 * Aggregate statistics for a set of decisions.
 * Primarily used by the self-improvement loop to assess decision quality over time.
 */
export interface DecisionStats {
  /** Total number of decisions in the set. */
  count: number;
  /** Average confidence across all decisions in the set. 0 if count is 0. */
  avgConfidence: number;
  /** Per-type decision counts. Types with no decisions are omitted. */
  countByType: Partial<Record<DecisionType, number>>;
  /** Distribution of outcomes for decisions that have an outcome recorded. */
  outcomeDistribution: {
    good: number;
    partial: number;
    poor: number;
    /** Decisions where outcome has not yet been recorded. */
    noOutcome: number;
  };
}

export interface IDecisionRegistry {
  /**
   * Record a new decision. Generates a UUID and assigns it as the decision id.
   * Persists to disk and adds to the in-memory cache.
   * @returns The persisted Decision with the generated id.
   * @throws KataError if the file cannot be written.
   */
  record(input: Omit<Decision, 'id'>): Decision;

  /**
   * Retrieve a decision by its id.
   * @throws DecisionNotFoundError if no decision with that id exists.
   */
  get(id: string): Decision;

  /**
   * List decisions, optionally filtered.
   * Results are sorted by decidedAt ascending (oldest first).
   */
  list(filters?: DecisionQuery): Decision[];

  /**
   * Fill in the post-facto outcome for a decision.
   * Merges the new outcome with any existing outcome fields.
   * @throws DecisionNotFoundError if no decision with that id exists.
   * @throws KataError if the file cannot be written.
   */
  updateOutcome(id: string, outcome: DecisionOutcome): Decision;

  /**
   * Compute aggregate statistics for decisions matching the optional stageCategory filter.
   * When stageCategory is omitted, stats cover all decisions.
   */
  getStats(stageCategory?: StageCategory): DecisionStats;
}
