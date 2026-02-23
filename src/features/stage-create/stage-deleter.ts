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
 * Load an existing stage and delete it from disk and cache.
 *
 * @throws StageNotFoundError if no stage with (type, flavor) exists
 */
export function deleteStage(options: StageDeleteOptions): StageDeleteResult {
  const registry = new StageRegistry(options.stagesDir);
  const deleted = registry.get(options.type, options.flavor);
  registry.delete(options.type, options.flavor);
  return { deleted };
}
