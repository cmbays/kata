import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod/v4';
import { StageCategorySchema, type StageCategory } from '@domain/types/stage.js';
import { KATA_DIRS } from '@shared/constants/paths.js';

/**
 * Schema for a single analytics event recorded after stage orchestration.
 */
export const AnalyticsEventSchema = z.object({
  timestamp: z.string().datetime(),
  stageCategory: StageCategorySchema,
  selectedFlavors: z.array(z.string()),
  executionMode: z.enum(['sequential', 'parallel']),
  decisionConfidences: z.array(z.number().min(0).max(1)),
  outcomeQuality: z.enum(['good', 'partial', 'poor']).optional(),
  tokenCost: z.number().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
});

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

/**
 * Aggregated statistics computed from analytics events.
 */
export interface AnalyticsStats {
  totalRuns: number;
  runsByCategory: Record<string, number>;
  avgConfidence: number;
  outcomeDistribution: { good: number; partial: number; poor: number; unknown: number };
  avgDurationMs: number | undefined;
}

/**
 * JSONL-backed analytics tracker for stage orchestration events.
 * Appends events to `.kata/tracking/analytics.jsonl` and computes aggregate stats.
 */
export class UsageAnalytics {
  private readonly filePath: string;

  constructor(basePath: string) {
    const trackingDir = join(basePath, KATA_DIRS.tracking);
    mkdirSync(trackingDir, { recursive: true });
    this.filePath = join(trackingDir, 'analytics.jsonl');
  }

  /**
   * Append an analytics event to the JSONL file.
   * Adds an ISO 8601 timestamp automatically.
   */
  recordEvent(event: Omit<AnalyticsEvent, 'timestamp'>): void {
    const full: AnalyticsEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    try {
      appendFileSync(this.filePath, JSON.stringify(full) + '\n');
    } catch {
      // Analytics failures must never crash the caller
    }
  }

  /**
   * Read all events, optionally filtering by stageCategory and/or a since timestamp.
   */
  getEvents(filters?: { stageCategory?: StageCategory; since?: string }): AnalyticsEvent[] {
    const events = this.readAll();

    return events.filter((e) => {
      if (filters?.stageCategory && e.stageCategory !== filters.stageCategory) return false;
      if (filters?.since && e.timestamp < filters.since) return false;
      return true;
    });
  }

  /**
   * Compute aggregate statistics, optionally filtered by stageCategory.
   */
  getStats(stageCategory?: StageCategory): AnalyticsStats {
    const events = stageCategory
      ? this.getEvents({ stageCategory })
      : this.readAll();

    const runsByCategory: Record<string, number> = {};
    const outcomeDistribution = { good: 0, partial: 0, poor: 0, unknown: 0 };
    let totalConfidences = 0;
    let confidenceCount = 0;
    let totalDurationMs = 0;
    let durationCount = 0;

    for (const event of events) {
      runsByCategory[event.stageCategory] = (runsByCategory[event.stageCategory] ?? 0) + 1;

      if (event.outcomeQuality) {
        outcomeDistribution[event.outcomeQuality]++;
      } else {
        outcomeDistribution.unknown++;
      }

      for (const c of event.decisionConfidences) {
        totalConfidences += c;
        confidenceCount++;
      }

      if (event.durationMs !== undefined) {
        totalDurationMs += event.durationMs;
        durationCount++;
      }
    }

    return {
      totalRuns: events.length,
      runsByCategory,
      avgConfidence: confidenceCount > 0 ? totalConfidences / confidenceCount : 0,
      outcomeDistribution,
      avgDurationMs: durationCount > 0 ? totalDurationMs / durationCount : undefined,
    };
  }

  /**
   * Read and parse all events from the JSONL file.
   * Malformed lines are skipped gracefully.
   */
  private readAll(): AnalyticsEvent[] {
    if (!existsSync(this.filePath)) return [];

    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf-8');
    } catch {
      return [];
    }

    const lines = content.split('\n').filter((line) => line.trim().length > 0);
    const events: AnalyticsEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        const result = AnalyticsEventSchema.safeParse(parsed);
        if (result.success) {
          events.push(result.data);
        }
      } catch {
        // Skip malformed lines gracefully
      }
    }

    return events;
  }
}
