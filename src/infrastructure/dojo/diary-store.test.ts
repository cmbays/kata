import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DojoDiaryEntry } from '@domain/types/dojo.js';
import { DiaryStore } from './diary-store.js';

let tempDir: string;
let store: DiaryStore;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-diary-test-'));
  store = new DiaryStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeDiaryEntry(overrides: Partial<DojoDiaryEntry> = {}): DojoDiaryEntry {
  return {
    id: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    narrative: 'Today I worked on the pipeline runner and it felt productive.',
    wins: ['Completed gate evaluation'],
    painPoints: ['Token budget was tight'],
    openQuestions: ['Should we add more stages?'],
    mood: 'energized',
    tags: ['pipeline', 'gates'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('DiaryStore', () => {
  describe('write', () => {
    it('writes a diary entry as {cycleId}.json', () => {
      const entry = makeDiaryEntry();
      store.write(entry);

      const result = store.readByCycleId(entry.cycleId);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(entry.id);
      expect(result!.narrative).toBe(entry.narrative);
    });

    it('validates the entry against DojoDiaryEntrySchema', () => {
      const invalid = { id: 'not-a-uuid', cycleId: 'bad', narrative: '' } as unknown as DojoDiaryEntry;
      expect(() => store.write(invalid)).toThrow();
    });

    it('overwrites an existing entry for the same cycleId', () => {
      const cycleId = crypto.randomUUID();
      const entry1 = makeDiaryEntry({ cycleId, narrative: 'First entry' });
      const entry2 = makeDiaryEntry({ cycleId, narrative: 'Updated entry' });

      store.write(entry1);
      store.write(entry2);

      const result = store.readByCycleId(cycleId);
      expect(result!.narrative).toBe('Updated entry');
    });
  });

  describe('readByCycleId', () => {
    it('returns the diary entry for a valid cycleId', () => {
      const entry = makeDiaryEntry();
      store.write(entry);

      const result = store.readByCycleId(entry.cycleId);
      expect(result).not.toBeNull();
      expect(result!.cycleId).toBe(entry.cycleId);
      expect(result!.wins).toEqual(['Completed gate evaluation']);
    });

    it('returns null for a non-existent cycleId', () => {
      const result = store.readByCycleId(crypto.randomUUID());
      expect(result).toBeNull();
    });

    it('returns null for a path traversal string', () => {
      const result = store.readByCycleId('../../etc/passwd');
      expect(result).toBeNull();
    });

    it('preserves optional fields', () => {
      const entry = makeDiaryEntry({
        cycleName: 'Sprint Alpha',
        mood: 'reflective',
      });
      store.write(entry);

      const result = store.readByCycleId(entry.cycleId);
      expect(result!.cycleName).toBe('Sprint Alpha');
      expect(result!.mood).toBe('reflective');
    });

    it('preserves default arrays when not provided', () => {
      const entry = makeDiaryEntry({
        wins: [],
        painPoints: [],
        openQuestions: [],
        tags: [],
      });
      store.write(entry);

      const result = store.readByCycleId(entry.cycleId);
      expect(result!.wins).toEqual([]);
      expect(result!.painPoints).toEqual([]);
      expect(result!.openQuestions).toEqual([]);
      expect(result!.tags).toEqual([]);
    });
  });

  describe('list', () => {
    it('returns an empty array when no entries exist', () => {
      const result = store.list();
      expect(result).toEqual([]);
    });

    it('returns all diary entries', () => {
      store.write(makeDiaryEntry());
      store.write(makeDiaryEntry());
      store.write(makeDiaryEntry());

      const result = store.list();
      expect(result).toHaveLength(3);
    });

    it('sorts entries by createdAt descending (most recent first)', () => {
      const entry1 = makeDiaryEntry({ createdAt: '2026-01-01T00:00:00.000Z' });
      const entry2 = makeDiaryEntry({ createdAt: '2026-03-01T00:00:00.000Z' });
      const entry3 = makeDiaryEntry({ createdAt: '2026-02-01T00:00:00.000Z' });

      store.write(entry1);
      store.write(entry2);
      store.write(entry3);

      const result = store.list();
      expect(result[0]!.createdAt).toBe('2026-03-01T00:00:00.000Z');
      expect(result[1]!.createdAt).toBe('2026-02-01T00:00:00.000Z');
      expect(result[2]!.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('recent', () => {
    it('returns the N most recent entries', () => {
      const entry1 = makeDiaryEntry({ createdAt: '2026-01-01T00:00:00.000Z', narrative: 'oldest' });
      const entry2 = makeDiaryEntry({ createdAt: '2026-02-01T00:00:00.000Z', narrative: 'middle' });
      const entry3 = makeDiaryEntry({ createdAt: '2026-03-01T00:00:00.000Z', narrative: 'newest' });

      store.write(entry1);
      store.write(entry2);
      store.write(entry3);

      const result = store.recent(2);
      expect(result).toHaveLength(2);
      expect(result[0]!.narrative).toBe('newest');
      expect(result[1]!.narrative).toBe('middle');
    });

    it('returns all entries if count exceeds total', () => {
      store.write(makeDiaryEntry());
      store.write(makeDiaryEntry());

      const result = store.recent(10);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when no entries exist', () => {
      const result = store.recent(5);
      expect(result).toEqual([]);
    });

    it('returns empty array for negative count', () => {
      store.write(makeDiaryEntry());
      const result = store.recent(-1);
      expect(result).toEqual([]);
    });
  });
});
