import type { StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';

export interface FlavorValidationResult {
  valid: boolean;
  /** Human-readable error messages describing why the flavor is invalid. */
  errors: string[];
}

/**
 * Resolves a step reference (stepName + stepType) to a Step definition.
 * Used by validate() to check artifact dependencies during DAG validation.
 * Returns undefined if the step cannot be found (produces a validation warning).
 */
export type StepResolver = (stepName: string, stepType: string) => Step | undefined;

export interface IFlavorRegistry {
  register(flavor: Flavor): void;
  /** @throws FlavorNotFoundError if no flavor with (stageCategory, name) is registered */
  get(stageCategory: StageCategory, name: string): Flavor;
  list(stageCategory?: StageCategory): Flavor[];
  /**
   * Validate a flavor structurally and, when a stepResolver is provided,
   * perform full DAG validation to check that artifact dependencies are
   * satisfiable by preceding steps or the optional stage input artifacts.
   *
   * @param flavor - The flavor to validate.
   * @param stepResolver - Optional function to look up step definitions by
   *   (stepName, stepType). Required for DAG artifact dependency checks.
   * @param stageInputArtifacts - Artifact names available as stage-level inputs
   *   (handoff from the prior Stage). These satisfy artifact-exists conditions
   *   on the first step without a preceding step in the flavor.
   */
  validate(
    flavor: Flavor,
    stepResolver?: StepResolver,
    stageInputArtifacts?: string[],
  ): FlavorValidationResult;
}
