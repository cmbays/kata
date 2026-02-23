import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateAoConfig, detectGitBranch, deriveProjectKey } from './ao-config-generator.js';

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `kata-ao-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('deriveProjectKey', () => {
  it('returns packageName when provided', () => {
    expect(deriveProjectKey('@withkata/core', '/any/path')).toBe('@withkata/core');
  });

  it('returns basename of cwd when packageName is undefined', () => {
    expect(deriveProjectKey(undefined, '/home/user/my-project')).toBe('my-project');
  });

  it('returns basename of cwd when packageName is empty string (falsy)', () => {
    // undefined check: empty string is falsy, so ?? would not trigger; '' ?? '/fallback' === ''
    // But undefined uses ??
    expect(deriveProjectKey(undefined, '/projects/kata')).toBe('kata');
  });
});

describe('detectGitBranch', () => {
  it('returns "main" when .git/HEAD does not exist', () => {
    expect(detectGitBranch(tempDir)).toBe('main');
  });

  it('parses branch from ref: refs/heads/<branch>', () => {
    mkdirSync(join(tempDir, '.git'));
    writeFileSync(join(tempDir, '.git', 'HEAD'), 'ref: refs/heads/feat/adapters\n');
    expect(detectGitBranch(tempDir)).toBe('feat/adapters');
  });

  it('returns "main" when HEAD is detached (bare SHA)', () => {
    mkdirSync(join(tempDir, '.git'));
    writeFileSync(join(tempDir, '.git', 'HEAD'), 'abc1234567890\n');
    expect(detectGitBranch(tempDir)).toBe('main');
  });

  it('returns "main" when HEAD file is empty', () => {
    mkdirSync(join(tempDir, '.git'));
    writeFileSync(join(tempDir, '.git', 'HEAD'), '');
    expect(detectGitBranch(tempDir)).toBe('main');
  });
});

describe('generateAoConfig', () => {
  it('writes a YAML file to the given outputPath', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'my-project', repoPath: tempDir, outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain('projects:');
  });

  it('includes the projectKey in the YAML', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'my-project', repoPath: tempDir, outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain("'my-project':");
  });

  it('includes the repoPath in the YAML', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'proj', repoPath: '/home/user/kata', outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain("'/home/user/kata'");
  });

  it('uses provided branch', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'proj', repoPath: tempDir, branch: 'develop', outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain("'develop'");
  });

  it('defaults branch to "main" when not provided', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'proj', repoPath: tempDir, outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain("'main'");
  });

  it('includes .kata symlink entry', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'proj', repoPath: tempDir, outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain('- .kata');
  });

  it('single-quote escapes projectKey containing single quotes', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: "it's-a-project", repoPath: tempDir, outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    // YAML single-quote escaping: ' → ''
    expect(raw).toContain("'it''s-a-project':");
  });

  it('single-quote escapes repoPath containing single quotes', () => {
    const outputPath = join(tempDir, 'ao-config.yaml');
    generateAoConfig({ projectKey: 'proj', repoPath: "/home/o'malley/kata", outputPath });

    const raw = readFileSync(outputPath, 'utf-8');
    expect(raw).toContain("'/home/o''malley/kata'");
  });
});
