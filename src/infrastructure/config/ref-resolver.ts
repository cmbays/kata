import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export class RefResolutionError extends Error {
  constructor(
    message: string,
    public readonly ref: string,
    public readonly resolvedPath: string,
  ) {
    super(message);
    this.name = 'RefResolutionError';
  }
}

/**
 * Resolve a file reference to its contents.
 * Used for $ref-style paths in stage definitions (e.g., promptTemplate paths).
 */
export const RefResolver = {
  /**
   * Read the file at `basePath/ref` and return its contents as a string.
   * @param ref - Relative path to resolve (e.g., "../prompts/research.md")
   * @param basePath - Base directory to resolve relative to
   * @throws RefResolutionError if the referenced file does not exist
   */
  resolveRef(ref: string, basePath: string): string {
    const resolvedPath = resolve(join(basePath, ref));

    if (!existsSync(resolvedPath)) {
      throw new RefResolutionError(
        `Referenced file not found: "${ref}" (resolved to "${resolvedPath}")`,
        ref,
        resolvedPath,
      );
    }

    try {
      return readFileSync(resolvedPath, 'utf-8');
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new RefResolutionError(
        `Failed to read referenced file: "${ref}" (resolved to "${resolvedPath}"): ${reason}`,
        ref,
        resolvedPath,
      );
    }
  },
};
