import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export type ScanDepth = 'basic' | 'full';

export interface DevTooling {
  testFramework: string[];
  linter: string[];
  formatter: string[];
  e2eFramework: string[];
  bundler: string[];
  typeChecker: string[];
}

export interface ClaudeAssets {
  skills: string[];
  agents: string[];
  mcpServers: string[];
}

export interface CiConfig {
  github: string[];
  other: string[];
}

export interface ProjectManifests {
  packageJson: boolean;
  cargoToml: boolean;
  goMod: boolean;
  pyproject: boolean;
  requirementsTxt: boolean;
}

export interface GitInsights {
  frequentlyModifiedFiles: Array<{ file: string; changeCount: number }>;
  reworkPatterns: string[];
}

export interface FrameworkGap {
  framework: string;
  recommendedTool: string;
  reason: string;
  detected: boolean;
}

export interface BasicScanResult {
  scanDepth: 'basic';
  projectType: string;
  packageName?: string;
  devTooling: DevTooling;
  claudeAssets: ClaudeAssets;
  ci: CiConfig;
  manifests: ProjectManifests;
}

export interface FullScanResult extends Omit<BasicScanResult, 'scanDepth'> {
  scanDepth: 'full';
  gitInsights?: GitInsights;
  frameworkGaps: FrameworkGap[];
}

export type ScanResult = BasicScanResult | FullScanResult;

// ---- Project type detection ----

const PROJECT_TYPE_MARKERS: Array<{ file: string; type: string }> = [
  { file: 'Cargo.toml', type: 'rust' },
  { file: 'go.mod', type: 'go' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'setup.py', type: 'python' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'package.json', type: 'node' },
];

function detectProjectType(cwd: string): string {
  for (const { file, type } of PROJECT_TYPE_MARKERS) {
    if (existsSync(join(cwd, file))) return type;
  }
  return 'unknown';
}

// ---- Dev tooling detection from package.json devDependencies ----

const TEST_FRAMEWORKS = ['vitest', 'jest', 'mocha', 'jasmine', 'ava', 'tap', 'tape'];
const LINTERS = ['eslint', 'tslint', 'biome', 'oxlint'];
const FORMATTERS = ['prettier', 'biome', 'dprint'];
const E2E_FRAMEWORKS = ['playwright', '@playwright/test', 'cypress', 'puppeteer', 'nightwatch', 'webdriverio'];
const BUNDLERS = ['vite', 'webpack', 'rollup', 'tsup', 'esbuild', 'parcel', 'turbopack'];
const TYPE_CHECKERS = ['typescript'];

function matchTools(deps: Record<string, string>, candidates: string[]): string[] {
  const depKeys = Object.keys(deps);
  return candidates.filter((t) => depKeys.some((dep) => dep === t || dep === `@${t}` || dep.startsWith(`@${t}/`)));
}

function detectDevTooling(cwd: string): DevTooling {
  const empty: DevTooling = {
    testFramework: [],
    linter: [],
    formatter: [],
    e2eFramework: [],
    bundler: [],
    typeChecker: [],
  };

  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return empty;

  let pkg: { devDependencies?: Record<string, string>; dependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return empty;
  }

  const allDeps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  return {
    testFramework: matchTools(allDeps, TEST_FRAMEWORKS),
    linter: matchTools(allDeps, LINTERS),
    formatter: matchTools(allDeps, FORMATTERS),
    e2eFramework: matchTools(allDeps, E2E_FRAMEWORKS),
    bundler: matchTools(allDeps, BUNDLERS),
    typeChecker: matchTools(allDeps, TYPE_CHECKERS),
  };
}

// ---- Claude assets ----

function listDir(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function detectClaudeAssets(cwd: string): ClaudeAssets {
  const claudeDir = join(cwd, '.claude');
  return {
    skills: listDir(join(claudeDir, 'skills')).filter((f) => f.endsWith('.md')),
    agents: listDir(join(claudeDir, 'agents')).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json')),
    mcpServers: listDir(join(claudeDir, 'mcp')).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml') || f.endsWith('.json')),
  };
}

// ---- CI configuration detection ----

function detectCi(cwd: string): CiConfig {
  const githubWorkflows = listDir(join(cwd, '.github', 'workflows'))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => `.github/workflows/${f}`);

  const other: string[] = [];
  for (const ciFile of ['.circleci/config.yml', '.travis.yml', 'Jenkinsfile', '.gitlab-ci.yml', 'azure-pipelines.yml']) {
    if (existsSync(join(cwd, ciFile))) other.push(ciFile);
  }

  return { github: githubWorkflows, other };
}

// ---- Manifest detection ----

function detectManifests(cwd: string): ProjectManifests {
  return {
    packageJson: existsSync(join(cwd, 'package.json')),
    cargoToml: existsSync(join(cwd, 'Cargo.toml')),
    goMod: existsSync(join(cwd, 'go.mod')),
    pyproject: existsSync(join(cwd, 'pyproject.toml')),
    requirementsTxt: existsSync(join(cwd, 'requirements.txt')),
  };
}

// ---- Package name ----

function readPackageName(cwd: string): string | undefined {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return undefined;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { name?: string };
    return pkg.name;
  } catch {
    return undefined;
  }
}

// ---- Git history analysis (full scan only) ----

function analyzeGitHistory(cwd: string): GitInsights | undefined {
  if (!existsSync(join(cwd, '.git'))) return undefined;

  // Use spawnSync with fixed args — no user input, shell injection not possible
  const result = spawnSync(
    'git',
    ['log', '--name-only', '--oneline', '-200'],
    { cwd, encoding: 'utf-8', timeout: 10_000 },
  );
  if (result.status !== 0 || !result.stdout) return undefined;

  const fileCounts = new Map<string, number>();
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    // Skip commit header lines (contain a space: "hash message")
    if (!trimmed || trimmed.includes(' ')) continue;
    fileCounts.set(trimmed, (fileCounts.get(trimmed) ?? 0) + 1);
  }

  const sorted = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([file, changeCount]) => ({ file, changeCount }));

  // Files changed > 5 times indicate rework-prone areas
  const reworkPatterns = sorted.filter((e) => e.changeCount > 5).map((e) => e.file);

  return { frequentlyModifiedFiles: sorted, reworkPatterns };
}

// ---- Framework-aware gap detection (full scan only) ----

type FrameworkGapSpec = {
  detectKey: string;
  recommendedTool: string;
  checkKey: string;
  reason: string;
};

const FRAMEWORK_GAP_SPECS: FrameworkGapSpec[] = [
  {
    detectKey: 'next',
    recommendedTool: 'playwright',
    checkKey: 'playwright',
    reason: 'Next.js apps benefit from E2E tests with Playwright',
  },
  {
    detectKey: 'react',
    recommendedTool: 'playwright',
    checkKey: 'playwright',
    reason: 'React apps benefit from E2E tests with Playwright',
  },
  {
    detectKey: 'express',
    recommendedTool: 'vitest',
    checkKey: 'vitest',
    reason: 'Express apps benefit from unit tests with Vitest',
  },
  {
    detectKey: 'typescript',
    recommendedTool: 'eslint',
    checkKey: 'eslint',
    reason: 'TypeScript projects benefit from ESLint for static analysis',
  },
];

function detectFrameworkGaps(cwd: string): FrameworkGap[] {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return [];

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as typeof pkg;
  } catch {
    return [];
  }
  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depKeys = Object.keys(allDeps).map((k) => k.toLowerCase());

  return FRAMEWORK_GAP_SPECS
    .filter((spec) => depKeys.some((k) => k === spec.detectKey || k.includes(spec.detectKey)))
    .map((spec) => ({
      framework: spec.detectKey,
      recommendedTool: spec.recommendedTool,
      reason: spec.reason,
      detected: depKeys.some((k) => k === spec.checkKey || k.includes(spec.checkKey)),
    }));
}

// ---- Public API ----

/**
 * Perform a project scan, collecting metadata without modifying any files.
 * Safe to run before or after kata init.
 */
export function scanProject(cwd: string, depth: ScanDepth = 'basic'): ScanResult {
  const projectType = detectProjectType(cwd);
  const packageName = readPackageName(cwd);
  const devTooling = detectDevTooling(cwd);
  const claudeAssets = detectClaudeAssets(cwd);
  const ci = detectCi(cwd);
  const manifests = detectManifests(cwd);

  const basic: BasicScanResult = {
    scanDepth: 'basic',
    projectType,
    packageName,
    devTooling,
    claudeAssets,
    ci,
    manifests,
  };

  if (depth === 'basic') return basic;

  const gitInsights = analyzeGitHistory(cwd);
  const frameworkGaps = detectFrameworkGaps(cwd);
  return { ...basic, scanDepth: 'full', gitInsights, frameworkGaps };
}
