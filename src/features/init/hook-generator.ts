import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { logger } from '@shared/lib/logger.js';

/**
 * The Claude Code hook configuration for sensei auto-activation.
 * Uses a UserPromptSubmit hook that checks for .kata/ and outputs context.
 */
interface ClaudeHookConfig {
  hooks: {
    UserPromptSubmit?: HookEntry[];
    [key: string]: HookEntry[] | undefined;
  };
}

interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: 'command';
    command: string;
  }>;
}

export interface HookGenerationResult {
  settingsPath: string;
  created: boolean;
  merged: boolean;
  skipped: boolean;
}

/**
 * Build the hook command that outputs sensei context when .kata/ exists.
 * Uses $PWD-relative paths so the hook is portable across machines and clones.
 */
function buildHookCommand(): string {
  return [
    'if [ -d "$PWD/.kata" ]; then',
    '  echo "You are working in a kata-enabled project.";',
    '  echo "Sensei skill: $PWD/.kata/skill/kata-sensei.md";',
    '  echo "When running cycles or executing stages, read the sensei skill file for orchestration instructions.";',
    'fi',
  ].join(' ');
}

/**
 * Generate Claude Code hook configuration for sensei auto-activation.
 *
 * Writes to `{projectRoot}/.claude/settings.json`, merging with existing
 * settings if present. Skips if the hook is already configured.
 */
export function generateClaudeHooks(
  projectRoot: string,
): HookGenerationResult {
  const claudeDir = join(projectRoot, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  const hookCommand = buildHookCommand();

  // Check if settings already exist
  let existingSettings: Record<string, unknown> = {};
  let fileExists = false;

  if (existsSync(settingsPath)) {
    fileExists = true;
    try {
      const raw = readFileSync(settingsPath, 'utf-8');
      existingSettings = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      logger.warn(
        `Could not parse existing ${settingsPath}: ${err instanceof Error ? err.message : String(err)}. Creating new settings.`,
      );
      existingSettings = {};
    }
  }

  // Check if hook already exists
  const hooks = existingSettings.hooks as ClaudeHookConfig['hooks'] | undefined;
  if (hooks?.UserPromptSubmit) {
    const existing = hooks.UserPromptSubmit.some((entry) =>
      entry.hooks.some((h) => h.command.includes('kata-sensei.md')),
    );
    if (existing) {
      return { settingsPath, created: false, merged: false, skipped: true };
    }
  }

  // Build the new hook entry
  const newHookEntry: HookEntry = {
    matcher: '',
    hooks: [
      {
        type: 'command',
        command: hookCommand,
      },
    ],
  };

  // Merge into existing settings
  const mergedHooks: ClaudeHookConfig['hooks'] = (hooks as ClaudeHookConfig['hooks']) ?? {};
  const promptSubmitHooks = mergedHooks.UserPromptSubmit ?? [];
  promptSubmitHooks.push(newHookEntry);
  mergedHooks.UserPromptSubmit = promptSubmitHooks;

  const mergedSettings = {
    ...existingSettings,
    hooks: mergedHooks,
  };

  // Ensure .claude/ directory exists
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Write settings
  writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2) + '\n', 'utf-8');

  return {
    settingsPath,
    created: !fileExists,
    merged: fileExists,
    skipped: false,
  };
}
