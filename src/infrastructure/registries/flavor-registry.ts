import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { FlavorSchema, type Flavor } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';
import type { StageCategory } from '@domain/types/stage.js';
import type {
  IFlavorRegistry,
  FlavorValidationResult,
  StepResolver,
} from '@domain/ports/flavor-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KataError, FlavorNotFoundError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Build the in-memory cache key for a flavor: `{stageCategory}:{name}`.
 * Uses `:` as separator to keep keys distinct from dot-notation filenames.
 */
function flavorKey(stageCategory: StageCategory, name: string): string {
  return `${stageCategory}:${name}`;
}

/**
 * Build the on-disk filename for a flavor JSON file.
 * Uses dot notation: `{stageCategory}.{name}.json`.
 */
function flavorFilename(stageCategory: StageCategory, name: string): string {
  return `${stageCategory}.${name}.json`;
}

/**
 * Safely call a StepResolver, converting any thrown exception to undefined.
 * The StepResolver contract specifies returning undefined for unknown steps,
 * but a resolver backed by a throwing registry would otherwise escape validate()
 * and bypass the FlavorValidationResult error accumulation contract.
 */
function safeResolve(
  stepResolver: StepResolver,
  stepName: string,
  stepType: string,
): Step | undefined {
  try {
    return stepResolver(stepName, stepType);
  } catch (err) {
    logger.warn(
      `StepResolver threw unexpectedly for step "${stepName}" (type: "${stepType}") — treating as unresolvable.`,
      { stepName, stepType, error: err instanceof Error ? err.message : String(err) },
    );
    return undefined;
  }
}

/**
 * Flavor Registry — manages Flavor definitions with JSON file persistence.
 *
 * Flavors are persisted to `basePath/{stageCategory}.{name}.json`.
 * Uses an in-memory cache backed by JsonStore for file I/O.
 *
 * Cache semantics: list() loads from disk only when the cache is empty.
 * Once any flavor is registered or loaded, subsequent list() calls return
 * only in-memory state. Use a fresh registry instance to re-scan disk.
 */
export class FlavorRegistry implements IFlavorRegistry {
  private readonly flavors = new Map<string, Flavor>();

  constructor(private readonly basePath: string) {}

  /**
   * Register a flavor. Validates against FlavorSchema and persists to disk.
   * If a flavor with the same stageCategory+name already exists, it is overwritten.
   * @throws KataError if the file cannot be written (e.g., permission denied, disk full)
   */
  register(flavor: Flavor): void {
    const validated = FlavorSchema.parse(flavor);
    const key = flavorKey(validated.stageCategory, validated.name);
    const filePath = join(this.basePath, flavorFilename(validated.stageCategory, validated.name));

    try {
      JsonStore.write(filePath, validated, FlavorSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist flavor "${validated.stageCategory}/${validated.name}" to disk. ` +
          `Details: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.flavors.set(key, validated);
  }

  /**
   * Retrieve a flavor by stage category and name.
   * @throws FlavorNotFoundError if the flavor is not registered or on disk
   * @throws KataError if the flavor file exists but is corrupted or schema-incompatible
   */
  get(stageCategory: StageCategory, name: string): Flavor {
    const key = flavorKey(stageCategory, name);
    const cached = this.flavors.get(key);
    if (cached) {
      return cached;
    }

    // Try loading from disk
    const filePath = join(this.basePath, flavorFilename(stageCategory, name));
    if (JsonStore.exists(filePath)) {
      let flavor: Flavor;
      try {
        flavor = JsonStore.read(filePath, FlavorSchema);
      } catch (err) {
        throw new KataError(
          `Flavor "${stageCategory}/${name}" exists on disk but could not be loaded. ` +
            `The file at ${filePath} may be corrupted or schema-incompatible. ` +
            `Details: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.flavors.set(key, flavor);
      return flavor;
    }

    throw new FlavorNotFoundError(stageCategory, name);
  }

  /**
   * List all registered flavors, optionally filtered by stage category.
   * Loads from disk only when the cache is empty.
   */
  list(stageCategory?: StageCategory): Flavor[] {
    if (this.flavors.size === 0) {
      this.loadFromDisk();
    }

    const all = Array.from(this.flavors.values());

    if (stageCategory) {
      return all.filter((f) => f.stageCategory === stageCategory);
    }

    return all;
  }

  /**
   * Delete a flavor from disk and cache, returning the deleted flavor.
   * @throws FlavorNotFoundError if the flavor does not exist
   * @throws KataError if the file cannot be deleted (e.g., permission denied)
   */
  delete(stageCategory: StageCategory, name: string): Flavor {
    const flavor = this.get(stageCategory, name);
    const key = flavorKey(stageCategory, name);
    const filePath = join(this.basePath, flavorFilename(stageCategory, name));

    try {
      unlinkSync(filePath);
    } catch (err) {
      throw new KataError(
        `Failed to delete flavor "${stageCategory}/${name}": ` +
          `${err instanceof Error ? err.message : String(err)}. ` +
          `Check file permissions at ${filePath}.`,
      );
    }

    this.flavors.delete(key);
    return flavor;
  }

  /**
   * Load built-in flavor definitions from a directory.
   * Each .json file should conform to FlavorSchema. Invalid files are skipped (logged by JsonStore).
   * Write failures for individual flavors are logged and skipped — partial load is preferred
   * over aborting the entire builtin initialization.
   */
  loadBuiltins(builtinDir: string): void {
    const flavors = JsonStore.list(builtinDir, FlavorSchema);
    for (const flavor of flavors) {
      const key = flavorKey(flavor.stageCategory, flavor.name);
      const filePath = join(this.basePath, flavorFilename(flavor.stageCategory, flavor.name));
      try {
        JsonStore.write(filePath, flavor, FlavorSchema);
      } catch (err) {
        logger.warn(
          `Failed to persist builtin flavor "${flavor.stageCategory}/${flavor.name}" — skipping.`,
          {
            stageCategory: flavor.stageCategory,
            name: flavor.name,
            filePath,
            error: err instanceof Error ? err.message : String(err),
          },
        );
        continue;
      }
      this.flavors.set(key, flavor);
    }
  }

  /**
   * Validate a flavor structurally and, when a stepResolver is provided,
   * perform full DAG validation of artifact dependencies.
   *
   * Without a stepResolver, valid: true only means the flavor is structurally
   * correct — it does NOT guarantee the synthesisArtifact is reachable.
   * Pass a stepResolver for full DAG artifact dependency checking.
   */
  validate(
    flavor: Flavor,
    stepResolver?: StepResolver,
    stageInputArtifacts: string[] = [],
  ): FlavorValidationResult {
    const errors: string[] = [];

    // Structural validation via Zod
    const parseResult = FlavorSchema.safeParse(flavor);
    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        errors.push(`Schema error: ${issue.message} (at ${issue.path.join('.')})`);
      }
      return { valid: false, errors };
    }

    // Validate overrides reference existing step names
    if (flavor.overrides) {
      const stepNames = new Set(flavor.steps.map((s) => s.stepName));
      for (const overrideKey of Object.keys(flavor.overrides)) {
        if (!stepNames.has(overrideKey)) {
          errors.push(
            `Override key "${overrideKey}" does not match any step name in this flavor. ` +
              `Available step names: ${[...stepNames].join(', ')}.`,
          );
        }
      }
    }

    if (!stepResolver) {
      return { valid: errors.length === 0, errors };
    }

    // Pre-resolve all steps once to avoid O(n²) resolver calls in the inner loop
    const resolvedSteps = new Map<string, Step | undefined>();
    for (const stepRef of flavor.steps) {
      resolvedSteps.set(stepRef.stepName, safeResolve(stepResolver, stepRef.stepName, stepRef.stepType));
    }

    // Full DAG validation: track artifacts available at each position
    const availableArtifacts = new Set<string>(stageInputArtifacts);
    let synthesisArtifactProduced = false;

    for (const stepRef of flavor.steps) {
      const step = resolvedSteps.get(stepRef.stepName);

      if (!step) {
        errors.push(
          `Step "${stepRef.stepName}" (type: "${stepRef.stepType}") could not be resolved. ` +
            `Ensure the step is registered before validating this flavor. ` +
            `Artifact dependency errors for steps following "${stepRef.stepName}" may also ` +
            `be caused by this missing step.`,
        );
        continue;
      }

      // Check artifact-exists conditions in the entry gate
      const entryConditions = step.entryGate?.conditions ?? [];
      for (const condition of entryConditions) {
        if (condition.type === 'artifact-exists' && condition.artifactName) {
          if (!availableArtifacts.has(condition.artifactName)) {
            // Find which step produces this artifact (using pre-resolved map)
            const producerRef = flavor.steps.find((ref) =>
              resolvedSteps.get(ref.stepName)?.artifacts.some((a) => a.name === condition.artifactName),
            );

            if (!producerRef) {
              errors.push(
                `Step "${stepRef.stepName}" requires artifact "${condition.artifactName}" ` +
                  `which is not produced by any step in this flavor and is not a stage input.`,
              );
            } else {
              errors.push(
                `Step "${stepRef.stepName}" requires artifact "${condition.artifactName}" ` +
                  `which is produced by step "${producerRef.stepName}", ` +
                  `but "${producerRef.stepName}" is not included before "${stepRef.stepName}" in this flavor.`,
              );
            }
          }
        }
      }

      // Add all artifacts this step produces to the available set
      for (const artifact of step.artifacts) {
        availableArtifacts.add(artifact.name);
        if (artifact.name === flavor.synthesisArtifact) {
          synthesisArtifactProduced = true;
        }
      }
    }

    if (!synthesisArtifactProduced) {
      errors.push(
        `Flavor declares synthesisArtifact "${flavor.synthesisArtifact}" ` +
          `but no step in this flavor produces it.`,
      );
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Load all flavors from basePath into the in-memory cache.
   */
  private loadFromDisk(): void {
    const flavors = JsonStore.list(this.basePath, FlavorSchema);
    for (const flavor of flavors) {
      const key = flavorKey(flavor.stageCategory, flavor.name);
      this.flavors.set(key, flavor);
    }
  }
}
