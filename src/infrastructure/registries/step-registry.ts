import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { StepSchema, type Step } from '@domain/types/step.js';
import type { IStepRegistry, StepFilter } from '@domain/ports/step-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepNotFoundError } from '@shared/lib/errors.js';

/**
 * Build the in-memory cache key for a step: `{type}` or `{type}:{flavor}`.
 * Intentionally uses `:` as separator to keep cache keys distinct from
 * dot-notation filenames (see stepFilename). A type named "build.go" would
 * otherwise collide with a base type "build" plus flavor "go".
 */
function stepKey(type: string, flavor?: string): string {
  return flavor ? `${type}:${flavor}` : type;
}

/**
 * Build the on-disk filename for a step JSON file.
 * Uses dot notation: `{type}.json` or `{type}.{flavor}.json`.
 * Intentionally uses `.` (not `:`) to produce valid filenames on all OS.
 * See stepKey for the corresponding in-memory cache key format.
 */
function stepFilename(type: string, flavor?: string): string {
  return flavor ? `${type}.${flavor}.json` : `${type}.json`;
}

/**
 * Step Registry — manages step definitions with JSON file persistence.
 *
 * Steps are persisted to `basePath/{type}.json` (or `{type}.{flavor}.json` for flavored steps).
 * Uses an in-memory cache backed by JsonStore for file I/O.
 */
export class StepRegistry implements IStepRegistry {
  private readonly steps = new Map<string, Step>();

  constructor(private readonly basePath: string) {}

  /**
   * Register a step definition. Validates against StepSchema and persists to disk.
   * If a step with the same type+flavor already exists, it is overwritten.
   */
  register(step: Step): void {
    const validated = StepSchema.parse(step);
    const key = stepKey(validated.type, validated.flavor);
    const filePath = join(this.basePath, stepFilename(validated.type, validated.flavor));

    JsonStore.write(filePath, validated, StepSchema);
    this.steps.set(key, validated);
  }

  /**
   * Retrieve a step by type and optional flavor.
   * @throws StepNotFoundError if the step is not registered
   */
  get(type: string, flavor?: string): Step {
    const key = stepKey(type, flavor);
    const cached = this.steps.get(key);
    if (cached) {
      return cached;
    }

    // Try loading from disk
    const filePath = join(this.basePath, stepFilename(type, flavor));
    if (JsonStore.exists(filePath)) {
      const step = JsonStore.read(filePath, StepSchema);
      this.steps.set(key, step);
      return step;
    }

    throw new StepNotFoundError(type, flavor);
  }

  /**
   * List all registered steps, optionally filtered by type.
   */
  list(filter?: StepFilter): Step[] {
    // Ensure we load from disk if cache is empty
    if (this.steps.size === 0) {
      this.loadFromDisk();
    }

    const all = Array.from(this.steps.values());

    if (filter?.type) {
      return all.filter((s) => s.type === filter.type);
    }

    return all;
  }

  /**
   * Return all registered flavors for a given step type, sorted alphabetically.
   */
  listFlavors(type: string): string[] {
    if (this.steps.size === 0) {
      this.loadFromDisk();
    }

    const flavors = new Set<string>();
    for (const step of this.steps.values()) {
      if (step.type === type && step.flavor !== undefined) {
        flavors.add(step.flavor);
      }
    }

    return [...flavors].sort();
  }

  /**
   * Delete a step definition from disk and cache, returning the deleted step.
   * Uses get() to ensure the step is loaded into cache before deletion.
   * @throws StepNotFoundError if the step does not exist
   */
  delete(type: string, flavor?: string): Step {
    const step = this.get(type, flavor);
    const key = stepKey(type, flavor);
    const filePath = join(this.basePath, stepFilename(type, flavor));
    unlinkSync(filePath);
    this.steps.delete(key);
    return step;
  }

  /**
   * Load all built-in step definitions from a directory.
   * Each .json file in the directory should conform to StepSchema.
   */
  loadBuiltins(builtinDir: string): void {
    const steps = JsonStore.list(builtinDir, StepSchema);
    for (const step of steps) {
      const key = stepKey(step.type, step.flavor);
      const filePath = join(this.basePath, stepFilename(step.type, step.flavor));

      JsonStore.write(filePath, step, StepSchema);
      this.steps.set(key, step);
    }
  }

  /**
   * Load user-defined custom step definitions from a directory.
   * Follows the same format as built-in steps.
   */
  loadCustom(customDir: string): void {
    const steps = JsonStore.list(customDir, StepSchema);
    for (const step of steps) {
      const key = stepKey(step.type, step.flavor);
      const filePath = join(this.basePath, stepFilename(step.type, step.flavor));

      JsonStore.write(filePath, step, StepSchema);
      this.steps.set(key, step);
    }
  }

  /**
   * Load all steps from the basePath into the in-memory cache.
   */
  private loadFromDisk(): void {
    const steps = JsonStore.list(this.basePath, StepSchema);
    for (const step of steps) {
      const key = stepKey(step.type, step.flavor);
      this.steps.set(key, step);
    }
  }
}

/** @deprecated Use StepRegistry */
export { StepRegistry as StageRegistry };
