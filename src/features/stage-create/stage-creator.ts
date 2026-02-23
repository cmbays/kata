import { StageRegistry } from '@infra/registries/stage-registry.js';
import { StageSchema, type Stage } from '@domain/types/stage.js';

export interface StageCreateOptions {
  stagesDir: string;
  input: unknown;
}

export interface StageCreateResult {
  stage: Stage;
}

/**
 * Validate and persist a new custom stage definition.
 *
 * Validates `input` against StageSchema, then delegates to StageRegistry
 * for file writing. Returns the validated Stage object.
 *
 * @throws ZodError if input fails schema validation
 */
export function createStage(options: StageCreateOptions): StageCreateResult {
  const stage = StageSchema.parse(options.input);
  const registry = new StageRegistry(options.stagesDir);
  registry.register(stage);
  return { stage };
}
