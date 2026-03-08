/**
 * Build-freshness guard.
 *
 * Compares the mtime of the newest `.ts` file under `src/` against the mtime
 * of the CLI entry in `dist/cli/index.js`.  If dist is older than src, a
 * yellow warning is printed to stderr so operators know they should rebuild
 * before dispatching agents.
 *
 * This is intentionally non-blocking: the warning is advisory only.
 * Uses only Node.js built-ins (fs, path, url) — no external dependencies.
 */

import { statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk `dir` recursively and return the highest mtime (ms) found across all
 * files matching `ext`.  Returns 0 if no matching files are found.
 */
function newestMtime(dir: string, ext: string): number {
  let max = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        const child = newestMtime(full, ext);
        if (child > max) max = child;
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        try {
          const t = statSync(full).mtimeMs;
          if (t > max) max = t;
        } catch {
          // Unreadable file — skip
        }
      }
    }
  } catch {
    // Unreadable directory — skip
  }
  return max;
}

/**
 * Check whether dist/ is stale relative to src/ and warn if so.
 *
 * The sentinel for dist/ is `dist/cli/index.js` — the actual binary entry.
 * The project root is derived from `import.meta.url` at runtime so the check
 * works regardless of which directory the CLI is invoked from.
 *
 * This function never throws; any unexpected error is silently swallowed so
 * the guard cannot break the CLI.
 */
export function warnIfDistStale(): void {
  try {
    // dist/cli/index.js → dist/cli/ → dist/ → project root
    const distCliEntry = fileURLToPath(import.meta.url);
    // When compiled: dist/cli/dist-freshness.js
    const distCliDir = dirname(distCliEntry);   // dist/cli/
    const distDir = dirname(distCliDir);         // dist/
    const projectRoot = dirname(distDir);        // project root

    const srcDir = join(projectRoot, 'src');
    const distSentinel = join(distCliDir, 'index.js');

    // Newest .ts file mtime in src/
    const srcMtime = newestMtime(srcDir, '.ts');
    if (srcMtime === 0) return; // src/ not found — dev environment quirk, skip

    // mtime of the dist sentinel
    let distMtime: number;
    try {
      distMtime = statSync(distSentinel).mtimeMs;
    } catch {
      // dist/cli/index.js doesn't exist — running via tsx/ts-node, skip
      return;
    }

    if (srcMtime > distMtime) {
      process.stderr.write(
        '\x1b[33m⚠ dist may be stale — run "npm run build" before dispatching agents\x1b[0m\n',
      );
    }
  } catch {
    // Never let the freshness check crash the CLI
  }
}
