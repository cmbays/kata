import { readFileSync, writeFileSync, copyFileSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { IStepRegistry } from '@domain/ports/step-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StepNotFoundError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';
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
    stageRegistry: IStepRegistry,
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
    stageRegistry: IStepRegistry,
  ): string | null {
    let rawPath: string | undefined;

    // Try update's currentPromptPath first
    if (update.currentPromptPath) {
      rawPath = update.currentPromptPath;
    } else {
      // Look up the stage in the registry for its promptTemplate
      try {
        const stage = stageRegistry.get(update.stageType);
        rawPath = stage.promptTemplate;
      } catch (error) {
        // Only swallow "stage not found" — let corruption/permission errors propagate
        if (!(error instanceof StepNotFoundError)) {
          throw error;
        }
      }
    }

    if (!rawPath) return null;

    // Reject null bytes (defense-in-depth; Node.js fs rejects them at syscall level)
    if (rawPath.includes('\0')) {
      logger.warn(`Prompt path contains null byte, rejecting: stage "${update.stageType}"`);
      return null;
    }

    // Guard against path traversal — resolved path must stay within kataDir
    const resolved = resolve(kataDir, rawPath);
    const normalizedRoot = resolve(kataDir);
    if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
      logger.warn(`Path traversal detected: "${rawPath}" resolves outside kataDir. Rejecting.`);
      return null;
    }

    // Guard against symlink escapes — resolve the deepest existing ancestor
    let existing = resolved;
    while (!existsSync(existing)) {
      const parent = dirname(existing);
      if (parent === existing) break;
      existing = parent;
    }
    const realExisting = realpathSync(existing);
    const realRoot = realpathSync(kataDir);
    if (!realExisting.startsWith(realRoot + '/') && realExisting !== realRoot) {
      logger.warn(`Symlink escape detected: "${rawPath}" resolves outside kataDir via symlink. Rejecting.`);
      return null;
    }

    return resolved;
  }
}
