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
 *
 * Implementations MUST return undefined for unknown steps rather than throwing.
 * If an implementation may throw (e.g., a registry-backed resolver), the
 * FlavorRegistry will catch the exception and treat it as undefined.
 */
export type StepResolver = (stepName: string, stepType: string) => Step | undefined;

export interface IFlavorRegistry {
  register(flavor: Flavor): void;
  /** @throws FlavorNotFoundError if no flavor with (stageCategory, name) is registered */
  get(stageCategory: StageCategory, name: string): Flavor;
  list(stageCategory?: StageCategory): Flavor[];
  /**
   * Delete a flavor from disk and cache, returning the deleted flavor.
   * @throws FlavorNotFoundError if the flavor does not exist
   * @throws KataError if the file cannot be deleted (e.g., permission denied)
   */
  delete(stageCategory: StageCategory, name: string): Flavor;
  /** Load built-in flavor definitions from a directory. Invalid files are skipped with a warning. */
  loadBuiltins(builtinDir: string): void;
  /**
   * Validate a flavor structurally and, when a stepResolver is provided,
   * perform full DAG validation to check that artifact dependencies are
   * satisfiable by preceding steps or the optional stage input artifacts.
   *
   * @param flavor - The flavor to validate.
   * @param stepResolver - Optional function to look up step definitions by
   *   (stepName, stepType). Required for DAG artifact dependency checks.
   *   Without a resolver, valid: true does NOT guarantee the synthesisArtifact
   *   is reachable — only structural constraints are checked.
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
