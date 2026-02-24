import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StageCategorySchema, type StageCategory, type OrchestratorConfig } from '@domain/types/stage.js';
import { StageVocabularySchema, type StageVocabulary } from '@domain/types/vocabulary.js';
import type { IStageOrchestrator } from '@domain/ports/stage-orchestrator.js';
import { OrchestratorError } from '@shared/lib/errors.js';
import { logger } from '@shared/lib/logger.js';
import {
  BaseStageOrchestrator,
  type StageOrchestratorDeps,
} from '../stage-orchestrator.js';

// ---------------------------------------------------------------------------
// Vocabulary loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the path to a vocabulary JSON file.
 * Checks custom project path first, then falls back to builtin.
 */
function resolveVocabularyPath(category: StageCategory, customDir?: string): string | undefined {
  // Check custom vocabulary directory first
  if (customDir) {
    const customPath = join(customDir, `${category}.json`);
    if (existsSync(customPath)) return customPath;
  }

  // Fall back to builtin vocabularies shipped with the package.
  // __dirname may point to src/ (dev) or dist/ (compiled), so check both.
  const builtinPath = join(__dirname, '..', '..', '..', '..', 'stages', 'vocabularies', `${category}.json`);
  if (existsSync(builtinPath)) return builtinPath;

  // When running from dist/, the stages/ dir is at the project root (one level above dist/)
  const distFallback = join(__dirname, '..', '..', '..', '..', '..', 'stages', 'vocabularies', `${category}.json`);
  if (existsSync(distFallback)) return distFallback;

  return undefined;
}

/**
 * Load and validate a vocabulary JSON file for the given category.
 */
function loadVocabulary(category: StageCategory, customDir?: string): StageVocabulary | undefined {
  const vocabPath = resolveVocabularyPath(category, customDir);
  if (!vocabPath) {
    logger.warn(`No vocabulary file found for category "${category}". Using default scoring.`, {
      category,
    });
    return undefined;
  }

  try {
    const raw = JSON.parse(readFileSync(vocabPath, 'utf-8'));
    return StageVocabularySchema.parse(raw);
  } catch (err) {
    logger.warn(
      `Failed to load vocabulary for "${category}" from ${vocabPath}: ${err instanceof Error ? err.message : String(err)}`,
      { category, path: vocabPath },
    );
    return undefined;
  }
}

// Cache loaded vocabularies to avoid repeated disk reads
const vocabularyCache = new Map<string, StageVocabulary | undefined>();

function getVocabulary(category: StageCategory, customDir?: string): StageVocabulary | undefined {
  const key = `${category}:${customDir ?? ''}`;
  if (vocabularyCache.has(key)) return vocabularyCache.get(key);
  const vocab = loadVocabulary(category, customDir);
  vocabularyCache.set(key, vocab);
  return vocab;
}

/** Clear the vocabulary cache (useful for testing). */
export function clearVocabularyCache(): void {
  vocabularyCache.clear();
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Valid stage categories for the factory — derived from the schema. */
const VALID_CATEGORIES = new Set<StageCategory>(StageCategorySchema.options);

/**
 * Create a Stage Orchestrator for the given stage category.
 *
 * Uses vocabulary-driven configuration loaded from JSON files.
 * The orchestrator is a concrete class — no subclasses needed.
 *
 * @param stageCategory — One of the four fixed stage categories.
 * @param deps — Injected dependencies: FlavorRegistry, DecisionRegistry, executor.
 * @param config — Orchestrator configuration from the Stage definition.
 * @param customVocabularyDir — Optional path to a directory with custom vocabulary JSONs.
 * @returns A fully wired IStageOrchestrator instance.
 * @throws OrchestratorError if stageCategory is not a known value.
 */
export function createStageOrchestrator(
  stageCategory: StageCategory,
  deps: StageOrchestratorDeps,
  config: OrchestratorConfig,
  customVocabularyDir?: string,
): IStageOrchestrator {
  if (!VALID_CATEGORIES.has(stageCategory)) {
    throw new OrchestratorError(
      `Unknown stage category "${stageCategory}". ` +
        `Valid categories are: ${[...VALID_CATEGORIES].join(', ')}.`,
    );
  }

  const vocabulary = getVocabulary(stageCategory, customVocabularyDir);
  return new BaseStageOrchestrator(stageCategory, deps, config, vocabulary);
}
