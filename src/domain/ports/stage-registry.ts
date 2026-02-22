import type { Stage } from '@domain/types/stage.js';

export interface StageFilter {
  type?: string;
}

export interface IStageRegistry {
  get(type: string, flavor?: string): Stage;
  list(filter?: StageFilter): Stage[];
}
