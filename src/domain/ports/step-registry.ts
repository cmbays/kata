import type { Step } from '@domain/types/step.js';

export interface StepFilter {
  type?: string;
}

export interface IStepRegistry {
  register(step: Step): void;
  /** @throws StepNotFoundError if no step with (type, flavor) is registered or on disk */
  get(type: string, flavor?: string): Step;
  list(filter?: StepFilter): Step[];
  listFlavors(type: string): string[];
  /** @throws StepNotFoundError if no step with (type, flavor) is registered */
  delete(type: string, flavor?: string): Step;
}
