import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { z } from 'zod/v4';
import { logger } from '@shared/lib/logger.js';

export class JsonStoreError extends Error {
  constructor(
    message: string,
    public readonly path: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'JsonStoreError';
  }
}

/**
 * Generic typed JSON file persistence.
 * Read/write/validate JSON files against Zod schemas.
 */
export const JsonStore = {
  /**
   * Read a JSON file and validate against schema.
   * @throws JsonStoreError if file missing, invalid JSON, or validation fails
   */
  read<T>(path: string, schema: z.ZodType<T>): T {
    if (!existsSync(path)) {
      throw new JsonStoreError(`File not found: ${path}`, path);
    }

    let raw: string;
    try {
      raw = readFileSync(path, 'utf-8');
    } catch (err) {
      throw new JsonStoreError(`Failed to read file: ${path}`, path, err);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new JsonStoreError(`Invalid JSON in file: ${path}`, path, err);
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new JsonStoreError(
        `Validation failed for ${path}: ${JSON.stringify(result.error.issues, null, 2)}`,
        path,
        result.error,
      );
    }

    return result.data;
  },

  /**
   * Validate data and write to JSON file.
   * Creates parent directories if they don't exist.
   */
  write<T>(path: string, data: T, schema: z.ZodType<T>): void {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new JsonStoreError(
        `Validation failed before write: ${JSON.stringify(result.error.issues, null, 2)}`,
        path,
        result.error,
      );
    }

    JsonStore.ensureDir(dirname(path));

    try {
      writeFileSync(path, JSON.stringify(result.data, null, 2) + '\n', 'utf-8');
    } catch (err) {
      throw new JsonStoreError(`Failed to write file: ${path}`, path, err);
    }
  },

  /** Check if a file exists */
  exists(path: string): boolean {
    return existsSync(path);
  },

  /**
   * Read all .json files in a directory and validate each against schema.
   * Skips files that fail validation (logs warning).
   */
  list<T>(dir: string, schema: z.ZodType<T>): T[] {
    if (!existsSync(dir)) {
      return [];
    }

    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const results: T[] = [];

    for (const file of files) {
      try {
        results.push(JsonStore.read(join(dir, file), schema));
      } catch (err) {
        logger.warn(`Skipping invalid file "${file}" in ${dir}`, {
          file,
          dir,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  },

  /** Create directory and all parents if they don't exist */
  ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  },
};
