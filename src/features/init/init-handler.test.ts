import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { handleInit } from './init-handler.js';
import { KataConfigSchema } from '@domain/types/config.js';

// Mock @inquirer/prompts globally
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
}));

describe('handleInit', () => {
  const baseDir = join(tmpdir(), `kata-init-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('creates .kata/ directory structure', async () => {
    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    expect(existsSync(join(baseDir, '.kata'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'stages'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'templates'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'cycles'))).toBe(true);
    expect(existsSync(join(baseDir, '.kata', 'knowledge'))).toBe(true);
    expect(result.kataDir).toBe(join(baseDir, '.kata'));
  });

  it('writes config.json with default values', async () => {
    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    expect(result.config.methodology).toBe('shape-up');
    expect(result.config.execution.adapter).toBe('manual');

    // Verify config was persisted
    const configPath = join(baseDir, '.kata', 'config.json');
    expect(existsSync(configPath)).toBe(true);
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = KataConfigSchema.parse(JSON.parse(raw));
    expect(parsed.methodology).toBe('shape-up');
  });

  it('uses specified methodology and adapter', async () => {
    const result = await handleInit({
      cwd: baseDir,
      methodology: 'custom',
      adapter: 'claude-cli',
      skipPrompts: true,
    });

    expect(result.config.methodology).toBe('custom');
    expect(result.config.execution.adapter).toBe('claude-cli');
  });

  it('detects package name from package.json', async () => {
    writeFileSync(
      join(baseDir, 'package.json'),
      JSON.stringify({ name: 'test-project', version: '1.0.0' }),
    );

    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    expect(result.config.project.name).toBe('test-project');
  });

  it('loads built-in stages', async () => {
    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    // Should load the builtin stages from stages/builtin/ at package root
    expect(result.stagesLoaded).toBeGreaterThan(0);
  });

  it('loads pipeline templates', async () => {
    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    // Should load templates from templates/ at package root
    expect(result.templatesLoaded).toBeGreaterThan(0);
  });

  it('uses interactive prompts when skipPrompts is false', async () => {
    const { select } = await import('@inquirer/prompts');
    const mockSelect = vi.mocked(select);
    mockSelect
      .mockResolvedValueOnce('shape-up')
      .mockResolvedValueOnce('composio');

    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: false,
    });

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(result.config.methodology).toBe('shape-up');
    expect(result.config.execution.adapter).toBe('composio');
  });

  it('skips prompts when methodology and adapter are provided', async () => {
    const { select } = await import('@inquirer/prompts');
    const mockSelect = vi.mocked(select);
    mockSelect.mockClear();

    const result = await handleInit({
      cwd: baseDir,
      methodology: 'shape-up',
      adapter: 'manual',
      skipPrompts: false,
    });

    // Should not prompt when both values are already specified
    expect(mockSelect).not.toHaveBeenCalled();
    expect(result.config.methodology).toBe('shape-up');
  });

  it('detects git repository', async () => {
    mkdirSync(join(baseDir, '.git'));

    const result = await handleInit({
      cwd: baseDir,
      skipPrompts: true,
    });

    expect(result.config.project.repository).toBe(baseDir);
  });

  it('is idempotent — can run twice on same directory', async () => {
    await handleInit({ cwd: baseDir, skipPrompts: true });
    const result = await handleInit({ cwd: baseDir, skipPrompts: true });

    expect(result.kataDir).toBe(join(baseDir, '.kata'));
    expect(result.config.methodology).toBe('shape-up');
  });

  it('copies prompt templates to .kata/prompts/', async () => {
    await handleInit({ cwd: baseDir, skipPrompts: true });

    const promptsDir = join(baseDir, '.kata', 'prompts');
    expect(existsSync(promptsDir)).toBe(true);

    const files = readdirSync(promptsDir);
    // At least one .md prompt file should be present
    expect(files.some((f) => f.endsWith('.md'))).toBe(true);
  });

  it('returns projectType in result', async () => {
    const result = await handleInit({ cwd: baseDir, skipPrompts: true });
    // No manifest files present in tmp dir → unknown
    expect(result.projectType).toBe('unknown');
  });

  it('prompt files in .kata/prompts/ match builtin stage names', async () => {
    await handleInit({ cwd: baseDir, skipPrompts: true });

    const stagesDir = join(baseDir, '.kata', 'stages');
    const promptsDir = join(baseDir, '.kata', 'prompts');

    // Stages in .kata/stages/ reference "../prompts/<name>.md"
    // Verify that each builtin stage with a promptTemplate has a matching file in prompts/
    const stageFiles = readdirSync(stagesDir).filter((f) => f.endsWith('.json'));
    expect(stageFiles.length).toBeGreaterThan(0);

    const promptFiles = new Set(readdirSync(promptsDir));
    for (const stageFile of stageFiles) {
      const stageName = stageFile.replace(/\.json$/, '');
      // Each builtin stage should have a corresponding .md prompt file
      expect(promptFiles.has(`${stageName}.md`)).toBe(true);
    }
  });
});
