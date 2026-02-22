import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { detectProject } from './project-detector.js';

describe('detectProject', () => {
  const baseDir = join(tmpdir(), `kata-detector-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('detects empty directory with no markers', () => {
    const result = detectProject(baseDir);
    expect(result).toEqual({
      hasKata: false,
      hasPackageJson: false,
      hasGit: false,
      packageName: undefined,
    });
  });

  it('detects .kata/ directory', () => {
    mkdirSync(join(baseDir, '.kata'));
    const result = detectProject(baseDir);
    expect(result.hasKata).toBe(true);
  });

  it('detects .git/ directory', () => {
    mkdirSync(join(baseDir, '.git'));
    const result = detectProject(baseDir);
    expect(result.hasGit).toBe(true);
  });

  it('detects package.json and extracts name', () => {
    writeFileSync(
      join(baseDir, 'package.json'),
      JSON.stringify({ name: 'my-cool-project', version: '1.0.0' }),
    );
    const result = detectProject(baseDir);
    expect(result.hasPackageJson).toBe(true);
    expect(result.packageName).toBe('my-cool-project');
  });

  it('handles package.json without name field', () => {
    writeFileSync(
      join(baseDir, 'package.json'),
      JSON.stringify({ version: '1.0.0' }),
    );
    const result = detectProject(baseDir);
    expect(result.hasPackageJson).toBe(true);
    expect(result.packageName).toBeUndefined();
  });

  it('handles invalid JSON in package.json', () => {
    writeFileSync(join(baseDir, 'package.json'), 'not valid json {{');
    const result = detectProject(baseDir);
    expect(result.hasPackageJson).toBe(true);
    expect(result.packageName).toBeUndefined();
  });

  it('detects all markers together', () => {
    mkdirSync(join(baseDir, '.kata'));
    mkdirSync(join(baseDir, '.git'));
    writeFileSync(
      join(baseDir, 'package.json'),
      JSON.stringify({ name: 'full-project' }),
    );

    const result = detectProject(baseDir);
    expect(result).toEqual({
      hasKata: true,
      hasPackageJson: true,
      hasGit: true,
      packageName: 'full-project',
    });
  });
});
