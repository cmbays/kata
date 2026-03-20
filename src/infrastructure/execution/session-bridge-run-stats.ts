import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { Cycle } from '@domain/types/cycle.js';
import { readBridgeRunMeta } from '@infra/persistence/bridge-run-store.js';
import {
  computeBudgetPercent,
  countJsonlContent,
  extractHistoryTokenTotal,
  isJsonFile,
} from './session-bridge.helpers.js';
import { KATA_DIRS } from '@shared/constants/paths.js';

/**
 * Count observations, artifacts, and decisions for a run.
 * Includes both run-level and stage-level JSONL files.
 */
export function countRunData(
  kataDir: string,
  runId: string,
): { observations: number; artifacts: number; decisions: number; lastTimestamp: string | null } {
  const runsDir = join(kataDir, KATA_DIRS.runs);
  const runDir = join(runsDir, runId);

  if (!existsSync(runDir)) {
    return { observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null };
  }

  let observations = countJsonlLines(join(runDir, 'observations.jsonl'));
  const artifacts = countJsonlLines(join(runDir, 'artifacts.jsonl'));
  let decisions = countJsonlLines(join(runDir, 'decisions.jsonl'));

  const stagesDir = join(runDir, 'stages');
  if (existsSync(stagesDir)) {
    for (const stageDir of readdirSync(stagesDir)) {
      observations += countJsonlLines(join(stagesDir, stageDir, 'observations.jsonl'));
      decisions += countJsonlLines(join(stagesDir, stageDir, 'decisions.jsonl'));
    }
  }

  const bridgeRunsDir = join(kataDir, KATA_DIRS.bridgeRuns);
  const lastTimestamp = resolveLastActivityTimestamp(bridgeRunsDir, runId);

  return { observations, artifacts, decisions, lastTimestamp };
}

/**
 * Estimate budget usage for a cycle from history entry token totals.
 */
export function estimateBudgetUsage(
  kataDir: string,
  cycle: Cycle,
): { percent: number; tokenEstimate: number } | null {
  if (!cycle.budget.tokenBudget) return null;

  const historyDir = join(kataDir, KATA_DIRS.history);
  if (!existsSync(historyDir)) return { percent: 0, tokenEstimate: 0 };

  const totalTokens = sumCycleHistoryTokens(historyDir, cycle.id);
  return computeBudgetPercent(totalTokens, cycle.budget.tokenBudget);
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

// ── Internal helpers ───────────────────────────────────────────────────

function countJsonlLines(filePath: string): number {
  // Stryker disable next-line ConditionalExpression: guard redundant with catch — readFileSync throws for missing file
  if (!existsSync(filePath)) return 0;
  try {
    return countJsonlContent(readFileSync(filePath, 'utf-8'));
  } catch {
    return 0;
  }
}

function resolveLastActivityTimestamp(bridgeRunsDir: string, runId: string): string | null {
  const meta = readBridgeRunMeta(bridgeRunsDir, runId);
  return meta?.completedAt ?? meta?.startedAt ?? null;
}

function sumCycleHistoryTokens(historyDir: string, cycleId: string): number {
  let totalTokens = 0;

  for (const file of readdirSync(historyDir).filter(isJsonFile)) {
    try {
      const entry = JSON.parse(readFileSync(join(historyDir, file), 'utf-8'));
      totalTokens += extractHistoryTokenTotal(entry, cycleId) ?? 0;
    } catch {
      // Skip invalid history entries
    }
  }

  return totalTokens;
}
