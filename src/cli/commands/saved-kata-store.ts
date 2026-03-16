import { join } from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import type { StageCategory } from '@domain/types/stage.js';
import { SavedKataSchema, type FlavorHint } from '@domain/types/saved-kata.js';
import { isJsonFile } from '@shared/lib/file-filters.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { assertValidKataName } from '@cli/commands/execute.helpers.js';

function katasDir(kataDir: string): string {
  return join(kataDir, KATA_DIRS.katas);
}

export function listSavedKatas(kataDir: string): Array<{ name: string; stages: StageCategory[]; description?: string }> {
  const dir = katasDir(kataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isJsonFile)
    .map((f) => {
      try {
        const raw = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
        return SavedKataSchema.parse(raw);
      } catch (e) {
        if (e instanceof SyntaxError || (e instanceof Error && e.constructor.name === 'ZodError')) {
          console.error(`Warning: skipping invalid kata file "${f}": ${e.message}`);
          return null;
        }
        throw e;
      }
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);
}

export function loadSavedKata(kataDir: string, name: string): { stages: StageCategory[]; flavorHints?: Record<string, FlavorHint> } {
  assertValidKataName(name);
  const filePath = join(katasDir(kataDir), `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Kata "${name}" not found. Use --list-katas to see available katas.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch (e) {
    throw new Error(
      `Kata "${name}" has invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
  try {
    return SavedKataSchema.parse(raw);
  } catch (e) {
    throw new Error(
      `Kata "${name}" has invalid structure. Ensure it has "name" (string) and "stages" (array of categories).`,
      { cause: e },
    );
  }
}

export function saveSavedKata(kataDir: string, name: string, stages: StageCategory[], flavorHints?: Record<string, FlavorHint>): void {
  assertValidKataName(name);
  const dir = katasDir(kataDir);
  mkdirSync(dir, { recursive: true });
  const kata = SavedKataSchema.parse({ name, stages, flavorHints });
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(kata, null, 2), 'utf-8');
}

export function deleteSavedKata(kataDir: string, name: string): void {
  assertValidKataName(name);
  const filePath = join(katasDir(kataDir), `${name}.json`);
  if (!existsSync(filePath)) {
    throw new Error(`Kata "${name}" not found. Use --list-katas to see available katas.`);
  }
  try {
    unlinkSync(filePath);
  } catch (e) {
    throw new Error(
      `Could not delete kata "${name}": ${e instanceof Error ? e.message : String(e)}`,
      { cause: e },
    );
  }
}
