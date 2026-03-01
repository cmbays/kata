import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Learning } from '@domain/types/learning.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';

// ---------------------------------------------------------------------------
// Delimiter marker format
//
//   <!-- kata:begin:<section> -->
//   ...auto-managed content...
//   <!-- kata:end:<section> -->
//
// Sections: 'learnings', 'kataka', 'synthesis'
// ---------------------------------------------------------------------------

function beginMarker(section: string): string {
  return `<!-- kata:begin:${section} -->`;
}

function endMarker(section: string): string {
  return `<!-- kata:end:${section} -->`;
}

// ---------------------------------------------------------------------------
// Helper generators
// ---------------------------------------------------------------------------

/**
 * Generate markdown content for the learnings section.
 * Top 10 non-archived learnings by confidence, formatted as a bullet list.
 */
export function generateLearningsSection(learnings: Learning[]): string {
  const active = learnings
    .filter((l) => !l.archived)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10);

  if (active.length === 0) {
    return '_No learnings captured yet. Run a full cycle and cooldown to start accumulating bunkai._';
  }

  return active
    .map((l) => `- **[${l.category}]** (confidence: ${l.confidence.toFixed(2)}): ${l.content}`)
    .join('\n');
}

/**
 * Generate markdown content for the synthesis section.
 * Lists what was applied at the given cooldown time.
 *
 * Accepts SynthesisProposal objects from @domain/types/synthesis.ts.
 * To avoid tight coupling, the type field and reasoning are read from any
 * plain object that has those string properties.
 */
export function generateSynthesisSection(
  proposals: SynthesisProposal[],
  appliedAt: string,
): string {
  if (proposals.length === 0) {
    return `_Synthesis applied at ${appliedAt} — no proposals were accepted._`;
  }

  const lines: string[] = [`_Last synthesized: ${appliedAt}_`, ''];
  for (const p of proposals) {
    lines.push(`- **${p.type}**: ${p.reasoning}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// KataMdRefresher
// ---------------------------------------------------------------------------

/**
 * Updates delimited sections in KATA.md without touching user content.
 *
 * KATA.md uses HTML comment delimiters to mark auto-managed sections:
 *
 *   <!-- kata:begin:<section> -->
 *   ...auto-managed content...
 *   <!-- kata:end:<section> -->
 *
 * `updateSection` replaces the content between the markers.
 * If markers don't exist, it appends a new section at the end of the file.
 * Creates the file if it doesn't exist.
 * ALL content outside the markers is preserved exactly as-is.
 */
export class KataMdRefresher {
  constructor(private readonly kataMdPath: string) {}

  /**
   * Replace the content of a delimited section.
   * Appends a new section if the markers don't exist yet.
   * Creates the file (empty) if it doesn't exist.
   */
  updateSection(section: string, content: string): void {
    const begin = beginMarker(section);
    const end = endMarker(section);

    // Ensure parent directory and file exist
    const dir = dirname(this.kataMdPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let existing = '';
    if (existsSync(this.kataMdPath)) {
      existing = readFileSync(this.kataMdPath, 'utf-8');
    }

    const beginIdx = existing.indexOf(begin);
    const endIdx = existing.indexOf(end);

    if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
      // Replace the content between the markers (preserving the markers themselves)
      const before = existing.slice(0, beginIdx + begin.length);
      const after = existing.slice(endIdx);
      const updated = `${before}\n${content}\n${after}`;
      writeFileSync(this.kataMdPath, updated, 'utf-8');
    } else {
      // Append a new section at the end
      const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
      const newSection = `${separator}\n${begin}\n${content}\n${end}\n`;
      writeFileSync(this.kataMdPath, existing + newSection, 'utf-8');
    }
  }

  /**
   * Return the content between the markers for the given section.
   * Returns null if the section doesn't exist or the file doesn't exist.
   */
  readSection(section: string): string | null {
    if (!existsSync(this.kataMdPath)) return null;

    const begin = beginMarker(section);
    const end = endMarker(section);
    const text = readFileSync(this.kataMdPath, 'utf-8');

    const beginIdx = text.indexOf(begin);
    const endIdx = text.indexOf(end);

    if (beginIdx === -1 || endIdx === -1 || endIdx <= beginIdx) {
      return null;
    }

    // Content is between the end of the begin marker and the start of the end marker
    const contentStart = beginIdx + begin.length;
    return text.slice(contentStart, endIdx).replace(/^\n/, '').replace(/\n$/, '');
  }
}
