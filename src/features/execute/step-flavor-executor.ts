import { randomUUID } from 'node:crypto';
import { LearningSchema } from '@domain/types/learning.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';
import type { KataConfig } from '@domain/types/config.js';
import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type {
  IFlavorExecutor,
  OrchestratorContext,
  FlavorExecutionResult,
  ArtifactValue,
} from '@domain/ports/stage-orchestrator.js';
import type { IExecutionAdapter } from '@domain/ports/execution-adapter.js';
import { ManifestBuilder } from '@domain/services/manifest-builder.js';
import { KataError } from '@shared/lib/errors.js';

/**
 * Minimal interface for StepRegistry — only the `get` method is needed.
 * Using a narrow interface instead of importing IStepRegistry avoids
 * pulling in unused methods and makes testing easier.
 */
export interface StepLookup {
  get(type: string, flavor?: string): Step;
}

/**
 * Minimal interface for AdapterResolver — only `resolve` is needed.
 */
export interface AdapterLookup {
  resolve(config?: KataConfig): IExecutionAdapter;
}

export interface StepFlavorExecutorDeps {
  stepRegistry: StepLookup;
  adapterResolver: AdapterLookup;
  config: KataConfig;
}

/**
 * Concrete IFlavorExecutor that bridges the Stage Orchestrator and actual
 * step execution. For each step in a Flavor, it:
 *   1. Looks up the Step definition from StepRegistry
 *   2. Builds an ExecutionManifest via ManifestBuilder
 *   3. Resolves an adapter via AdapterResolver
 *   4. Executes the manifest and collects artifacts
 */
export class StepFlavorExecutor implements IFlavorExecutor {
  constructor(private readonly deps: StepFlavorExecutorDeps) {}

  async execute(flavor: Flavor, context: OrchestratorContext): Promise<FlavorExecutionResult> {
    const adapter = this.deps.adapterResolver.resolve(this.deps.config);
    const allArtifacts: Record<string, unknown> = {};
    let lastResult: ExecutionResult | undefined;

    // Build learnings once — they don't change between steps
    const now = new Date().toISOString();
    const learnings = (context.learnings ?? []).map((content) =>
      LearningSchema.parse({
        id: randomUUID(),
        tier: 'stage',
        category: 'execution',
        content,
        confidence: 0.7,
        createdAt: now,
        updatedAt: now,
      }),
    );

    // Single pipelineId correlates all steps within this flavor execution
    const pipelineId = randomUUID();

    for (const stepRef of flavor.steps) {
      const step = this.deps.stepRegistry.get(stepRef.stepType);

      const manifest: ExecutionManifest = ManifestBuilder.build(
        step,
        {
          pipelineId,
          stageIndex: 0,
          metadata: {
            flavorName: flavor.name,
            stepName: stepRef.stepName,
            ...(context.bet ?? {}),
          },
        },
        learnings.length > 0 ? learnings : undefined,
      );

      const result = await adapter.execute(manifest);

      if (!result.success) {
        throw new KataError(
          `Step "${stepRef.stepName}" (type: ${stepRef.stepType}) in flavor "${flavor.name}" ` +
            `failed: ${result.notes ?? 'execution returned success=false'}`,
        );
      }

      // Collect artifacts from the result
      for (const artifact of result.artifacts) {
        allArtifacts[artifact.name] = artifact.path ?? true;
      }

      lastResult = result;
    }

    // Build synthesis artifact
    const synthesisArtifact: ArtifactValue = {
      name: flavor.synthesisArtifact,
      value: allArtifacts[flavor.synthesisArtifact] ?? {
        artifacts: allArtifacts,
        completedAt: lastResult?.completedAt ?? new Date().toISOString(),
      },
    };

    return {
      flavorName: flavor.name,
      artifacts: allArtifacts,
      synthesisArtifact,
    };
  }
}
