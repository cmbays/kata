import type { CycleManager } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore, KnowledgeStats } from '@domain/ports/knowledge-store.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { Learning } from '@domain/types/learning.js';
import type { DojoDiaryEntry } from '@domain/types/dojo.js';
import type { RunSummary } from '@features/cycle-management/types.js';
import type { IDiaryStore } from '@domain/ports/diary-store.js';
import { analyzeFlavorFrequency, analyzeRecurringGaps } from '@features/cycle-management/cross-run-analyzer.js';
import { loadRunSummary } from '@features/cycle-management/run-summary-loader.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Extended knowledge store interface that includes stats().
 * The concrete KnowledgeStore implements this; the base IKnowledgeStore port does not.
 */
export interface IDojoKnowledgeStore extends IKnowledgeStore {
  stats(): KnowledgeStats;
}

export interface DataAggregatorDeps {
  knowledgeStore: IDojoKnowledgeStore;
  diaryStore: IDiaryStore;
  cycleManager: CycleManager;
  runsDir: string;
}

export interface DojoDataBundle {
  backward: {
    recentDiaries: DojoDiaryEntry[];
    cycles: Cycle[];
    runSummaries: RunSummary[];
    topLearnings: Learning[];
    recurringGaps: Array<{ description: string; severity: 'low' | 'medium' | 'high'; betCount: number }>;
  };
  inward: {
    knowledgeStats: KnowledgeStats;
    flavorFrequency: Map<string, number>;
  };
  metadata: {
    projectName?: string;
    totalCycles: number;
    totalRuns: number;
  };
}

export class DataAggregator {
  constructor(private readonly deps: DataAggregatorDeps) {}

  gather(options?: { maxDiaries?: number; maxLearnings?: number }): DojoDataBundle {
    const maxDiaries = options?.maxDiaries ?? 5;
    const maxLearnings = options?.maxLearnings ?? 20;

    // Backward-looking data
    const recentDiaries = this.deps.diaryStore.recent(maxDiaries);
    const cycles = this.deps.cycleManager.list();
    const runSummaries = this.loadAllRunSummaries(cycles);
    const topLearnings = this.loadTopLearnings(maxLearnings);
    const recurringGaps = runSummaries.length >= 2
      ? analyzeRecurringGaps(runSummaries)
      : [];

    // Inward-looking data
    const knowledgeStats = this.deps.knowledgeStore.stats();
    const flavorFrequency = runSummaries.length > 0
      ? analyzeFlavorFrequency(runSummaries)
      : new Map<string, number>();

    return {
      backward: {
        recentDiaries,
        cycles,
        runSummaries,
        topLearnings,
        recurringGaps,
      },
      inward: {
        knowledgeStats,
        flavorFrequency,
      },
      metadata: {
        totalCycles: cycles.length,
        totalRuns: runSummaries.length,
      },
    };
  }

  private loadAllRunSummaries(cycles: Cycle[]): RunSummary[] {
    const summaries: RunSummary[] = [];
    for (const cycle of cycles) {
      for (const bet of cycle.bets) {
        if (!bet.runId) continue;
        try {
          const summary = loadRunSummary(this.deps.runsDir, bet.id, bet.runId);
          if (summary) summaries.push(summary);
        } catch (err) {
          logger.warn(`DataAggregator: failed to load run "${bet.runId}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    return summaries;
  }

  private loadTopLearnings(max: number): Learning[] {
    const all = this.deps.knowledgeStore.query({});
    return all
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, max);
  }
}
