import { join, dirname } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';

/**
 * How this kata session was launched.
 * - "agent"       — KATA_RUN_ID is set → running inside a structured agent run
 * - "ci"          — CI=true (or CI=1) is set → running in a CI pipeline
 * - "interactive" — default; no special env vars present
 */
export type LaunchMode = 'interactive' | 'agent' | 'ci';

/**
 * Session context detected at startup — tells the sensei what mode we're in.
 */
export interface SessionContext {
  /** Whether a .kata/ directory was found */
  kataInitialized: boolean;
  /** Absolute path to the .kata/ directory, or null */
  kataDir: string | null;
  /** Whether the session is running inside a git worktree */
  inWorktree: boolean;
  /** Active cycle info, or null if none */
  activeCycle: { id: string; name: string } | null;
  /** How this session was launched */
  launchMode: LaunchMode;
}

/**
 * Detect the launch mode from environment variables.
 *
 * - KATA_RUN_ID present → "agent" (running inside a structured kata run)
 * - CI=true or CI=1 → "ci"
 * - otherwise → "interactive"
 */
export function detectLaunchMode(): LaunchMode {
  if (process.env['KATA_RUN_ID']) return 'agent';
  const ci = process.env['CI'];
  if (ci === 'true' || ci === '1') return 'ci';
  return 'interactive';
}

/**
 * Detect the session context by examining the filesystem.
 *
 * 1. Walk up from CWD looking for .kata/ → kataInitialized, kataDir
 * 2. Check if CWD is inside a git worktree → inWorktree
 * 3. If kata initialized, find the active cycle → activeCycle
 * 4. Detect launch mode from env vars → launchMode
 */
export function detectSessionContext(cwd?: string): SessionContext {
  const startDir = cwd ?? process.cwd();

  // 1. Find .kata/ directory
  const kataDir = findKataDir(startDir);
  const kataInitialized = kataDir !== null;

  // 2. Detect worktree
  const inWorktree = detectWorktree(startDir);

  // 3. Find active cycle
  let activeCycle: { id: string; name: string } | null = null;
  if (kataDir) {
    activeCycle = findActiveCycle(kataDir);
  }

  // 4. Detect launch mode
  const launchMode = detectLaunchMode();

  return { kataInitialized, kataDir, inWorktree, activeCycle, launchMode };
}

/**
 * Walk up from startDir looking for a .kata/ directory.
 * Returns the absolute path to .kata/ or null.
 */
function findKataDir(startDir: string): string | null {
  let dir = startDir;

  while (true) {
    const candidate = join(dir, KATA_DIRS.root);
    if (existsSync(candidate)) {
      try {
        const stat = statSync(candidate);
        if (stat.isDirectory()) return candidate;
      } catch {
        // Not accessible, keep walking
      }
    }

    const parent = dirname(dir);
    if (parent === dir) break; // Hit filesystem root
    dir = parent;
  }

  return null;
}

/**
 * Detect whether the current directory is inside a git worktree.
 *
 * A linked worktree has a .git FILE (not directory) pointing to the main
 * repo's .git/worktrees/<name>/ directory.
 */
function detectWorktree(startDir: string): boolean {
  try {
    // First check: is this even a git repo?
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: startDir,
      stdio: 'pipe',
      timeout: 5000,
    });

    // Second check: find the .git entry at the repo root
    const gitDir = execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd: startDir,
      stdio: 'pipe',
      timeout: 5000,
    }).toString().trim();

    // In a linked worktree, git-dir returns an absolute path inside
    // .git/worktrees/<name>. In the main worktree, it returns ".git".
    if (gitDir !== '.git' && gitDir.includes('worktrees')) {
      return true;
    }

    // Also check for .git file (symlink-like) at the repo root
    const topLevel = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      stdio: 'pipe',
      timeout: 5000,
    }).toString().trim();

    const dotGitPath = join(topLevel, '.git');
    if (existsSync(dotGitPath)) {
      try {
        const stat = statSync(dotGitPath);
        if (stat.isFile()) return true; // .git file = linked worktree
      } catch {
        // Can't stat, assume not worktree
      }
    }

    return false;
  } catch {
    // Not in a git repo at all
    return false;
  }
}

/**
 * Find the active cycle in a .kata/ directory.
 */
function findActiveCycle(kataDir: string): { id: string; name: string } | null {
  try {
    const cyclesDir = join(kataDir, KATA_DIRS.cycles);
    if (!existsSync(cyclesDir)) return null;

    const manager = new CycleManager(cyclesDir, JsonStore);
    const cycles = manager.list();
    const active = cycles.find((c) => c.state === 'active');

    if (active) {
      return { id: active.id, name: active.name ?? active.id };
    }

    return null;
  } catch {
    return null;
  }
}
