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
 * Validates `input` against StageSchema (single parse), then writes via
 * StageRegistry. Returns the validated Stage object.
 *
 * @throws ZodError if input fails schema validation
 */
export function createStage(options: StageCreateOptions): StageCreateResult {
  // Parse once here for the typed return value; StageRegistry.register()
  // also validates internally as part of its public API contract.
  const stage = StageSchema.parse(options.input);
  const registry = new StageRegistry(options.stagesDir);
  registry.register(stage);
  return { stage };
}
