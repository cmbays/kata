import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KATA_DIRS } from '@shared/constants/paths.js';

export type ProjectType = 'node' | 'rust' | 'go' | 'python' | 'unknown';

export interface ProjectInfo {
  /** Whether a .kata/ directory already exists */
  hasKata: boolean;
  /** Whether a package.json exists */
  hasPackageJson: boolean;
  /** Whether a .git/ directory exists */
  hasGit: boolean;
  /** Package name from package.json, if available */
  packageName?: string;
  /** Detected project type based on manifest files */
  projectType: ProjectType;
}

const PROJECT_TYPE_MARKERS: Array<{ file: string; type: ProjectType }> = [
  { file: 'Cargo.toml', type: 'rust' },
  { file: 'go.mod', type: 'go' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'setup.py', type: 'python' },
  { file: 'package.json', type: 'node' },
];

/**
 * Detect project characteristics at a given directory.
 * Pure function that checks for .kata/, package.json, .git/, and project-type markers.
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

  const projectType = detectProjectType(cwd);

  return { hasKata, hasPackageJson, hasGit, packageName, projectType };
}

/**
 * Detect the project type from well-known manifest files.
 * Returns the first match in priority order: Rust > Go > Python > Node > unknown.
 */
function detectProjectType(cwd: string): ProjectType {
  for (const { file, type } of PROJECT_TYPE_MARKERS) {
    if (existsSync(join(cwd, file))) {
      return type;
    }
  }
  return 'unknown';
}
