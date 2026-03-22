import type { CooldownReport } from '@domain/services/cycle-manager.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import type { BeltComputeResult } from '@features/belt/belt-calculator.js';
import type { CycleProposal } from './proposal-generator.js';
import type { NextKeikoResult } from './next-keiko-proposal-generator.js';
import type { RunSummary } from './types.js';

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
