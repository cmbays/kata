import { join } from 'node:path';
import { unlinkSync } from 'node:fs';
import { FlavorSchema, type Flavor } from '@domain/types/flavor.js';
import type { StageCategory } from '@domain/types/stage.js';
import type {
  IFlavorRegistry,
  FlavorValidationResult,
  StepResolver,
} from '@domain/ports/flavor-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { FlavorNotFoundError } from '@shared/lib/errors.js';

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
 * Flavor Registry — manages Flavor definitions with JSON file persistence.
 *
 * Flavors are persisted to `basePath/{stageCategory}.{name}.json`.
 * Uses an in-memory cache backed by JsonStore for file I/O.
 */
export class FlavorRegistry implements IFlavorRegistry {
  private readonly flavors = new Map<string, Flavor>();

  constructor(private readonly basePath: string) {}

  /**
   * Register a flavor. Validates against FlavorSchema and persists to disk.
   * If a flavor with the same stageCategory+name already exists, it is overwritten.
   */
  register(flavor: Flavor): void {
    const validated = FlavorSchema.parse(flavor);
    const key = flavorKey(validated.stageCategory, validated.name);
    const filePath = join(this.basePath, flavorFilename(validated.stageCategory, validated.name));

    JsonStore.write(filePath, validated, FlavorSchema);
    this.flavors.set(key, validated);
  }

  /**
   * Retrieve a flavor by stage category and name.
   * @throws FlavorNotFoundError if the flavor is not registered or on disk
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
      const flavor = JsonStore.read(filePath, FlavorSchema);
      this.flavors.set(key, flavor);
      return flavor;
    }

    throw new FlavorNotFoundError(stageCategory, name);
  }

  /**
   * List all registered flavors, optionally filtered by stage category.
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
   */
  delete(stageCategory: StageCategory, name: string): Flavor {
    const flavor = this.get(stageCategory, name);
    const key = flavorKey(stageCategory, name);
    const filePath = join(this.basePath, flavorFilename(stageCategory, name));
    unlinkSync(filePath);
    this.flavors.delete(key);
    return flavor;
  }

  /**
   * Load built-in flavor definitions from a directory.
   * Each .json file should conform to FlavorSchema.
   */
  loadBuiltins(builtinDir: string): void {
    const flavors = JsonStore.list(builtinDir, FlavorSchema);
    for (const flavor of flavors) {
      const key = flavorKey(flavor.stageCategory, flavor.name);
      const filePath = join(this.basePath, flavorFilename(flavor.stageCategory, flavor.name));
      JsonStore.write(filePath, flavor, FlavorSchema);
      this.flavors.set(key, flavor);
    }
  }

  /**
   * Validate a flavor structurally and, when a stepResolver is provided,
   * perform full DAG validation of artifact dependencies.
   *
   * DAG validation checks that each step's `artifact-exists` entry gate
   * conditions can be satisfied by:
   * 1. Artifacts produced by preceding steps in this flavor (`step.artifacts`)
   * 2. The optional stage-level input artifacts (handoff from the prior Stage)
   *
   * Also verifies that the final set of produced artifacts includes the
   * flavor's declared synthesisArtifact.
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

    // Full DAG validation: track artifacts available at each position
    const availableArtifacts = new Set<string>(stageInputArtifacts);
    let synthesisArtifactProduced = false;

    for (const stepRef of flavor.steps) {
      const step = stepResolver(stepRef.stepName, stepRef.stepType);

      if (!step) {
        errors.push(
          `Step "${stepRef.stepName}" (type: "${stepRef.stepType}") could not be resolved. ` +
            `Ensure the step is registered before validating this flavor.`,
        );
        // Continue — still check other steps with partial info
        continue;
      }

      // Check artifact-exists conditions in the entry gate
      const entryConditions = step.entryGate?.conditions ?? [];
      for (const condition of entryConditions) {
        if (condition.type === 'artifact-exists' && condition.artifactName) {
          if (!availableArtifacts.has(condition.artifactName)) {
            // Find which step produces this artifact, if any
            const producerIdx = flavor.steps.findIndex((ref) => {
              const refStep = stepResolver(ref.stepName, ref.stepType);
              return refStep?.artifacts.some((a) => a.name === condition.artifactName);
            });

            const producer = producerIdx !== -1 ? flavor.steps[producerIdx] : undefined;

            if (!producer) {
              errors.push(
                `Step "${stepRef.stepName}" requires artifact "${condition.artifactName}" ` +
                  `which is not produced by any step in this flavor and is not a stage input.`,
              );
            } else {
              errors.push(
                `Step "${stepRef.stepName}" requires artifact "${condition.artifactName}" ` +
                  `which is produced by step "${producer.stepName}", ` +
                  `but "${producer.stepName}" is not included before "${stepRef.stepName}" in this flavor.`,
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
