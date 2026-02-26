import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scanProject } from './scan-handler.js';

describe('scanProject', () => {
  const baseDir = join(tmpdir(), `kata-scan-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  // ---- project type detection ----

  it('detects node project from package.json', () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('node');
    expect(result.packageName).toBe('my-app');
  });

  it('detects rust project from Cargo.toml (priority over package.json)', () => {
    writeFileSync(join(baseDir, 'Cargo.toml'), '[package]\nname = "my-crate"');
    writeFileSync(join(baseDir, 'package.json'), '{}');
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('rust');
  });

  it('detects go project from go.mod', () => {
    writeFileSync(join(baseDir, 'go.mod'), 'module example.com/app');
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('go');
  });

  it('detects python project from pyproject.toml', () => {
    writeFileSync(join(baseDir, 'pyproject.toml'), '[tool.poetry]\nname = "app"');
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('python');
  });

  it('detects python from requirements.txt when no pyproject.toml', () => {
    writeFileSync(join(baseDir, 'requirements.txt'), 'flask==2.0.0');
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('python');
  });

  it('returns unknown for empty directory', () => {
    const result = scanProject(baseDir);
    expect(result.projectType).toBe('unknown');
  });

  // ---- dev tooling detection ----

  it('detects test frameworks from devDependencies', () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0', eslint: '^8.0.0', prettier: '^3.0.0', typescript: '^5.0.0' },
    }));
    const result = scanProject(baseDir);
    expect(result.devTooling.testFramework).toContain('vitest');
    expect(result.devTooling.linter).toContain('eslint');
    expect(result.devTooling.formatter).toContain('prettier');
    expect(result.devTooling.typeChecker).toContain('typescript');
  });

  it('detects e2e frameworks and bundlers', () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({
      devDependencies: { playwright: '^1.0.0', tsup: '^8.0.0' },
    }));
    const result = scanProject(baseDir);
    expect(result.devTooling.e2eFramework).toContain('playwright');
    expect(result.devTooling.bundler).toContain('tsup');
  });

  it('returns empty tooling arrays when no package.json', () => {
    const result = scanProject(baseDir);
    expect(result.devTooling.testFramework).toEqual([]);
    expect(result.devTooling.linter).toEqual([]);
  });

  // ---- claude assets ----

  it('lists .claude/skills, agents, and mcp files', () => {
    mkdirSync(join(baseDir, '.claude', 'skills'), { recursive: true });
    mkdirSync(join(baseDir, '.claude', 'agents'), { recursive: true });
    mkdirSync(join(baseDir, '.claude', 'mcp'), { recursive: true });
    writeFileSync(join(baseDir, '.claude', 'skills', 'orchestration.md'), '# skill');
    writeFileSync(join(baseDir, '.claude', 'agents', 'reviewer.yml'), 'agent: reviewer');
    writeFileSync(join(baseDir, '.claude', 'mcp', 'github.json'), '{}');
    const result = scanProject(baseDir);
    expect(result.claudeAssets.skills).toContain('orchestration.md');
    expect(result.claudeAssets.agents).toContain('reviewer.yml');
    expect(result.claudeAssets.mcpServers).toContain('github.json');
  });

  it('returns empty arrays when .claude dir is absent', () => {
    const result = scanProject(baseDir);
    expect(result.claudeAssets.skills).toEqual([]);
    expect(result.claudeAssets.agents).toEqual([]);
    expect(result.claudeAssets.mcpServers).toEqual([]);
  });

  // ---- CI detection ----

  it('detects GitHub Actions workflows', () => {
    mkdirSync(join(baseDir, '.github', 'workflows'), { recursive: true });
    writeFileSync(join(baseDir, '.github', 'workflows', 'ci.yml'), 'on: push');
    const result = scanProject(baseDir);
    expect(result.ci.github).toContain('.github/workflows/ci.yml');
  });

  it('detects other CI configs', () => {
    writeFileSync(join(baseDir, '.travis.yml'), 'language: node_js');
    const result = scanProject(baseDir);
    expect(result.ci.other).toContain('.travis.yml');
  });

  it('returns empty ci when no CI files present', () => {
    const result = scanProject(baseDir);
    expect(result.ci.github).toEqual([]);
    expect(result.ci.other).toEqual([]);
  });

  // ---- manifest flags ----

  it('reports correct manifest flags', () => {
    writeFileSync(join(baseDir, 'package.json'), '{}');
    const result = scanProject(baseDir);
    expect(result.manifests.packageJson).toBe(true);
    expect(result.manifests.cargoToml).toBe(false);
    expect(result.manifests.goMod).toBe(false);
  });

  // ---- scan depth ----

  it('returns basic result for basic depth', () => {
    const result = scanProject(baseDir, 'basic');
    expect(result.scanDepth).toBe('basic');
    expect('frameworkGaps' in result).toBe(false);
  });

  it('returns full result for full depth with frameworkGaps', () => {
    const result = scanProject(baseDir, 'full');
    expect(result.scanDepth).toBe('full');
    if (result.scanDepth === 'full') {
      expect(Array.isArray(result.frameworkGaps)).toBe(true);
    }
  });

  it('detects framework gaps for TypeScript projects', () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '^5.0.0' },
    }));
    const result = scanProject(baseDir, 'full');
    if (result.scanDepth === 'full') {
      const tsGap = result.frameworkGaps.find((g) => g.framework === 'typescript');
      expect(tsGap).toBeDefined();
      expect(tsGap?.recommendedTool).toBe('eslint');
    }
  });

  it('marks gap as detected when recommended tool is present', () => {
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({
      devDependencies: { typescript: '^5.0.0', eslint: '^8.0.0' },
    }));
    const result = scanProject(baseDir, 'full');
    if (result.scanDepth === 'full') {
      const tsGap = result.frameworkGaps.find((g) => g.framework === 'typescript');
      expect(tsGap?.detected).toBe(true);
    }
  });
});
