import { join } from 'node:path';
import { StageSchema, type Stage } from '@domain/types/stage.js';
import type { IStageRegistry, StageFilter } from '@domain/ports/stage-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StageNotFoundError } from '@shared/lib/errors.js';

/**
 * Build the storage key for a stage: `{type}` or `{type}:{flavor}`.
 */
function stageKey(type: string, flavor?: string): string {
  return flavor ? `${type}:${flavor}` : type;
}

/**
 * Build the filename for a stage JSON file.
 */
function stageFilename(type: string, flavor?: string): string {
  return flavor ? `${type}:${flavor}.json` : `${type}.json`;
}

/**
 * Stage Registry — manages stage definitions with JSON file persistence.
 *
 * Stages are persisted to `basePath/{type}.json` (or `{type}:{flavor}.json` for flavored stages).
 * Uses an in-memory cache backed by JsonStore for file I/O.
 */
export class StageRegistry implements IStageRegistry {
  private readonly stages = new Map<string, Stage>();

  constructor(private readonly basePath: string) {}

  /**
   * Register a stage definition. Validates against StageSchema and persists to disk.
   * If a stage with the same type+flavor already exists, it is overwritten.
   */
  register(stage: Stage): void {
    const validated = StageSchema.parse(stage);
    const key = stageKey(validated.type, validated.flavor);
    const filePath = join(this.basePath, stageFilename(validated.type, validated.flavor));

    JsonStore.write(filePath, validated, StageSchema);
    this.stages.set(key, validated);
  }

  /**
   * Retrieve a stage by type and optional flavor.
   * @throws StageNotFoundError if the stage is not registered
   */
  get(type: string, flavor?: string): Stage {
    const key = stageKey(type, flavor);
    const cached = this.stages.get(key);
    if (cached) {
      return cached;
    }

    // Try loading from disk
    const filePath = join(this.basePath, stageFilename(type, flavor));
    if (JsonStore.exists(filePath)) {
      const stage = JsonStore.read(filePath, StageSchema);
      this.stages.set(key, stage);
      return stage;
    }

    throw new StageNotFoundError(type, flavor);
  }

  /**
   * List all registered stages, optionally filtered by type.
   */
  list(filter?: StageFilter): Stage[] {
    // Ensure we load from disk if cache is empty
    if (this.stages.size === 0) {
      this.loadFromDisk();
    }

    const all = Array.from(this.stages.values());

    if (filter?.type) {
      return all.filter((s) => s.type === filter.type);
    }

    return all;
  }

  /**
   * Load all built-in stage definitions from a directory.
   * Each .json file in the directory should conform to StageSchema.
   */
  loadBuiltins(builtinDir: string): void {
    const stages = JsonStore.list(builtinDir, StageSchema);
    for (const stage of stages) {
      const key = stageKey(stage.type, stage.flavor);
      const filePath = join(this.basePath, stageFilename(stage.type, stage.flavor));

      JsonStore.write(filePath, stage, StageSchema);
      this.stages.set(key, stage);
    }
  }

  /**
   * Load user-defined custom stage definitions from a directory.
   * Follows the same format as built-in stages.
   */
  loadCustom(customDir: string): void {
    const stages = JsonStore.list(customDir, StageSchema);
    for (const stage of stages) {
      const key = stageKey(stage.type, stage.flavor);
      const filePath = join(this.basePath, stageFilename(stage.type, stage.flavor));

      JsonStore.write(filePath, stage, StageSchema);
      this.stages.set(key, stage);
    }
  }

  /**
   * Load all stages from the basePath into the in-memory cache.
   */
  private loadFromDisk(): void {
    const stages = JsonStore.list(this.basePath, StageSchema);
    for (const stage of stages) {
      const key = stageKey(stage.type, stage.flavor);
      this.stages.set(key, stage);
    }
  }
}
