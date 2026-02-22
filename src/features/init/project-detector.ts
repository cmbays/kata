import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KATA_DIRS } from '@shared/constants/paths.js';

export interface ProjectInfo {
  /** Whether a .kata/ directory already exists */
  hasKata: boolean;
  /** Whether a package.json exists */
  hasPackageJson: boolean;
  /** Whether a .git/ directory exists */
  hasGit: boolean;
  /** Package name from package.json, if available */
  packageName?: string;
}

/**
 * Detect project characteristics at a given directory.
 * Pure function that checks for .kata/, package.json, and .git/.
 */
export function detectProject(cwd: string): ProjectInfo {
  const hasKata = existsSync(join(cwd, KATA_DIRS.root));
  const hasGit = existsSync(join(cwd, '.git'));

  let hasPackageJson = false;
  let packageName: string | undefined;

  const packageJsonPath = join(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    hasPackageJson = true;
    try {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { name?: string };
      if (parsed.name) {
        packageName = parsed.name;
      }
    } catch {
      // package.json exists but is unreadable or invalid — still report hasPackageJson: true
    }
  }

  return { hasKata, hasPackageJson, hasGit, packageName };
}
