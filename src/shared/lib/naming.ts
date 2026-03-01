/**
 * Utilities for generating consistent teammate names in cycle-as-a-team execution.
 */

/**
 * Convert a string to a URL-safe slug.
 * Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim hyphens, truncate.
 */
export function slugify(input: string, maxLength = 20): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength)
    .replace(/-$/, ''); // trim trailing hyphen after truncation
}

/**
 * Generate a teammate agent name for cycle-as-a-team execution.
 *
 * Convention: `{bet-slug}/{kataka-name}` (e.g., `auth-fix/bugfix-ts`).
 * When `index` > 0, appends `-{index}` for disambiguation.
 *
 * @param betDescription - Human-readable bet title or description
 * @param katakaName - Name of the kataka being spawned
 * @param index - Optional disambiguation index (appended when > 0)
 */
export function generateTeammateName(
  betDescription: string,
  katakaName: string,
  index?: number,
): string {
  const betSlug = slugify(betDescription) || 'unnamed';
  const suffix = index && index > 0 ? `-${index}` : '';
  return `${betSlug}/${katakaName}${suffix}`;
}
