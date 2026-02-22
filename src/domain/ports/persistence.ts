import type { z } from 'zod/v4';

/**
 * Port interface for typed JSON persistence.
 *
 * The current contract is intentionally file-path-oriented to match the
 * JsonStore implementation. If a key/collection abstraction is ever needed
 * (e.g., SQLite, remote storage), this interface should be revisited.
 *
 * For unit tests that don't need real I/O, use MemoryPersistence from
 * `@infra/persistence/memory-persistence.js`.
 */
export interface IPersistence {
  read<T>(filePath: string, schema: z.ZodType<T>): T;
  write<T>(filePath: string, data: T, schema: z.ZodType<T>): void;
  exists(filePath: string): boolean;
  list<T>(dirPath: string, schema: z.ZodType<T>): T[];
  ensureDir(dirPath: string): void;
}
