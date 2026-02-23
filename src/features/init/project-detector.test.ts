import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { detectProject } from './project-detector.js';

describe('detectProject', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `kata-detector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('projectType detection', () => {
    it('detects node when package.json exists', () => {
      writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'my-app' }));
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('node');
    });

    it('detects rust when Cargo.toml exists', () => {
      writeFileSync(join(baseDir, 'Cargo.toml'), '[package]\nname = "my-crate"');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('rust');
    });

    it('detects go when go.mod exists', () => {
      writeFileSync(join(baseDir, 'go.mod'), 'module example.com/myapp\n\ngo 1.21');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('go');
    });

    it('detects python when pyproject.toml exists', () => {
      writeFileSync(join(baseDir, 'pyproject.toml'), '[tool.poetry]\nname = "myapp"');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('python');
    });

    it('detects python when setup.py exists', () => {
      writeFileSync(join(baseDir, 'setup.py'), 'from setuptools import setup\nsetup(name="myapp")');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('python');
    });

    it('returns unknown when no known manifest exists', () => {
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('unknown');
    });

    it('prefers rust over node when both Cargo.toml and package.json exist', () => {
      writeFileSync(join(baseDir, 'Cargo.toml'), '[package]');
      writeFileSync(join(baseDir, 'package.json'), '{}');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('rust');
    });

    it('prefers go over node when both go.mod and package.json exist', () => {
      writeFileSync(join(baseDir, 'go.mod'), 'module x');
      writeFileSync(join(baseDir, 'package.json'), '{}');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('go');
    });

    it('prefers pyproject.toml over setup.py when both exist', () => {
      writeFileSync(join(baseDir, 'pyproject.toml'), '[tool]');
      writeFileSync(join(baseDir, 'setup.py'), '');
      const info = detectProject(baseDir);
      expect(info.projectType).toBe('python');
    });
  });

  describe('existing fields', () => {
    it('detects hasKata when .kata/ exists', () => {
      mkdirSync(join(baseDir, '.kata'));
      expect(detectProject(baseDir).hasKata).toBe(true);
    });

    it('detects hasGit when .git/ exists', () => {
      mkdirSync(join(baseDir, '.git'));
      expect(detectProject(baseDir).hasGit).toBe(true);
    });

    it('detects package name from package.json', () => {
      writeFileSync(join(baseDir, 'package.json'), JSON.stringify({ name: 'my-pkg' }));
      const info = detectProject(baseDir);
      expect(info.hasPackageJson).toBe(true);
      expect(info.packageName).toBe('my-pkg');
    });

    it('handles malformed package.json gracefully', () => {
      writeFileSync(join(baseDir, 'package.json'), 'not-valid-json');
      const info = detectProject(baseDir);
      expect(info.hasPackageJson).toBe(true);
      expect(info.packageName).toBeUndefined();
    });
  });
});
