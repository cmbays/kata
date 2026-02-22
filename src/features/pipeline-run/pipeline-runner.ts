import { join } from 'node:path';
import type { Pipeline } from '@domain/types/pipeline.js';
import { PipelineSchema } from '@domain/types/pipeline.js';
import type { KataConfig } from '@domain/types/config.js';
import type { Gate, GateResult } from '@domain/types/gate.js';
import type { Stage } from '@domain/types/stage.js';
import type { Learning } from '@domain/types/learning.js';
import type { IStageRegistry } from '@domain/ports/stage-registry.js';
import type { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { AdapterResolver } from '@infra/execution/adapter-resolver.js';
import type { TokenTracker } from '@infra/tracking/token-tracker.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { evaluateGate, type GateEvalContext } from './gate-evaluator.js';
import type { ResultCapturer } from './result-capturer.js';

/**
 * Dependencies injected into the pipeline runner for testability.
 */
export interface PipelineRunnerDeps {
  stageRegistry: IStageRegistry;
  knowledgeStore: KnowledgeStore;
  adapterResolver: AdapterResolver;
  resultCapturer: ResultCapturer;
  tokenTracker: TokenTracker;
  manifestBuilder: typeof ManifestBuilder;
  pipelineDir: string;
  /** Optional prompt function for interactive overrides */
  promptFn?: {
    gateOverride: (gateResult: GateResult) => Promise<'retry' | 'skip' | 'abort'>;
    captureLearning: (stageType: string) => Promise<string | null>;
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
 * 4. Build execution manifest
 * 5. Resolve and execute adapter
 * 6. Capture result to history
 * 7. Record token usage
 * 8. Evaluate exit gate
 * 9. Optionally capture learnings
 * 10. Update pipeline state
 * 11. Persist pipeline
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

        // Build execution manifest
        const manifest = this.deps.manifestBuilder.build(
          stageDef,
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
          } catch {
            // Learning capture failure is non-critical — continue pipeline
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
        } catch {
          // Cannot persist — best-effort cleanup
        }

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

    return {
      availableArtifacts,
      completedStages,
      // TODO: Wire human approval state (tracked per-stage or via promptFn).
      // Currently, human-approved gates always fail and require skip/abort via gate override.
      humanApproved: false,
    };
  }

  /**
   * Evaluate a gate, retrying up to MAX_GATE_RETRIES when the user selects 'retry'.
   * Returns 'proceed' if the gate passes, or the terminal action ('skip'/'abort').
   */
  private async evaluateGateWithRetry(
    gate: Gate,
    context: GateEvalContext,
  ): Promise<'proceed' | 'skip' | 'abort'> {
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const result = evaluateGate(gate, context);
      if (result.passed) {
        return 'proceed';
      }

      const action = await this.handleGateFailure(result);
      if (action === 'skip') return 'skip';
      if (action === 'abort') return 'abort';
      // action === 'retry' — loop continues to re-evaluate
    }

    // Exhausted retries — abort
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
  private loadLearnings(stageDef: Stage): Learning[] {
    const tier1 = this.deps.knowledgeStore.loadForStage(stageDef.type);
    // Tier 2 requires an agentId; for now we load subscriptions with a generic ID
    const tier2 = this.deps.knowledgeStore.loadForSubscriptions('default');
    return [...tier1, ...tier2];
  }

  /**
   * Persist the pipeline to its JSON file.
   */
  private persistPipeline(pipeline: Pipeline): void {
    const filePath = join(this.deps.pipelineDir, `${pipeline.id}.json`);
    JsonStore.write(filePath, pipeline, PipelineSchema);
  }
}
