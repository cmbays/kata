import { StageRegistry } from '@infra/registries/stage-registry.js';
import type { Stage } from '@domain/types/stage.js';

export interface StageDeleteOptions {
  stagesDir: string;
  type: string;
  flavor?: string;
}

export interface StageDeleteResult {
  deleted: Stage;
}

/**
 * Delete an existing stage from disk and cache, returning the deleted stage.
 *
 * @throws StageNotFoundError if no stage with (type, flavor) exists
 */
export function deleteStage(options: StageDeleteOptions): StageDeleteResult {
  const registry = new StageRegistry(options.stagesDir);
  const deleted = registry.delete(options.type, options.flavor);
  return { deleted };
}
