import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { StageRegistry } from '@infra/registries/stage-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import type { PromptUpdate } from './learning-extractor.js';

/**
 * Result of applying a prompt update.
 */
export interface PromptUpdateResult {
  stageType: string;
  applied: boolean;
  backupPath?: string;
  error?: string;
}

/**
 * PromptUpdater — applies accepted prompt updates to stage prompt template files.
 *
 * Handles backup, apply, and validation for prompt template modifications
 * suggested by the LearningExtractor.
 */
export class PromptUpdater {
  /**
   * Apply a prompt update to a stage's prompt template file.
   *
   * 1. Resolves the prompt template path from the stage registry
   * 2. Backs up the original file to a `.bak` file
   * 3. Appends the suggested content
   * 4. Validates the result is non-empty
   */
  apply(
    kataDir: string,
    update: PromptUpdate,
    stageRegistry: StageRegistry,
  ): PromptUpdateResult {
    try {
      // Resolve prompt path
      const promptPath = this.resolvePromptPath(kataDir, update, stageRegistry);
      if (!promptPath) {
        return {
          stageType: update.stageType,
          applied: false,
          error: `No prompt template found for stage "${update.stageType}". Define a promptTemplate path in the stage definition first.`,
        };
      }

      // Read current content (or empty if file doesn't exist yet)
      let currentContent = '';
      if (existsSync(promptPath)) {
        currentContent = readFileSync(promptPath, 'utf-8');
      }

      // Back up the original
      const backupPath = `${promptPath}.bak`;
      if (existsSync(promptPath)) {
        copyFileSync(promptPath, backupPath);
      }

      // Apply the update by appending the suggestion
      const updatedContent = currentContent
        ? `${currentContent.trimEnd()}\n\n${update.suggestion}\n`
        : `${update.suggestion}\n`;

      // Ensure parent directory exists
      JsonStore.ensureDir(dirname(promptPath));

      // Write updated content
      writeFileSync(promptPath, updatedContent, 'utf-8');

      // Validate the result (non-empty, readable)
      const written = readFileSync(promptPath, 'utf-8');
      if (written.trim().length === 0) {
        // Restore backup
        if (existsSync(backupPath)) {
          copyFileSync(backupPath, promptPath);
        }
        return {
          stageType: update.stageType,
          applied: false,
          error: 'Updated prompt was empty after writing. Original restored.',
        };
      }

      return {
        stageType: update.stageType,
        applied: true,
        backupPath,
      };
    } catch (error) {
      return {
        stageType: update.stageType,
        applied: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate a diff-like preview of what would change.
   */
  preview(update: PromptUpdate): string {
    const lines: string[] = [];

    lines.push(`--- ${update.currentPromptPath ?? `(new: ${update.stageType})`}`);
    lines.push(`+++ ${update.currentPromptPath ?? `(new: ${update.stageType})`} (updated)`);
    lines.push(`@@ Section: ${update.section} @@`);
    lines.push('');

    // Show the addition as diff-style lines
    for (const line of update.suggestion.split('\n')) {
      lines.push(`+ ${line}`);
    }

    lines.push('');
    lines.push(`Rationale: ${update.rationale}`);

    return lines.join('\n');
  }

  // ---- Private ----

  private resolvePromptPath(
    kataDir: string,
    update: PromptUpdate,
    stageRegistry: StageRegistry,
  ): string | null {
    // Try update's currentPromptPath first
    if (update.currentPromptPath) {
      return join(kataDir, update.currentPromptPath);
    }

    // Look up the stage in the registry for its promptTemplate
    try {
      const stage = stageRegistry.get(update.stageType);
      if (stage.promptTemplate) {
        return join(kataDir, stage.promptTemplate);
      }
    } catch {
      // Stage not found — fall through
    }

    return null;
  }
}
