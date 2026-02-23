import { StepRegistry } from '@infra/registries/step-registry.js';
import { StepSchema, type Step } from '@domain/types/step.js';

export interface StepEditOptions {
  stagesDir: string;
  type: string;
  flavor?: string;
  input: unknown;
}

export interface StepEditResult {
  step: Step;
  previous: Step;
}

/**
 * Load an existing step, overwrite it with new validated input, and persist.
 *
 * @throws StepNotFoundError if no step with (type, flavor) exists
 * @throws ZodError if `input` fails schema validation
 */
export function editStep(options: StepEditOptions): StepEditResult {
  const registry = new StepRegistry(options.stagesDir);
  const previous = registry.get(options.type, options.flavor);
  const step = StepSchema.parse(options.input);
  registry.register(step);
  return { step, previous };
}

/** @deprecated Use StepEditOptions */
export type StageEditOptions = StepEditOptions;
/** @deprecated Use StepEditResult */
export type StageEditResult = { stage: Step; previous: Step };
/** @deprecated Use editStep */
export function editStage(options: StepEditOptions): { stage: Step; previous: Step } {
  const { step, previous } = editStep(options);
  return { stage: step, previous };
}
