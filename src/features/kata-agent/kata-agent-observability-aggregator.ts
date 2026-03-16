import { readdirSync } from 'node:fs';
import { RunSchema } from '@domain/types/run-state.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { readObservations, runPaths } from '@infra/persistence/run-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';

// ---------------------------------------------------------------------------
// KataAgentObservabilityStats — runtime stats for a single kata agent
// ---------------------------------------------------------------------------

export interface KataAgentObservabilityStats {
  agentId: string;
  /** Compatibility alias retained for older kataka-attributed views. */
  katakaId: string;
  katakaName: string;
  /** Observations attributed to this agent. */
  observationCount: number;
  /** Observation counts keyed by type (e.g. { prediction: 3, friction: 1 }) */
  observationsByType: Record<string, number>;
  /**
   * Decisions attributed to this agent.
   * Currently always 0 until decision analytics are wired in.
   */
  decisionCount: number;
  /** Average decision confidence. Always 0 until decisionCount > 0. */
  avgDecisionConfidence: number;
  /** Learnings in KnowledgeStore with tier='agent' and agentId === katakaName */
  agentLearningCount: number;
  /** ID of the most recent run this agent was assigned to. */
  lastRunId?: string;
  /** Cycle ID of the most recent run */
  lastRunCycleId?: string;
  /** ISO datetime of the most recent run's startedAt */
  lastActiveAt?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers — extracted for direct unit testing and mutation coverage
// ---------------------------------------------------------------------------

export function isNewerRun(startedAt: string, latestStartedAt: string | undefined): boolean {
  return latestStartedAt === undefined || startedAt > latestStartedAt;
}

export function listRunDirectoryIds(runsDir: string): string[] {
  try {
    return readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// KataAgentObservabilityAggregator
// ---------------------------------------------------------------------------

/**
 * Reads run data on disk and computes runtime observability stats for one kata agent.
 *
 * Algorithm:
 * 1. List all run directories in runsDir (each has a run.json).
 * 2. For each run whose run attribution matches the requested agent ID:
 *    a. Read run-level and stage-level observations.jsonl.
 *    b. Filter observations where observation attribution matches the agent ID.
 *    c. Count by type and track the most recent run.
 * 3. Query KnowledgeStore for tier='agent' learnings with agentId === agentName.
 * 4. Decisions: returns 0 / 0 until decision-level analytics are added.
 */
export class KataAgentObservabilityAggregator {
  constructor(
    private readonly runsDir: string,
    private readonly knowledgeDir: string,
  ) {}

  computeStats(agentId: string, agentName: string): KataAgentObservabilityStats {
    const stats: KataAgentObservabilityStats = {
      agentId,
      katakaId: agentId,
      katakaName: agentName,
      observationCount: 0,
      observationsByType: {},
      decisionCount: 0,
      avgDecisionConfidence: 0,
      agentLearningCount: 0,
    };

    // --- Step 1: list run directories ---
    const runIds = listRunDirectoryIds(this.runsDir);

    // Track the most-recent run by startedAt (ISO string — lexicographic comparison is valid)
    let latestStartedAt: string | undefined;

    for (const runId of runIds) {
      // --- Step 2: read run.json and check agent attribution ---
      let run: { id: string; cycleId: string; agentId?: string; katakaId?: string; startedAt: string };
      try {
        const rp = runPaths(this.runsDir, runId);
        run = JsonStore.read(rp.runJson, RunSchema);
      } catch {
        // Malformed or missing run.json — skip
        continue;
      }

      if ((run.agentId ?? run.katakaId) !== agentId) continue;

      // Track the most recent run
      if (isNewerRun(run.startedAt, latestStartedAt)) {
        latestStartedAt = run.startedAt;
        stats.lastRunId = run.id;
        stats.lastRunCycleId = run.cycleId;
        stats.lastActiveAt = run.startedAt;
      }

      // --- Step 2a: collect run-level observations ---
      const runObs = readObservations(this.runsDir, runId, { level: 'run' });

      // --- Step 2a: collect stage-level observations for all four gyo ---
      const stageCategories = ['research', 'plan', 'build', 'review'] as const;
      const stageObs = stageCategories.flatMap((cat) => {
        try {
          return readObservations(this.runsDir, runId, { level: 'stage', category: cat });
        } catch {
          return [];
        }
      });

      const allObs = [...runObs, ...stageObs];

      // --- Step 2b: filter to observations attributed to this agent ---
      const attributed = allObs.filter((o) => (o.agentId ?? o.katakaId) === agentId);

      // --- Step 2c: count by type ---
      for (const obs of attributed) {
        stats.observationCount++;
        stats.observationsByType[obs.type] = (stats.observationsByType[obs.type] ?? 0) + 1;
      }
    }

    // --- Step 3: query KnowledgeStore for agent-tier learnings ---
    try {
      const knowledge = new KnowledgeStore(this.knowledgeDir);
      const agentLearnings = knowledge.loadForAgent(agentName);
      stats.agentLearningCount = agentLearnings.length;
    } catch {
      // Knowledge store unavailable — leave at 0
    }

    // Step 4: decisionCount / avgDecisionConfidence remain 0 (future work)

    return stats;
  }
}
