import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateClaudeHooks } from './hook-generator.js';

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-hooks-test-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('generateClaudeHooks', () => {
  it('creates .claude/settings.json when it does not exist', () => {
    const result = generateClaudeHooks(tempDir);

    expect(result.created).toBe(true);
    expect(result.merged).toBe(false);
    expect(result.skipped).toBe(false);
    expect(existsSync(result.settingsPath)).toBe(true);
  });

  it('writes valid JSON with hooks.UserPromptSubmit', () => {
    generateClaudeHooks(tempDir);

    const settingsPath = join(tempDir, '.claude', 'settings.json');
    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);

    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].type).toBe('command');
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toContain('.kata');
  });

  it('hook command uses portable $PWD-relative paths', () => {
    generateClaudeHooks(tempDir);

    const settingsPath = join(tempDir, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
    const command = settings.hooks.UserPromptSubmit[0].hooks[0].command;

    expect(command).toContain('$PWD/.kata');
    expect(command).toContain('kata-sensei.md');
    expect(command).not.toContain(tempDir); // no absolute paths
  });

  it('merges with existing settings.json', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ allowedTools: ['Read', 'Write'] }, null, 2),
      'utf-8',
    );

    const result = generateClaudeHooks(tempDir);

    expect(result.created).toBe(false);
    expect(result.merged).toBe(true);
    expect(result.skipped).toBe(false);

    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'));
    expect(settings.allowedTools).toEqual(['Read', 'Write']);
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it('appends to existing UserPromptSubmit hooks', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { matcher: '', hooks: [{ type: 'command', command: 'echo existing' }] },
          ],
        },
      }, null, 2),
      'utf-8',
    );

    const result = generateClaudeHooks(tempDir);

    expect(result.merged).toBe(true);
    expect(result.skipped).toBe(false);

    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(2);
  });

  it('skips if kata hook already exists', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [
            { matcher: '', hooks: [{ type: 'command', command: 'echo "Sensei skill: $PWD/.kata/skill/kata-sensei.md"' }] },
          ],
        },
      }, null, 2),
      'utf-8',
    );

    const result = generateClaudeHooks(tempDir);

    expect(result.skipped).toBe(true);
    expect(result.created).toBe(false);
    expect(result.merged).toBe(false);
  });

  it('handles malformed existing settings.json gracefully', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), 'not json', 'utf-8');

    const result = generateClaudeHooks(tempDir);

    expect(result.created).toBe(false);
    expect(result.merged).toBe(true);
    expect(result.skipped).toBe(false);

    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf-8'));
    expect(settings.hooks.UserPromptSubmit).toHaveLength(1);
  });
});
