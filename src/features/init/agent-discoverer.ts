import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { KatakaSchema, type Kataka } from '@domain/types/kataka.js';
import { KatakaRegistry } from '@infra/registries/kataka-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Path segments ignored when inferring skills from directory names. */
const IGNORE_SEGMENT = new Set(['src', 'lib', 'app', 'packages', 'apps', 'services', 'agents', 'kataka']);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoveredAgent {
  /** Human-readable name inferred from filename or CLAUDE.md declaration. */
  name: string;
  /** Source file or config where this agent was found. */
  source: string;
  /** Inferred skills from filename patterns. */
  skills: string[];
}

export interface AgentDiscoveryResult {
  discovered: number;
  registered: number;
  agents: Array<{ name: string; id: string; source: string }>;
}

// ---------------------------------------------------------------------------
// File pattern scanning
// ---------------------------------------------------------------------------

/**
 * Walk a directory tree for files matching the given patterns.
 * Uses withFileTypes to distinguish files from directories.
 * Respects common ignore directories (.git, node_modules, dist, .kata).
 */
function walkDir(dir: string, patterns: RegExp[], maxDepth = 5): string[] {
  const IGNORE_DIRS = new Set(['.git', 'node_modules', 'dist', '.kata', '.claude', 'coverage', '.turbo']);
  const results: string[] = [];

  function recurse(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          recurse(join(current, entry.name), depth + 1);
        }
      } else if (entry.isFile()) {
        if (patterns.some((p) => p.test(entry.name))) {
          results.push(join(current, entry.name));
        }
      }
    }
  }

  recurse(dir, 0);
  return results;
}

// ---------------------------------------------------------------------------
// CLAUDE.md agent declarations
// ---------------------------------------------------------------------------

const AGENT_DECLARATION_RE = /##\s+(?:Agent|kataka):\s+([^\n]+)/gi;

/**
 * Parse CLAUDE.md for agent declarations of the form:
 *   ## Agent: <Name>
 *   ## kataka: <Name>
 *
 * Returns a list of { name, source } objects.
 */
function parseClaudeMdAgents(filePath: string): Array<{ name: string; source: string }> {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const found: Array<{ name: string; source: string }> = [];
  for (const match of content.matchAll(AGENT_DECLARATION_RE)) {
    const name = match[1]?.trim();
    if (name) {
      found.push({ name, source: filePath });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Name derivation from filename
// ---------------------------------------------------------------------------

/**
 * Derive a human-readable name from a filename.
 * e.g. "frontend-agent.ts" → "FrontendAgent"
 *      "seki.kataka.ts"    → "Seki"
 */
function nameFromFile(filename: string): string {
  const base = filename
    .replace(/\.(agent|kataka)\.(ts|js|mts|mjs)$/, '')
    .replace(/\.(ts|js|mts|mjs)$/, '');

  return base
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Scan the project for agent-like patterns and auto-register discovered kataka.
 *
 * Looks for:
 * - `*.agent.ts` / `*.agent.js` files
 * - `*.kataka.ts` / `*.kataka.js` files
 * - CLAUDE.md files with `## Agent:` or `## kataka:` declarations
 *
 * @param cwd     Project root to scan
 * @param kataDir Path to the .kata/ directory (used to locate kataka registry)
 * @returns summary of discovered and registered agents
 */
export function discoverAndRegisterAgents(cwd: string, kataDir: string): AgentDiscoveryResult {
  const discovered: DiscoveredAgent[] = [];

  // 1. Scan for *.agent.ts / *.kataka.ts files
  const agentFilePatterns = [
    /\.agent\.(ts|js|mts|mjs)$/,
    /\.kataka\.(ts|js|mts|mjs)$/,
  ];
  const agentFiles = walkDir(cwd, agentFilePatterns);

  for (const filePath of agentFiles) {
    const basename = filePath.split('/').pop() ?? filePath;
    const name = nameFromFile(basename);
    const skills: string[] = [];

    // Infer skills from path segments (e.g. "frontend" directory → "frontend" skill)
    const pathParts = filePath.replace(cwd, '').split('/').filter(Boolean);
    for (const part of pathParts.slice(0, -1)) {
      if (!IGNORE_SEGMENT.has(part)) {
        skills.push(part);
      }
    }

    if (name) {
      discovered.push({ name, source: filePath, skills });
    }
  }

  // 2. Scan CLAUDE.md files for agent declarations
  const claudeMdFiles = walkDir(cwd, [/^CLAUDE\.md$/]);
  for (const filePath of claudeMdFiles) {
    const declarations = parseClaudeMdAgents(filePath);
    for (const decl of declarations) {
      discovered.push({ name: decl.name, source: decl.source, skills: [] });
    }
  }

  // 3. Deduplicate by name (case-insensitive)
  const seen = new Map<string, DiscoveredAgent>();
  for (const agent of discovered) {
    const key = agent.name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, agent);
    }
  }
  const unique = Array.from(seen.values());

  // 4. Register discovered kataka
  const katakaDir = join(kataDir, KATA_DIRS.kataka);
  JsonStore.ensureDir(katakaDir);
  const registry = new KatakaRegistry(katakaDir);

  const registered: Array<{ name: string; id: string; source: string }> = [];

  for (const agent of unique) {
    try {
      const kataka: Kataka = KatakaSchema.parse({
        id: randomUUID(),
        name: agent.name,
        role: 'executor' as const,
        skills: agent.skills,
        description: `Auto-registered from ${agent.source.replace(cwd, '').replace(/^\//, '')}`,
        createdAt: new Date().toISOString(),
        active: true,
      });
      registry.register(kataka);
      registered.push({ name: kataka.name, id: kataka.id, source: agent.source });
    } catch (err) {
      logger.warn(`Could not register discovered agent "${agent.name}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    discovered: unique.length,
    registered: registered.length,
    agents: registered,
  };
}
