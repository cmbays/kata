import { StageRegistry } from '@infra/registries/stage-registry.js';
import { StageSchema, type Stage } from '@domain/types/stage.js';

export interface StageEditOptions {
  stagesDir: string;
  type: string;
  flavor?: string;
  input: unknown;
}

export interface StageEditResult {
  stage: Stage;
  previous: Stage;
}

/**
 * Load an existing stage, overwrite it with new validated input, and persist.
 *
 * @throws StageNotFoundError if no stage with (type, flavor) exists
 * @throws ZodError if `input` fails schema validation
 */
export function editStage(options: StageEditOptions): StageEditResult {
  const registry = new StageRegistry(options.stagesDir);
  const previous = registry.get(options.type, options.flavor);
  const stage = StageSchema.parse(options.input);
  registry.register(stage);
  return { stage, previous };
}
