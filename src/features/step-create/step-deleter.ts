import { StepRegistry } from '@infra/registries/step-registry.js';
import type { Step } from '@domain/types/step.js';

export interface StepDeleteOptions {
  stagesDir: string;
  type: string;
  flavor?: string;
}

export interface StepDeleteResult {
  deleted: Step;
}

/**
 * Delete an existing step from disk and cache, returning the deleted step.
 *
 * @throws StepNotFoundError if no step with (type, flavor) exists
 */
export function deleteStep(options: StepDeleteOptions): StepDeleteResult {
  const registry = new StepRegistry(options.stagesDir);
  const deleted = registry.delete(options.type, options.flavor);
  return { deleted };
}

/** @deprecated Use StepDeleteOptions */
export type StageDeleteOptions = StepDeleteOptions;
/** @deprecated Use StepDeleteResult */
export type StageDeleteResult = StepDeleteResult;
/** @deprecated Use deleteStep */
export function deleteStage(options: StepDeleteOptions): StepDeleteResult {
  return deleteStep(options);
}
