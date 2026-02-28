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
