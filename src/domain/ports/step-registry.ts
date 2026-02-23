import type { Step } from '@domain/types/step.js';

export interface StepFilter {
  type?: string;
}

export interface IStepRegistry {
  get(type: string, flavor?: string): Step;
  list(filter?: StepFilter): Step[];
  listFlavors(type: string): string[];
  delete(type: string, flavor?: string): Step;
}
