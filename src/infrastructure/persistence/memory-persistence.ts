import type { z } from 'zod/v4';
import type { IPersistence } from '@domain/ports/persistence.js';

/**
 * In-memory implementation of IPersistence for use in unit tests.
 *
 * Stores data in a Map keyed by file path. `list(dirPath)` returns all
 * entries whose path starts with `dirPath + "/"`. `ensureDir()` is a no-op.
 *
 * Example:
 * ```ts
 * const store = new MemoryPersistence();
 * store.write('/project/.kata/cycles/abc.json', cycle, CycleSchema);
 * const cycles = store.list('/project/.kata/cycles', CycleSchema);
 * ```
 */
export class MemoryPersistence implements IPersistence {
  private readonly store = new Map<string, unknown>();

  read<T>(filePath: string, schema: z.ZodType<T>): T {
    if (!this.store.has(filePath)) {
      throw new Error(`MemoryPersistence: file not found: ${filePath}`);
    }
    return schema.parse(this.store.get(filePath));
  }

  write<T>(filePath: string, data: T, schema: z.ZodType<T>): void {
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new Error(`MemoryPersistence: validation failed for ${filePath}: ${JSON.stringify(result.error.issues)}`);
    }
    this.store.set(filePath, result.data);
  }

  exists(filePath: string): boolean {
    return this.store.has(filePath);
  }

  list<T>(dirPath: string, schema: z.ZodType<T>): T[] {
    const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
    const results: T[] = [];
    for (const [key, value] of this.store) {
      if (!key.startsWith(prefix)) continue;
      // Only list direct children (no deeper nesting)
      const remainder = key.slice(prefix.length);
      if (remainder.includes('/')) continue;
      const parsed = schema.safeParse(value);
      if (parsed.success) {
        results.push(parsed.data);
      }
    }
    return results;
  }

  /** No-op — in-memory storage has no directory concept. */
  ensureDir(_dirPath: string): void {}
}
