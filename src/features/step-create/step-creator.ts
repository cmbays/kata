import { StepRegistry } from '@infra/registries/step-registry.js';
import { StepSchema, type Step } from '@domain/types/step.js';

export interface StepCreateOptions {
  stagesDir: string;
  input: unknown;
}

export interface StepCreateResult {
  step: Step;
}

/**
 * Validate and persist a new custom step definition.
 *
 * Validates `input` against StepSchema (single parse), then writes via
 * StepRegistry. Returns the validated Step object.
 *
 * @throws ZodError if input fails schema validation
 */
export function createStep(options: StepCreateOptions): StepCreateResult {
  // Parse once here for the typed return value; StepRegistry.register()
  // also validates internally as part of its public API contract.
  const step = StepSchema.parse(options.input);
  const registry = new StepRegistry(options.stagesDir);
  registry.register(step);
  return { step };
}

/** @deprecated Use StepCreateOptions */
export type StageCreateOptions = StepCreateOptions;
/** @deprecated Use StepCreateResult */
export type StageCreateResult = { stage: Step };
/** @deprecated Use createStep */
export function createStage(options: StepCreateOptions): { stage: Step } {
  const { step } = createStep(options);
  return { stage: step };
}
