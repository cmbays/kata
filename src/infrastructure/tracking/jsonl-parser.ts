import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { TokenUsage } from '@domain/types/history.js';

/**
 * Parse a Claude Code JSONL session file to extract token usage.
 * Each line is a JSON object that may contain token usage fields.
 * Malformed lines are skipped gracefully.
 */
export function parseSessionFile(filePath: string): TokenUsage {
  const result: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    total: 0,
  };

  if (!existsSync(filePath)) {
    return result;
  }

  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return result;
  }

  const lines = content.split('\n').filter((line) => line.trim().length > 0);

  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      extractTokenUsage(parsed, result);
    } catch {
      // Skip malformed lines gracefully
    }
  }

  result.total =
    result.inputTokens +
    result.outputTokens +
    result.cacheCreationTokens +
    result.cacheReadTokens;

  return result;
}

/**
 * Recursively extract token usage fields from a parsed JSON object.
 * Looks for objects with: input_tokens, output_tokens,
 * cache_creation_input_tokens, cache_read_input_tokens
 */
function extractTokenUsage(obj: unknown, accumulator: TokenUsage): void {
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      extractTokenUsage(item, accumulator);
    }
    return;
  }

  const record = obj as Record<string, unknown>;

  // Check if this object directly contains token usage fields
  if (typeof record['input_tokens'] === 'number') {
    accumulator.inputTokens += record['input_tokens'];
  }
  if (typeof record['output_tokens'] === 'number') {
    accumulator.outputTokens += record['output_tokens'];
  }
  if (typeof record['cache_creation_input_tokens'] === 'number') {
    accumulator.cacheCreationTokens += record['cache_creation_input_tokens'];
  }
  if (typeof record['cache_read_input_tokens'] === 'number') {
    accumulator.cacheReadTokens += record['cache_read_input_tokens'];
  }

  // Recurse into nested objects to find deeply nested usage
  for (const value of Object.values(record)) {
    if (typeof value === 'object' && value !== null) {
      extractTokenUsage(value, accumulator);
    }
  }
}

/**
 * Find all JSONL session files for a project path.
 * Claude Code stores sessions at ~/.claude/projects/{encoded-path}/*.jsonl
 *
 * The encoded path replaces '/' with '-' in the absolute project path.
 */
export function findSessionFiles(projectPath: string): string[] {
  const home = homedir();
  // Claude Code encodes the project path by replacing '/' with '-'
  const encodedPath = projectPath.replace(/\//g, '-').replace(/^-/, '');
  const sessionsDir = join(home, '.claude', 'projects', encodedPath);

  if (!existsSync(sessionsDir)) {
    return [];
  }

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    return files.map((f) => join(sessionsDir, f));
  } catch {
    return [];
  }
}
