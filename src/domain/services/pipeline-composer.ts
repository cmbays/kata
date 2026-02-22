import { randomUUID } from 'node:crypto';
import {
  PipelineSchema,
  PipelineTemplateSchema,
  type Pipeline,
  type PipelineTemplate,
  type PipelineMetadata,
  type PipelineType,
} from '@domain/types/pipeline.js';
import type { StageRef } from '@domain/types/stage.js';
import type { StageRegistry } from '@infra/registries/stage-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Pipeline Composer — creates and validates pipelines from stage references.
 *
 * Pipelines are ordered compositions of stages. The composer validates that
 * stage definitions exist in the registry and that gate compatibility holds
 * (stage N exit gate artifact conditions satisfy stage N+1 entry gate requirements).
 */
export const PipelineComposer = {
  /**
   * Create a new Pipeline object from a name, type, and stage references.
   * Generates a UUID, sets initial timestamps, and builds stage state tracking.
   */
  define(name: string, type: PipelineType, stages: StageRef[]): Pipeline {
    const now = new Date().toISOString();

    const pipeline: Pipeline = PipelineSchema.parse({
      id: randomUUID(),
      name,
      type,
      stages: stages.map((ref) => ({
        stageRef: ref,
        state: 'pending',
        artifacts: [],
      })),
      state: 'draft',
      currentStageIndex: 0,
      metadata: { issueRefs: [] },
      createdAt: now,
      updatedAt: now,
    });

    return pipeline;
  },

  /**
   * Validate a pipeline against a stage registry.
   * Checks:
   * 1. Each stage reference exists in the registry
   * 2. Gate compatibility: stage N exit gate artifact conditions satisfy
   *    stage N+1 entry gate artifact-exists requirements
   */
  validate(pipeline: Pipeline, registry: StageRegistry): ValidationResult {
    const errors: string[] = [];

    // Check each stage exists in the registry
    for (let i = 0; i < pipeline.stages.length; i++) {
      const stageState = pipeline.stages[i];
      if (!stageState) continue;

      const { type, flavor } = stageState.stageRef;
      try {
        registry.get(type, flavor);
      } catch {
        const name = flavor ? `${type}:${flavor}` : type;
        errors.push(`Stage ${i}: "${name}" not found in registry`);
      }
    }

    // Check gate compatibility between consecutive stages
    for (let i = 0; i < pipeline.stages.length - 1; i++) {
      const currentStageState = pipeline.stages[i];
      const nextStageState = pipeline.stages[i + 1];
      if (!currentStageState || !nextStageState) continue;

      try {
        const currentStageDef = registry.get(
          currentStageState.stageRef.type,
          currentStageState.stageRef.flavor,
        );
        const nextStageDef = registry.get(
          nextStageState.stageRef.type,
          nextStageState.stageRef.flavor,
        );

        // If next stage has entry gate with artifact-exists conditions,
        // check that current stage's exit gate or artifacts can satisfy them
        if (nextStageDef.entryGate) {
          const requiredArtifacts = nextStageDef.entryGate.conditions
            .filter((c) => c.type === 'artifact-exists' && c.artifactName)
            .map((c) => c.artifactName as string);

          if (requiredArtifacts.length > 0) {
            // Collect artifacts available from the current stage's exit gate and artifact definitions
            const availableArtifacts = new Set<string>();

            // Add artifacts from the current stage's artifact definitions
            for (const artifact of currentStageDef.artifacts) {
              availableArtifacts.add(artifact.name);
            }

            // Check exit gate artifact conditions too
            if (currentStageDef.exitGate) {
              for (const cond of currentStageDef.exitGate.conditions) {
                if (cond.type === 'artifact-exists' && cond.artifactName) {
                  availableArtifacts.add(cond.artifactName);
                }
              }
            }

            for (const required of requiredArtifacts) {
              if (!availableArtifacts.has(required)) {
                const currentName = currentStageState.stageRef.flavor
                  ? `${currentStageState.stageRef.type}:${currentStageState.stageRef.flavor}`
                  : currentStageState.stageRef.type;
                const nextName = nextStageState.stageRef.flavor
                  ? `${nextStageState.stageRef.type}:${nextStageState.stageRef.flavor}`
                  : nextStageState.stageRef.type;
                errors.push(
                  `Gate mismatch at stage ${i} → ${i + 1}: "${nextName}" requires artifact "${required}" but "${currentName}" does not produce it`,
                );
              }
            }
          }
        }
      } catch {
        // Stage not found errors already captured above
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },

  /**
   * Load pipeline template JSON files from a directory.
   * Each .json file should conform to PipelineTemplateSchema.
   */
  loadTemplates(templateDir: string): PipelineTemplate[] {
    return JsonStore.list(templateDir, PipelineTemplateSchema);
  },

  /**
   * Create a pipeline instance from a template with initial state.
   * Optionally inject metadata (project refs, cycle/bet IDs).
   */
  instantiate(template: PipelineTemplate, metadata?: PipelineMetadata): Pipeline {
    const now = new Date().toISOString();

    const pipeline: Pipeline = PipelineSchema.parse({
      id: randomUUID(),
      name: template.name,
      type: template.type,
      stages: template.stages.map((ref) => ({
        stageRef: ref,
        state: 'pending',
        artifacts: [],
      })),
      state: 'draft',
      currentStageIndex: 0,
      metadata: metadata ?? { issueRefs: [] },
      createdAt: now,
      updatedAt: now,
    });

    return pipeline;
  },
};
