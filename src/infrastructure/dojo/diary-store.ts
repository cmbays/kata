import { join } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { DojoDiaryEntrySchema, type DojoDiaryEntry } from '@domain/types/dojo.js';

export class DiaryStore {
  constructor(private readonly diaryDir: string) {}

  write(entry: DojoDiaryEntry): void {
    const parsed = DojoDiaryEntrySchema.parse(entry);
    const filePath = join(this.diaryDir, `${parsed.cycleId}.json`);
    JsonStore.write(filePath, parsed, DojoDiaryEntrySchema);
  }

  /**
   * Merge a new diary entry into an existing one for the same cycleId (#331).
   *
   * Strategy:
   *   - Preserve `id` and `createdAt` from the existing entry so file identity is stable.
   *   - Overwrite `rawDataSummary`, `narrative`, `wins`, `painPoints`, `openQuestions`,
   *     `mood`, and `tags` with the new values (derived deterministically from current
   *     cycle state and should always reflect the latest run).
   *   - Fill in `agentPerspective` / `humanPerspective` only when the new entry provides
   *     them; otherwise keep the existing value so a `--prepare` followed by `complete`
   *     does not lose the perspective written by the first pass.
   *   - Always update `updatedAt` to now.
   *
   * When no existing entry is found, falls back to a plain write.
   */
  upsert(entry: DojoDiaryEntry): void {
    const existing = this.readByCycleId(entry.cycleId);
    if (!existing) {
      this.write(entry);
      return;
    }

    const merged: DojoDiaryEntry = {
      // Identity fields — preserved from the first write
      id: existing.id,
      cycleId: existing.cycleId,
      createdAt: existing.createdAt,
      // Deterministic fields — always use the latest computed values
      cycleName: entry.cycleName ?? existing.cycleName,
      narrative: entry.narrative,
      wins: entry.wins,
      painPoints: entry.painPoints,
      openQuestions: entry.openQuestions,
      mood: entry.mood,
      tags: entry.tags,
      rawDataSummary: entry.rawDataSummary ?? existing.rawDataSummary,
      // Perspective fields — fill in when newly provided; otherwise keep existing value
      agentPerspective: entry.agentPerspective ?? existing.agentPerspective,
      humanPerspective: entry.humanPerspective ?? existing.humanPerspective,
      updatedAt: new Date().toISOString(),
    };

    const parsed = DojoDiaryEntrySchema.parse(merged);
    const filePath = join(this.diaryDir, `${parsed.cycleId}.json`);
    JsonStore.write(filePath, parsed, DojoDiaryEntrySchema);
  }

  readByCycleId(cycleId: string): DojoDiaryEntry | null {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(cycleId)) return null;
    const filePath = join(this.diaryDir, `${cycleId}.json`);
    if (!JsonStore.exists(filePath)) return null;
    return JsonStore.read(filePath, DojoDiaryEntrySchema);
  }

  list(): DojoDiaryEntry[] {
    const entries = JsonStore.list(this.diaryDir, DojoDiaryEntrySchema);
    return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  recent(count: number): DojoDiaryEntry[] {
    if (!Number.isInteger(count) || count < 0) return [];
    return this.list().slice(0, count);
  }
}
