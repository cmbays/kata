import type { StageCategory, Stage } from '@domain/types/stage.js';
import type { FlavorHint } from '@domain/types/saved-kata.js';
import type { ReflectionResult } from '@domain/types/orchestration.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type { IFlavorExecutor, OrchestratorContext, OrchestratorResult } from '@domain/ports/stage-orchestrator.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type { IMetaOrchestrator, PipelineOrchestrationResult } from '@domain/ports/meta-orchestrator.js';
import { createStageOrchestrator } from './orchestrators/index.js';
import { OrchestratorError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';

export interface MetaOrchestratorDeps {
  flavorRegistry: IFlavorRegistry;
  decisionRegistry: IDecisionRegistry;
  executor: IFlavorExecutor;
  ruleRegistry?: IStageRuleRegistry;
}

/**
 * Meta-Orchestrator — runs a linear sequence of stages with artifact handoff.
 *
 * For each stage in the sequence:
 * 1. Builds a Stage object from the FlavorRegistry
 * 2. Builds an OrchestratorContext with artifacts from previous stages
 * 3. Creates and runs a Stage Orchestrator
 * 4. Collects stage artifacts for the next stage
 *
 * After all stages complete, runs a pipeline-level reflect phase.
 */
export class MetaOrchestrator implements IMetaOrchestrator {
  constructor(private readonly deps: MetaOrchestratorDeps) {}

  async runPipeline(
    categories: StageCategory[],
    bet?: Record<string, unknown>,
    options?: { yolo?: boolean; flavorHints?: Record<string, FlavorHint>; katakaId?: string },
  ): Promise<PipelineOrchestrationResult> {
    if (categories.length === 0) {
      throw new OrchestratorError(
        'MetaOrchestrator: cannot run an empty pipeline. Provide at least one stage category.',
      );
    }

    const stageResults: OrchestratorResult[] = [];
    const accumulatedArtifacts: string[] = [];

    for (const category of categories) {
      logger.info(`MetaOrchestrator: starting stage "${category}"`, {
        category,
        artifactsFromPriorStages: accumulatedArtifacts.length,
      });

      // Build the Stage object from available flavors in the registry
      const availableFlavors = this.deps.flavorRegistry
        .list(category)
        .map((f) => f.name);

      if (availableFlavors.length === 0) {
        throw new OrchestratorError(
          `MetaOrchestrator: no flavors registered for category "${category}". ` +
            `Ensure flavors are loaded before running the pipeline.`,
        );
      }

      const stage: Stage = {
        category,
        orchestrator: {
          type: category,
          confidenceThreshold: options?.yolo ? 0 : 0.7,
          maxParallelFlavors: 3,
        },
        availableFlavors,
      };

      // Build context with artifacts from prior stages
      const flavorHint = options?.flavorHints?.[category];
      const context: OrchestratorContext = {
        availableArtifacts: [...accumulatedArtifacts],
        bet,
        learnings: [],
        flavorHint,
        activeKatakaId: options?.katakaId,
      };

      // Create and run the stage orchestrator
      const orchestrator = createStageOrchestrator(
        category,
        {
          flavorRegistry: this.deps.flavorRegistry,
          decisionRegistry: this.deps.decisionRegistry,
          executor: this.deps.executor,
          ruleRegistry: this.deps.ruleRegistry,
        },
        stage.orchestrator,
      );

      const result = await orchestrator.run(stage, context);
      stageResults.push(result);

      // Add this stage's artifact to the accumulated set for the next stage
      accumulatedArtifacts.push(result.stageArtifact.name);

      logger.info(`MetaOrchestrator: completed stage "${category}"`, {
        category,
        selectedFlavors: result.selectedFlavors,
        executionMode: result.executionMode,
        artifactName: result.stageArtifact.name,
      });
    }

    // Pipeline-level reflect phase
    const pipelineReflection = this.reflectPipeline(stageResults);

    return { stageResults, pipelineReflection };
  }

  /**
   * Pipeline-level reflection: aggregate outcomes across all stages.
   */
  private reflectPipeline(stageResults: OrchestratorResult[]): ReflectionResult {
    const allGood = stageResults.every((r) => r.reflection?.overallQuality === 'good');
    const anyPoor = stageResults.some((r) => r.reflection?.overallQuality === 'poor');

    const overallQuality = allGood ? 'good' : anyPoor ? 'poor' : 'partial';

    // Aggregate decision outcomes from all stages
    const decisionOutcomes = stageResults.flatMap(
      (r) => r.reflection?.decisionOutcomes ?? [],
    );

    // Aggregate learnings from all stages
    const learnings = [
      `Pipeline completed ${stageResults.length} stage(s): ${stageResults.map((r) => r.stageCategory).join(' → ')}.`,
      ...stageResults.flatMap((r) => r.reflection?.learnings ?? []),
    ];

    // Aggregate rule suggestions from all stages
    const ruleSuggestions = stageResults.flatMap(
      (r) => r.reflection?.ruleSuggestions ?? [],
    );

    return {
      decisionOutcomes,
      learnings,
      ruleSuggestions,
      overallQuality,
    };
  }
}
