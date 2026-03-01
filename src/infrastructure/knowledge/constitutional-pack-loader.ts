import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Learning } from '@domain/types/learning.js';
import type { KnowledgeStore } from './knowledge-store.js';

interface ConstitutionalPackEntry {
  content: string;
  category: string;
  tier: string;
  confidence: number;
}

interface ConstitutionalPack {
  name: string;
  version: string;
  description?: string;
  learnings: ConstitutionalPackEntry[];
}

/**
 * Loads constitutional learning packs into a KnowledgeStore.
 *
 * Constitutional learnings are permanent, high-confidence best practices that
 * cannot be modified (only archived or overridden). They are loaded from JSON
 * pack files and are idempotent — loading the same pack twice will not create
 * duplicate learnings.
 */
export class ConstitutionalPackLoader {
  /**
   * Load a pack from an absolute file path.
   * Creates constitutional learnings in the store.
   * Idempotent: skips entries where identical content already exists.
   */
  load(packPath: string, store: KnowledgeStore): Learning[] {
    let raw: string;
    try {
      raw = readFileSync(packPath, 'utf-8');
    } catch (err) {
      throw new Error(
        `ConstitutionalPackLoader: failed to read pack at ${packPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    let pack: ConstitutionalPack;
    try {
      pack = JSON.parse(raw) as ConstitutionalPack;
    } catch (err) {
      throw new Error(
        `ConstitutionalPackLoader: invalid JSON in pack at ${packPath}: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Collect all existing learning contents for idempotency check (include archived to avoid re-creating archived learnings)
    const existingLearnings = store.query({ includeArchived: true });
    const existingContents = new Set(existingLearnings.map((l) => l.content));

    const created: Learning[] = [];

    for (const entry of pack.learnings) {
      if (existingContents.has(entry.content)) {
        // Skip duplicates — idempotent load
        continue;
      }

      const learning = store.capture({
        content: entry.content,
        category: entry.category,
        tier: entry.tier as Learning['tier'],
        confidence: entry.confidence,
        permanence: 'constitutional',
        source: 'imported',
      });

      created.push(learning);
      existingContents.add(entry.content);
    }

    return created;
  }

  /**
   * Load a built-in pack by name (from src/infrastructure/knowledge/packs/<name>.json).
   */
  loadBuiltin(packName: string, store: KnowledgeStore): Learning[] {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const packPath = join(__dirname, 'packs', `${packName}.json`);
    return this.load(packPath, store);
  }
}
