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
 * @throws {Error} If no match is found or multiple ambiguous matches exist.
 */
export function resolveRef<T extends { id: string; name?: string; createdAt?: string }>(
  input: string,
  items: T[],
  label = 'item',
): T {
  if (items.length === 0) {
    throw new Error(`No ${label}s found.`);
  }

  // 1. Exact UUID match
  const exact = items.find((item) => item.id === input);
  if (exact) return exact;

  // 2. "latest" shortcut
  if (input === 'latest') {
    const sorted = items
      .filter((item) => item.createdAt !== undefined)
      .sort((a, b) => b.createdAt!.localeCompare(a.createdAt!));
    if (sorted.length === 0) {
      throw new Error(`Cannot resolve "latest": no ${label}s have a createdAt timestamp.`);
    }
    return sorted[0]!;
  }

  // 3. Short hash prefix match (8-12 hex-like chars from UUID start)
  if (input.length >= 4 && input.length <= 12 && /^[0-9a-f]+$/i.test(input)) {
    const lower = input.toLowerCase();
    const matches = items.filter((item) => item.id.toLowerCase().startsWith(lower));
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(
        `Ambiguous ${label} reference "${input}": matches ${matches.length} ${label}s. Use more characters or the full UUID.`,
      );
    }
    // Fall through to name match if no prefix matches
  }

  // 4. Name match (case-insensitive)
  const lower = input.toLowerCase();
  const nameMatches = items.filter((item) => item.name?.toLowerCase() === lower);
  if (nameMatches.length === 1) return nameMatches[0]!;
  if (nameMatches.length > 1) {
    throw new Error(
      `Ambiguous ${label} name "${input}": matches ${nameMatches.length} ${label}s.`,
    );
  }

  throw new Error(
    `${label.charAt(0).toUpperCase() + label.slice(1)} "${input}" not found. Use "kata cycle status" to see available ${label}s.`,
  );
}
