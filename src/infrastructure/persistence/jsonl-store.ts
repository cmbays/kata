import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { z } from 'zod/v4';
import { logger } from '@shared/lib/logger.js';

export class JsonlStoreError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JsonlStoreError';
  }
}

/**
 * Append-only JSONL (newline-delimited JSON) file persistence.
 *
 * Each line in a JSONL file is an independent JSON object.
 * Invalid lines are skipped with a warning on read.
 * Files are created on first append.
 */
export const JsonlStore = {
  /**
   * Append a single entry to a JSONL file.
   * Creates the file and parent directories if they don't exist.
   */
  append<T>(path: string, entry: T, schema: z.ZodType<T>): void {
    const result = schema.safeParse(entry);
    if (!result.success) {
      throw new JsonlStoreError(
        `Validation failed before append: ${JSON.stringify(result.error.issues, null, 2)}`,
        path,
        result.error,
      );
    }

    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      appendFileSync(path, JSON.stringify(result.data) + '\n', 'utf-8');
    } catch (err) {
      throw new JsonlStoreError(`Failed to append to file: ${path}`, path, err);
    }
  },

  /**
   * Read all valid entries from a JSONL file.
   * Lines that fail parsing or validation are skipped with a warning.
   * Returns an empty array if the file does not exist.
   */
  readAll<T>(path: string, schema: z.ZodType<T>): T[] {
    if (!existsSync(path)) {
      return [];
    }

    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      throw new JsonlStoreError(`Failed to read file: ${path}`, path, err);
    }

    const results: T[] = [];

    for (const [lineIndex, line] of raw.split('\n').entries()) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        logger.warn(`Skipping invalid JSON on line ${lineIndex + 1} in ${path}`);
        continue;
      }

      const result = schema.safeParse(parsed);
      if (!result.success) {
        logger.warn(`Skipping invalid entry on line ${lineIndex + 1} in ${path}`, {
          issues: result.error.issues,
        });
        continue;
      }

      results.push(result.data);
    }

    return results;
  },

  /**
   * Read decisions.jsonl and decision-outcomes.jsonl and merge them.
   * For each decision, the latest outcome entry (by updatedAt) is merged in.
   * Returns the merged entries in original decision order.
   *
   * @param decisionsPath Path to decisions.jsonl
   * @param outcomesPath Path to decision-outcomes.jsonl
   * @param decisionSchema Zod schema for decision entries (must have id, decidedAt)
   * @param outcomeSchema Zod schema for outcome entries (must have decisionId, updatedAt)
   */
  readDecisionsWithOutcomes<
    D extends { id: string; decidedAt: string },
    O extends { decisionId: string; updatedAt: string },
  >(
    decisionsPath: string,
    outcomesPath: string,
    decisionSchema: z.ZodType<D>,
    outcomeSchema: z.ZodType<O>,
  ): Array<D & { latestOutcome: O | undefined }> {
    const decisions = JsonlStore.readAll(decisionsPath, decisionSchema);
    const outcomes = JsonlStore.readAll(outcomesPath, outcomeSchema);

    // Build a map: decisionId → latest outcome (by updatedAt)
    const latestOutcomeByDecisionId = new Map<string, O>();
    for (const outcome of outcomes) {
      const existing = latestOutcomeByDecisionId.get(outcome.decisionId);
      if (!existing || outcome.updatedAt > existing.updatedAt) {
        latestOutcomeByDecisionId.set(outcome.decisionId, outcome);
      }
    }

    return decisions.map((d) => ({
      ...d,
      latestOutcome: latestOutcomeByDecisionId.get(d.id),
    }));
  },
};
