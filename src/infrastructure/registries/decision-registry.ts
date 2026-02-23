import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DecisionSchema, type Decision, type DecisionOutcome, type DecisionType } from '@domain/types/decision.js';
import type { StageCategory } from '@domain/types/stage.js';
import type {
  IDecisionRegistry,
  DecisionQuery,
  DecisionStats,
} from '@domain/ports/decision-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KataError, DecisionNotFoundError } from '@shared/lib/errors.js';

/**
 * Build the on-disk filename for a decision JSON file.
 * Uses dot notation: `{stageCategory}.{id}.json`.
 */
function decisionFilename(stageCategory: StageCategory, id: string): string {
  return `${stageCategory}.${id}.json`;
}

/**
 * Decision Registry — manages Decision records with JSON file persistence.
 *
 * Decisions are persisted to `basePath/{stageCategory}.{id}.json`.
 * Uses an in-memory cache backed by JsonStore for file I/O.
 *
 * Cache semantics: list() loads from disk only when the cache is empty.
 * Once any decision is recorded or loaded, subsequent list() calls return
 * only in-memory state. Use a fresh registry instance to re-scan disk.
 */
export class DecisionRegistry implements IDecisionRegistry {
  private readonly decisions = new Map<string, Decision>();

  constructor(private readonly basePath: string) {}

  /**
   * Record a new decision. Generates a UUID, assigns it as the decision id,
   * validates against DecisionSchema, and persists to disk.
   * @throws KataError if the file cannot be written.
   */
  record(input: Omit<Decision, 'id'>): Decision {
    const decision: Decision = DecisionSchema.parse({ ...input, id: randomUUID() });
    const filePath = join(this.basePath, decisionFilename(decision.stageCategory, decision.id));

    try {
      JsonStore.write(filePath, decision, DecisionSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist decision "${decision.id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.decisions.set(decision.id, decision);
    return decision;
  }

  /**
   * Retrieve a decision by its id.
   * @throws DecisionNotFoundError if no decision with that id exists.
   */
  get(id: string): Decision {
    const cached = this.decisions.get(id);
    if (cached) return cached;

    // Not in cache — load all decisions from disk to find this id.
    // The {stageCategory}.{id}.json naming scheme means we cannot construct
    // the filename from the id alone, so a full scan is required.
    this.loadFromDisk();

    const loaded = this.decisions.get(id);
    if (!loaded) {
      throw new DecisionNotFoundError(id);
    }
    return loaded;
  }

  /**
   * List decisions, optionally filtered.
   * Results are sorted by decidedAt ascending (oldest first).
   */
  list(filters?: DecisionQuery): Decision[] {
    if (this.decisions.size === 0) {
      this.loadFromDisk();
    }

    let results = [...this.decisions.values()];

    if (filters) {
      if (filters.stageCategory !== undefined) {
        results = results.filter((d) => d.stageCategory === filters.stageCategory);
      }
      if (filters.decisionType !== undefined) {
        results = results.filter((d) => d.decisionType === filters.decisionType);
      }
      if (filters.confidenceMin !== undefined) {
        results = results.filter((d) => d.confidence >= filters.confidenceMin!);
      }
      if (filters.confidenceMax !== undefined) {
        results = results.filter((d) => d.confidence <= filters.confidenceMax!);
      }
      if (filters.from !== undefined) {
        results = results.filter((d) => d.decidedAt >= filters.from!);
      }
      if (filters.to !== undefined) {
        results = results.filter((d) => d.decidedAt <= filters.to!);
      }
    }

    return results.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt));
  }

  /**
   * Fill in or update the post-facto outcome for a decision.
   * Merges the new outcome with any existing outcome fields.
   * @throws DecisionNotFoundError if no decision with that id exists.
   * @throws KataError if the file cannot be written.
   */
  updateOutcome(id: string, outcome: DecisionOutcome): Decision {
    const existing = this.get(id);
    const updated: Decision = DecisionSchema.parse({
      ...existing,
      outcome: { ...existing.outcome, ...outcome },
    });

    const filePath = join(this.basePath, decisionFilename(updated.stageCategory, updated.id));

    try {
      JsonStore.write(filePath, updated, DecisionSchema);
    } catch (err) {
      throw new KataError(
        `Failed to persist updated outcome for decision "${id}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    this.decisions.set(id, updated);
    return updated;
  }

  /**
   * Compute aggregate statistics for decisions matching the optional stageCategory filter.
   */
  getStats(stageCategory?: StageCategory): DecisionStats {
    const subset = this.list(stageCategory ? { stageCategory } : undefined);

    const count = subset.length;
    const avgConfidence =
      count === 0 ? 0 : subset.reduce((sum, d) => sum + d.confidence, 0) / count;

    const countByType: Partial<Record<DecisionType, number>> = {};
    for (const d of subset) {
      countByType[d.decisionType] = (countByType[d.decisionType] ?? 0) + 1;
    }

    const outcomeDistribution = { good: 0, partial: 0, poor: 0, noOutcome: 0 };
    for (const d of subset) {
      const quality = d.outcome?.artifactQuality;
      if (quality === 'good') outcomeDistribution.good++;
      else if (quality === 'partial') outcomeDistribution.partial++;
      else if (quality === 'poor') outcomeDistribution.poor++;
      else outcomeDistribution.noOutcome++;
    }

    return { count, avgConfidence, countByType, outcomeDistribution };
  }

  /**
   * Load all decisions from basePath into the in-memory cache.
   */
  private loadFromDisk(): void {
    const loaded = JsonStore.list(this.basePath, DecisionSchema);
    for (const decision of loaded) {
      this.decisions.set(decision.id, decision);
    }
  }
}
