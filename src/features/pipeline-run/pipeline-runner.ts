import type { Pipeline } from '@domain/types/pipeline.js';
import type { KataConfig } from '@domain/types/config.js';
import type { Gate, GateResult } from '@domain/types/gate.js';
import type { Step } from '@domain/types/step.js';
import type { Learning } from '@domain/types/learning.js';
import type { IStepRegistry } from '@domain/ports/step-registry.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IAdapterResolver } from '@domain/ports/adapter-resolver.js';
import type { ITokenTracker } from '@domain/ports/token-tracker.js';
import type { IResultCapturer } from '@domain/ports/result-capturer.js';
import type { IRefResolver } from '@domain/ports/ref-resolver.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import { evaluateGate, type GateEvalContext } from './gate-evaluator.js';
import { RefResolutionError } from '@infra/config/ref-resolver.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Dependencies injected into the pipeline runner for testability.
 */
export interface PipelineRunnerDeps {
  stageRegistry: IStepRegistry;
  knowledgeStore: IKnowledgeStore;
  adapterResolver: IAdapterResolver;
  resultCapturer: IResultCapturer;
  tokenTracker: ITokenTracker;
  manifestBuilder: typeof ManifestBuilder;
  /** Persist an updated pipeline snapshot to storage. */
  persistPipeline: (pipeline: Pipeline) => void;
  /**
   * Directory where stages are stored — used to resolve relative prompt template
   * paths (e.g. "../prompts/research.md") before building the manifest.
   */
  stagesDir?: string;
  /** Resolves $ref-style prompt template file paths to their contents. */
  refResolver?: IRefResolver;
  /**
   * When true, all gate checks are bypassed ("yolo mode").
   * Useful for testing pipelines without waiting on human approvals or artifact gates.
   */
  yolo?: boolean;
  /** Optional prompt function for interactive overrides */
  promptFn?: {
    gateOverride: (gateResult: GateResult) => Promise<'retry' | 'skip' | 'abort'>;
    captureLearning: (stageType: string) => Promise<string | null>;
  };
  /** Optional lifecycle hooks — errors are swallowed and logged as warnings */
  hooks?: {
    onStageStart?: (stageType: string, stageIndex: number) => Promise<void>;
    onStageComplete?: (stageType: string, stageIndex: number) => Promise<void>;
    /**
     * Fires only on uncaught exceptions from the stage body. Gate aborts fire
     * onGateResult with action 'abort' and do NOT fire onStageFail, even though
     * the stage ends in state 'failed'.
     */
    onStageFail?: (stageType: string, stageIndex: number, error: unknown) => Promise<void>;
    onGateResult?: (
      gate: Gate,
      result: GateResult,
      action: 'proceed' | 'skip' | 'abort',
    ) => Promise<void>;
  };
}

/**
 * Result of running a pipeline.
 */
export interface PipelineResult {
  pipelineId: string;
  success: boolean;
  stagesCompleted: number;
  stagesTotal: number;
  /** History entry IDs for each completed stage */
  historyIds: string[];
  abortedAt?: number;
}

/**
 * Pipeline Runner — the core orchestration loop.
 *
 * Traverses each stage in a pipeline sequentially:
 * 1. Get stage definition from registry
 * 2. Evaluate entry gate
 * 3. Load learnings (Tier 1 + Tier 2)
 * 4. Resolve prompt template ref (if stagesDir + refResolver provided)
 * 5. Build execution manifest
 * 6. Resolve and execute adapter
 * 7. Capture result to history
 * 8. Record token usage
 * 9. Evaluate exit gate
 * 10. Optionally capture learnings
 * 11. Update pipeline state
 * 12. Persist pipeline
 */
export class PipelineRunner {
  constructor(private readonly deps: PipelineRunnerDeps) {}

  /**
   * Run the pipeline from its current stage index to completion.
   */
  async run(pipeline: Pipeline, config?: KataConfig): Promise<PipelineResult> {
    const historyIds: string[] = [];
    let stagesCompleted = 0;
    let abortedAt: number | undefined;

    if (this.deps.yolo) {
      logger.warn('YOLO mode enabled — all gate checks are bypassed. Use only in non-production environments.');
    }

    // Mark pipeline as active
    pipeline.state = 'active';
    pipeline.updatedAt = new Date().toISOString();
    this.persistPipeline(pipeline);

    for (let i = pipeline.currentStageIndex; i < pipeline.stages.length; i++) {
      const stageState = pipeline.stages[i];
      if (!stageState) continue;

      try {
        // Get stage definition
        const stageDef = this.deps.stageRegistry.get(
          stageState.stageRef.type,
          stageState.stageRef.flavor,
        );

        // Mark stage as active
        stageState.state = 'active';
        stageState.startedAt = new Date().toISOString();
        pipeline.currentStageIndex = i;
        pipeline.updatedAt = new Date().toISOString();
        this.persistPipeline(pipeline);
        await this.fireHook('onStageStart', () => this.deps.hooks?.onStageStart?.(stageState.stageRef.type, i));

        // Build gate evaluation context
        const gateContext = this.buildGateContext(pipeline, i);

        // Evaluate entry gate (with retry support)
        let gateAction: 'proceed' | 'skip' | 'abort' = 'proceed';
        if (stageDef.entryGate) {
          gateAction = await this.evaluateGateWithRetry(stageDef.entryGate, gateContext);
        }

        if (gateAction === 'skip') {
          stageState.state = 'skipped';
          stageState.completedAt = new Date().toISOString();
          pipeline.updatedAt = new Date().toISOString();
          this.persistPipeline(pipeline);
          continue;
        }
        if (gateAction === 'abort') {
          stageState.state = 'failed';
          stageState.completedAt = new Date().toISOString();
          pipeline.state = 'abandoned';
          pipeline.updatedAt = new Date().toISOString();
          abortedAt = i;
          this.persistPipeline(pipeline);
          break;
        }

        // Load learnings: Tier 1 (stage-level) + Tier 2 (subscriptions)
        const learnings = this.loadLearnings(stageDef);

        // Resolve prompt template ref if provided (e.g. "../prompts/research.md" → file content)
        const resolvedStageDef = this.resolvePromptTemplate(stageDef);

        // Build execution manifest
        const manifest = this.deps.manifestBuilder.build(
          resolvedStageDef,
          {
            pipelineId: pipeline.id,
            stageIndex: i,
            metadata: pipeline.metadata as unknown as Record<string, unknown>,
          },
          learnings,
        );

        // Resolve adapter and execute
        const adapter = this.deps.adapterResolver.resolve(config);
        const result = await adapter.execute(manifest);

        // Capture result to history (also records token usage)
        const historyEntry = this.deps.resultCapturer.capture({
          pipelineId: pipeline.id,
          stageType: stageState.stageRef.type,
          stageFlavor: stageState.stageRef.flavor,
          stageIndex: i,
          adapterName: adapter.name,
          result,
          cycleId: pipeline.metadata.cycleId,
          betId: pipeline.metadata.betId,
        });
        historyIds.push(historyEntry.id);

        // Record token usage if available
        if (result.tokenUsage) {
          const stageKey = `${pipeline.id}:${i}`;
          this.deps.tokenTracker.recordUsage(stageKey, result.tokenUsage);
        }

        // Evaluate exit gate
        if (stageDef.exitGate) {
          const exitContext = this.buildGateContext(pipeline, i, result.artifacts.map((a) => a.name));
          const exitAction = await this.evaluateGateWithRetry(stageDef.exitGate, exitContext);
          if (exitAction === 'skip') {
            stageState.state = 'skipped';
            stageState.completedAt = new Date().toISOString();
            pipeline.updatedAt = new Date().toISOString();
            this.persistPipeline(pipeline);
            continue;
          }
          if (exitAction === 'abort') {
            stageState.state = 'failed';
            stageState.completedAt = new Date().toISOString();
            pipeline.state = 'abandoned';
            pipeline.updatedAt = new Date().toISOString();
            abortedAt = i;
            this.persistPipeline(pipeline);
            break;
          }
        }

        // Optionally capture learnings (non-critical — errors here should not abort)
        if (this.deps.promptFn?.captureLearning) {
          try {
            const learningContent = await this.deps.promptFn.captureLearning(stageState.stageRef.type);
            if (learningContent) {
              this.deps.knowledgeStore.capture({
                tier: 'stage',
                category: stageState.stageRef.type,
                content: learningContent,
                stageType: stageState.stageRef.type,
                confidence: 0.5,
                evidence: [
                  {
                    pipelineId: pipeline.id,
                    stageType: stageState.stageRef.type,
                    observation: learningContent,
                    recordedAt: new Date().toISOString(),
                  },
                ],
              });
            }
          } catch (err) {
            logger.warn('Learning capture failed — continuing pipeline', {
              stageType: stageState.stageRef.type,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Mark stage complete
        stageState.state = 'complete';
        stageState.completedAt = new Date().toISOString();

        // Record artifact results on the stage state
        if (result.artifacts.length > 0) {
          stageState.artifacts = result.artifacts.map((a) => ({
            name: a.name,
            path: a.path,
            producedAt: new Date().toISOString(),
          }));
        }

        stagesCompleted++;
        pipeline.updatedAt = new Date().toISOString();
        this.persistPipeline(pipeline);
        await this.fireHook('onStageComplete', () => this.deps.hooks?.onStageComplete?.(stageState.stageRef.type, i));
      } catch (error) {
        // Fatal error — mark stage and pipeline as failed, persist, and stop
        stageState.state = 'failed';
        stageState.completedAt = new Date().toISOString();
        pipeline.state = 'abandoned';
        pipeline.updatedAt = new Date().toISOString();
        // eslint-disable-next-line no-useless-assignment -- maintain invariant: all abandonment paths set abortedAt
        abortedAt = i;

        try {
          this.persistPipeline(pipeline);
        } catch (persistErr) {
          logger.error('Failed to persist abandoned pipeline state — file may be inconsistent', {
            pipelineId: pipeline.id,
            error: persistErr instanceof Error ? persistErr.message : String(persistErr),
          });
        }

        await this.fireHook('onStageFail', () =>
          this.deps.hooks?.onStageFail?.(stageState.stageRef.type, i, error),
        );
        throw error;
      }
    }

    // Determine final pipeline state
    if (abortedAt === undefined) {
      // Check if all stages are complete (or skipped)
      const allDone = pipeline.stages.every(
        (s) => s.state === 'complete' || s.state === 'skipped',
      );
      if (allDone) {
        pipeline.state = 'complete';
      }
    }

    pipeline.updatedAt = new Date().toISOString();
    this.persistPipeline(pipeline);

    return {
      pipelineId: pipeline.id,
      success: abortedAt === undefined,
      stagesCompleted,
      stagesTotal: pipeline.stages.length,
      historyIds,
      abortedAt,
    };
  }

  /**
   * If the stage has a promptTemplate that looks like a file reference and
   * stagesDir + refResolver are provided, resolve the file content and return
   * a new stage object with the resolved prompt. Otherwise returns the stage as-is.
   */
  private resolvePromptTemplate(stageDef: Step): Step {
    if (!stageDef.promptTemplate || !this.deps.stagesDir || !this.deps.refResolver) {
      return stageDef;
    }
    try {
      const resolvedPrompt = this.deps.manifestBuilder.resolveRefs(
        stageDef.promptTemplate,
        this.deps.stagesDir,
        this.deps.refResolver,
      );
      return { ...stageDef, promptTemplate: resolvedPrompt };
    } catch (err) {
      if (err instanceof RefResolutionError) {
        // File missing — use the template path as-is (adapter receives the path string).
        logger.warn(`Could not resolve prompt template "${stageDef.promptTemplate}": ${err.message}`);
        return stageDef;
      }
      throw err;
    }
  }

  /**
   * Build gate evaluation context from the pipeline's current state.
   */
  private buildGateContext(
    pipeline: Pipeline,
    currentIndex: number,
    additionalArtifacts?: string[],
  ): GateEvalContext {
    const completedStages: string[] = [];
    const availableArtifacts: string[] = [];

    for (let j = 0; j < currentIndex; j++) {
      const prev = pipeline.stages[j];
      if (!prev) continue;
      if (prev.state === 'complete') {
        completedStages.push(prev.stageRef.type);
        for (const artifact of prev.artifacts) {
          availableArtifacts.push(artifact.name);
        }
      }
    }

    if (additionalArtifacts) {
      availableArtifacts.push(...additionalArtifacts);
    }

    const currentStage = pipeline.stages[currentIndex];
    return {
      availableArtifacts,
      completedStages,
      // Human approval is set via `kata flow approve <pipeline-id>`, which
      // writes humanApprovedAt onto the PipelineStageState and persists it.
      humanApproved: currentStage?.humanApprovedAt != null,
    };
  }

  /**
   * Evaluate a gate, retrying up to MAX_GATE_RETRIES when the user selects 'retry'.
   * Returns 'proceed' if the gate passes, or the terminal action ('skip'/'abort').
   * If `yolo` is true, always returns 'proceed' without evaluating conditions.
   */
  private async evaluateGateWithRetry(
    gate: Gate,
    context: GateEvalContext,
  ): Promise<'proceed' | 'skip' | 'abort'> {
    if (this.deps.yolo) {
      logger.warn(`Gate bypassed (yolo mode): ${gate.type} gate with ${gate.conditions.length} condition(s)`);
      return 'proceed';
    }

    const MAX_RETRIES = 3;
    let lastResult: GateResult | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = await evaluateGate(gate, context);
      lastResult = result;

      if (result.passed) {
        await this.fireHook('onGateResult', () =>
          this.deps.hooks?.onGateResult?.(gate, result, 'proceed'),
        );
        return 'proceed';
      }

      const action = await this.handleGateFailure(result);
      if (action === 'skip') {
        await this.fireHook('onGateResult', () =>
          this.deps.hooks?.onGateResult?.(gate, result, 'skip'),
        );
        return 'skip';
      }
      if (action === 'abort') {
        await this.fireHook('onGateResult', () =>
          this.deps.hooks?.onGateResult?.(gate, result, 'abort'),
        );
        return 'abort';
      }
      // action === 'retry' — loop continues to re-evaluate
    }

    // Exhausted retries — fire hook with last result before aborting
    if (lastResult) {
      await this.fireHook('onGateResult', () =>
        this.deps.hooks?.onGateResult?.(gate, lastResult!, 'abort'),
      );
    }
    return 'abort';
  }

  /**
   * Handle a failed gate check — either via promptFn or default to abort.
   */
  private async handleGateFailure(gateResult: GateResult): Promise<'retry' | 'skip' | 'abort'> {
    if (this.deps.promptFn?.gateOverride) {
      return this.deps.promptFn.gateOverride(gateResult);
    }
    // Default behavior: abort on gate failure
    return 'abort';
  }

  /**
   * Load Tier 1 and Tier 2 learnings for a stage.
   */
  private loadLearnings(stageDef: Step): Learning[] {
    const tier1 = this.deps.knowledgeStore.loadForStage(stageDef.type);
    // Tier 2 requires an agentId; for now we load subscriptions with a generic ID
    const tier2 = this.deps.knowledgeStore.loadForSubscriptions('default');
    return [...tier1, ...tier2];
  }

  /**
   * Persist the pipeline snapshot via the injected callback.
   */
  private persistPipeline(pipeline: Pipeline): void {
    this.deps.persistPipeline(pipeline);
  }

  /**
   * Fire a lifecycle hook, swallowing any errors so they never abort the pipeline.
   */
  private async fireHook(hookName: string, fn: () => Promise<void> | void): Promise<void> {
    try {
      await fn();
    } catch (err) {
      logger.warn('Lifecycle hook error (swallowed)', {
        hook: hookName,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  }
}
