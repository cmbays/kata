import type { DojoDiaryEntry } from '@domain/types/dojo.js';

/**
 * Port interface for the dojo diary store.
 * Feature-layer consumers should depend on this interface rather than the
 * concrete DiaryStore class in infrastructure.
 */
export interface IDiaryStore {
  write(entry: DojoDiaryEntry): void;
  readByCycleId(cycleId: string): DojoDiaryEntry | null;
  list(): DojoDiaryEntry[];
  recent(count: number): DojoDiaryEntry[];
}
