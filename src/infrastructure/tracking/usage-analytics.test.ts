import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UsageAnalytics, type AnalyticsEvent } from './usage-analytics.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<Omit<AnalyticsEvent, 'timestamp'>> = {},
): Omit<AnalyticsEvent, 'timestamp'> {
  return {
    stageCategory: 'build',
    selectedFlavors: ['standard-build'],
    executionMode: 'sequential',
    decisionConfidences: [0.8, 0.9, 0.7],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsageAnalytics', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `kata-analytics-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates the tracking directory if it does not exist', () => {
      new UsageAnalytics(baseDir);
      expect(existsSync(join(baseDir, 'tracking'))).toBe(true);
    });
  });

  describe('recordEvent()', () => {
    it('writes an event to the JSONL file', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent());

      const filePath = join(baseDir, 'tracking', 'analytics.jsonl');
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, 'utf-8').trim();
      const parsed = JSON.parse(content);
      expect(parsed.stageCategory).toBe('build');
      expect(parsed.timestamp).toBeDefined();
    });

    it('appends multiple events as separate lines', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'research' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'plan' }));

      const filePath = join(baseDir, 'tracking', 'analytics.jsonl');
      const lines = readFileSync(filePath, 'utf-8').trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('adds a timestamp automatically', () => {
      const analytics = new UsageAnalytics(baseDir);
      const before = new Date().toISOString();
      analytics.recordEvent(makeEvent());
      const after = new Date().toISOString();

      const events = analytics.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0].timestamp >= before).toBe(true);
      expect(events[0].timestamp <= after).toBe(true);
    });
  });

  describe('getEvents()', () => {
    it('returns all events when no filters are provided', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'review' }));

      const events = analytics.getEvents();
      expect(events).toHaveLength(2);
    });

    it('returns empty array when no events exist', () => {
      const analytics = new UsageAnalytics(baseDir);
      expect(analytics.getEvents()).toEqual([]);
    });

    it('filters by stageCategory', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'review' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));

      const buildEvents = analytics.getEvents({ stageCategory: 'build' });
      expect(buildEvents).toHaveLength(2);
      expect(buildEvents.every((e) => e.stageCategory === 'build')).toBe(true);
    });

    it('filters by since timestamp', () => {
      const analytics = new UsageAnalytics(baseDir);

      // Record events — they'll all have "now" timestamps
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'review' }));

      // Use a past timestamp to get all events
      const events = analytics.getEvents({ since: '2020-01-01T00:00:00.000Z' });
      expect(events).toHaveLength(2);

      // Use a future timestamp to get no events
      const futureEvents = analytics.getEvents({ since: '2099-01-01T00:00:00.000Z' });
      expect(futureEvents).toHaveLength(0);
    });

    it('combines stageCategory and since filters', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ stageCategory: 'build' }));
      analytics.recordEvent(makeEvent({ stageCategory: 'review' }));

      const events = analytics.getEvents({
        stageCategory: 'build',
        since: '2020-01-01T00:00:00.000Z',
      });
      expect(events).toHaveLength(1);
      expect(events[0].stageCategory).toBe('build');
    });

    it('skips malformed JSONL lines gracefully', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent());

      // Append malformed lines
      const filePath = join(baseDir, 'tracking', 'analytics.jsonl');
      appendFileSync(filePath, 'not valid json\n');
      appendFileSync(filePath, '{"stageCategory":"invalid"}\n');

      const events = analytics.getEvents();
      expect(events).toHaveLength(1);
    });
  });

  describe('getStats()', () => {
    it('returns zero stats when no events exist', () => {
      const analytics = new UsageAnalytics(baseDir);
      const stats = analytics.getStats();

      expect(stats.totalRuns).toBe(0);
      expect(stats.runsByCategory).toEqual({});
      expect(stats.avgConfidence).toBe(0);
      expect(stats.outcomeDistribution).toEqual({ good: 0, partial: 0, poor: 0, unknown: 0 });
      expect(stats.avgDurationMs).toBeUndefined();
    });

    it('computes correct aggregates across multiple events', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({
        stageCategory: 'build',
        decisionConfidences: [0.8, 0.6],
        outcomeQuality: 'good',
        durationMs: 1000,
      }));
      analytics.recordEvent(makeEvent({
        stageCategory: 'review',
        decisionConfidences: [0.9, 0.7],
        outcomeQuality: 'partial',
        durationMs: 2000,
      }));
      analytics.recordEvent(makeEvent({
        stageCategory: 'build',
        decisionConfidences: [1.0],
        durationMs: 3000,
      }));

      const stats = analytics.getStats();

      expect(stats.totalRuns).toBe(3);
      expect(stats.runsByCategory).toEqual({ build: 2, review: 1 });
      // (0.8 + 0.6 + 0.9 + 0.7 + 1.0) / 5 = 4.0 / 5 = 0.8
      expect(stats.avgConfidence).toBeCloseTo(0.8, 5);
      expect(stats.outcomeDistribution).toEqual({ good: 1, partial: 1, poor: 0, unknown: 1 });
      // (1000 + 2000 + 3000) / 3 = 2000
      expect(stats.avgDurationMs).toBe(2000);
    });

    it('filters stats by stageCategory', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({
        stageCategory: 'build',
        decisionConfidences: [0.8],
        outcomeQuality: 'good',
      }));
      analytics.recordEvent(makeEvent({
        stageCategory: 'review',
        decisionConfidences: [0.6],
        outcomeQuality: 'poor',
      }));
      analytics.recordEvent(makeEvent({
        stageCategory: 'build',
        decisionConfidences: [0.9],
        outcomeQuality: 'good',
      }));

      const buildStats = analytics.getStats('build');

      expect(buildStats.totalRuns).toBe(2);
      expect(buildStats.runsByCategory).toEqual({ build: 2 });
      expect(buildStats.avgConfidence).toBeCloseTo(0.85, 5);
      expect(buildStats.outcomeDistribution).toEqual({ good: 2, partial: 0, poor: 0, unknown: 0 });
    });

    it('handles events with no outcomeQuality as unknown', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ outcomeQuality: undefined }));
      analytics.recordEvent(makeEvent({ outcomeQuality: undefined }));

      const stats = analytics.getStats();
      expect(stats.outcomeDistribution.unknown).toBe(2);
    });

    it('returns undefined avgDurationMs when no events have duration', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent());

      const stats = analytics.getStats();
      expect(stats.avgDurationMs).toBeUndefined();
    });

    it('handles events with optional tokenCost', () => {
      const analytics = new UsageAnalytics(baseDir);
      analytics.recordEvent(makeEvent({ tokenCost: 500 }));

      const events = analytics.getEvents();
      expect(events[0].tokenCost).toBe(500);
    });
  });
});
