import { RefNotFoundError, AmbiguousRefError } from '@shared/lib/errors.js';

/**
 * Resolve a human-friendly reference (name, short hash, "latest", or full UUID)
 * to a concrete item ID.
 *
 * Resolution order:
 *   1. Exact UUID match
 *   2. "latest" → most recent by createdAt
 *   3. Short hash (≤12 chars, hex-like) → prefix match on id
 *   4. Name match (case-insensitive)
 *
 * @throws {RefNotFoundError} If no match is found.
 * @throws {AmbiguousRefError} If multiple items match ambiguously.
 */
export function resolveRef<T extends { id: string; name?: string; createdAt?: string }>(
  input: string,
  items: T[],
  label = 'item',
): T {
  if (items.length === 0) {
    throw new RefNotFoundError(label, input);
  }

  // 1. Exact UUID match
  const exact = items.find((item) => item.id === input);
  if (exact) return exact;

  // 2. "latest" shortcut
  if (input === 'latest') {
    const sorted = items
      .filter((item) => item.createdAt !== undefined)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    if (sorted.length === 0) {
      throw new RefNotFoundError(label, input);
    }
    return sorted[0]!;
  }

  // 3. Short hash prefix match (4–12 hex-like chars from UUID start)
  if (input.length >= 4 && input.length <= 12 && /^[0-9a-f]+$/i.test(input)) {
    const lower = input.toLowerCase();
    const matches = items.filter((item) => item.id.toLowerCase().startsWith(lower));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new AmbiguousRefError(label, input, matches.length);
    }
    // Fall through to name match if no prefix matches
  }

  // 4. Name match (case-insensitive)
  const lower = input.toLowerCase();
  const nameMatches = items.filter((item) => item.name?.toLowerCase() === lower);
  if (nameMatches.length === 1) return nameMatches[0]!;
  if (nameMatches.length > 1) {
    throw new AmbiguousRefError(label, input, nameMatches.length);
  }

  throw new RefNotFoundError(label, input);
}
