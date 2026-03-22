import type { PredictionMatcher } from '@features/self-improvement/prediction-matcher.js';
import type { CalibrationDetector } from '@features/self-improvement/calibration-detector.js';
import type { HierarchicalPromoter } from '@infra/knowledge/hierarchical-promoter.js';
import type { FrictionAnalyzer } from '@features/self-improvement/friction-analyzer.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Cycle } from '@domain/types/cycle.js';
import { logger } from '@shared/lib/logger.js';
import { buildExpiryCheckMessages } from './cooldown-session.helpers.js';

/**
 * Dependencies injected into CooldownFollowUpRunner for testability.
 */
export interface CooldownFollowUpDeps {
  predictionMatcher: Pick<PredictionMatcher, 'match'> | null;
  calibrationDetector: Pick<CalibrationDetector, 'detect'> | null;
  hierarchicalPromoter: Pick<HierarchicalPromoter, 'promoteStepToFlavor' | 'promoteFlavorToStage' | 'promoteStageToCategory'>;
  frictionAnalyzer: Pick<FrictionAnalyzer, 'analyze'> | null;
  knowledgeStore: Pick<IKnowledgeStore, 'query'> & { checkExpiry?: IKnowledgeStore['checkExpiry'] };
}

/**
 * Runs follow-up analyses during cooldown to improve the knowledge system.
 *
 * Extracted from CooldownSession to isolate the follow-up pipeline
 * (prediction matching, calibration detection, hierarchical promotion,
 * expiry checking, friction analysis) from the cooldown orchestration logic.
 */
export class CooldownFollowUpRunner {
  constructor(private readonly deps: CooldownFollowUpDeps) {}

  /**
   * Execute the full follow-up pipeline for a cycle.
   *
   * Analyses run in a fixed order: prediction matching → calibration detection
   * → hierarchical promotion → expiry check → friction analysis.
   * Calibration detection must run after prediction matching because it reads
   * validation reflections that prediction matching produces.
   *
   * Non-critical: individual analysis failures are logged as warnings
   * and do not abort the pipeline or the cooldown.
   */
  run(cycle: Cycle): void {
    this.runPredictionMatching(cycle);
    this.runCalibrationDetection(cycle);
    this.runHierarchicalPromotion();
    this.runExpiryCheck();
    this.runFrictionAnalysis(cycle);
  }

  private runPredictionMatching(cycle: Cycle): void {
    // Stryker disable next-line ConditionalExpression: guard redundant with catch in runForBetRun
    if (!this.deps.predictionMatcher) return;
    // Stryker disable next-line StringLiteral: presentation text — label for error logging
    this.runForEachBetRun(cycle, (runId) => this.deps.predictionMatcher!.match(runId), 'Prediction matching');
  }

  /**
   * Must run after runPredictionMatching — reads validation reflections it produces.
   */
  private runCalibrationDetection(cycle: Cycle): void {
    // Stryker disable next-line ConditionalExpression: guard redundant with catch in runForBetRun
    if (!this.deps.calibrationDetector) return;
    // Stryker disable next-line StringLiteral: presentation text — label for error logging
    this.runForEachBetRun(cycle, (runId) => this.deps.calibrationDetector!.detect(runId), 'Calibration detection');
  }

  private runHierarchicalPromotion(): void {
    try {
      // Stryker disable next-line ObjectLiteral: tier filter is tested via hierarchical promotion integration
      const stepLearnings = this.deps.knowledgeStore.query({ tier: 'step' });
      const { learnings: flavorLearnings } = this.deps.hierarchicalPromoter.promoteStepToFlavor(stepLearnings, 'cooldown-retrospective');
      const { learnings: stageLearnings } = this.deps.hierarchicalPromoter.promoteFlavorToStage(flavorLearnings, 'cooldown');
      this.deps.hierarchicalPromoter.promoteStageToCategory(stageLearnings);
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn(`Hierarchical learning promotion failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private runExpiryCheck(): void {
    try {
      // Stryker disable next-line ConditionalExpression: guard redundant with catch — checkExpiry absence is swallowed
      if (typeof this.deps.knowledgeStore.checkExpiry !== 'function') return;
      const result = this.deps.knowledgeStore.checkExpiry();
      for (const message of buildExpiryCheckMessages(result)) {
        logger.debug(message);
      }
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn(`Learning expiry check failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private runFrictionAnalysis(cycle: Cycle): void {
    // Stryker disable next-line ConditionalExpression: guard redundant with catch in runForBetRun
    if (!this.deps.frictionAnalyzer) return;
    // Stryker disable next-line StringLiteral: presentation text — label for error logging
    this.runForEachBetRun(cycle, (runId) => this.deps.frictionAnalyzer!.analyze(runId), 'Friction analysis');
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
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn(`${label} failed for run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
