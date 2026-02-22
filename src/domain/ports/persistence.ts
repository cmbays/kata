import type { z } from 'zod/v4';

export interface IPersistence {
  read<T>(filePath: string, schema: z.ZodType<T>): T;
  write<T>(filePath: string, data: T, schema: z.ZodType<T>): void;
  exists(filePath: string): boolean;
  list<T>(dirPath: string, schema: z.ZodType<T>): T[];
  ensureDir(dirPath: string): void;
}
