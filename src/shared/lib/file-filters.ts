/**
 * Shared file-filtering predicates used across layers.
 */

export function isJsonFile(filename: string): boolean {
  return filename.endsWith('.json');
}
