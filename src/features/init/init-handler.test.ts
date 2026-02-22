import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
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
});
