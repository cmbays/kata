import type { StageCategory } from '@domain/types/stage.js';
import type { FlavorHint } from '@domain/types/saved-kata.js';
import type { OrchestratorResult } from './stage-orchestrator.js';
import type { ReflectionResult } from '@domain/types/orchestration.js';

/**
 * Result of running a multi-stage pipeline through the meta-orchestrator.
 */
export interface PipelineOrchestrationResult {
  /** Ordered list of stage results, one per stage in the pipeline. */
  readonly stageResults: OrchestratorResult[];
  /** Pipeline-level reflection result produced after all stages complete. */
  readonly pipelineReflection: ReflectionResult;
}

/**
 * The Meta-Orchestrator — pipeline-level stage sequencing with artifact handoff.
 *
 * Takes a linear sequence of stage categories, runs each through the stage
 * orchestrator, and passes stage artifacts forward as `availableArtifacts`
 * to subsequent stages. Runs an automatic pipeline-level reflect phase
 * after all stages complete.
 *
 * Coexists with the existing PipelineRunner — this provides intelligent
 * orchestrated execution while PipelineRunner handles legacy linear pipelines.
 */
export interface IMetaOrchestrator {
  /**
   * Run a sequence of stages, passing artifacts forward between stages.
   *
   * @param categories — Ordered list of stage categories to execute.
   * @param bet — Optional bet context passed to all stages.
   * @param options — Pipeline-level execution options.
   * @returns Full pipeline result with per-stage results and pipeline-level reflection.
   * @throws OrchestratorError if any stage fails.
   */
  runPipeline(
    categories: StageCategory[],
    bet?: Record<string, unknown>,
    options?: { yolo?: boolean; flavorHints?: Record<string, FlavorHint>; katakaId?: string },
  ): Promise<PipelineOrchestrationResult>;
}
