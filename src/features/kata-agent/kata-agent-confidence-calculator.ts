import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import {
  KataAgentConfidenceProfileSchema,
  type KataAgentConfidenceProfile,
} from '@domain/types/kata-agent-confidence.js';
import { KataAgentObservabilityAggregator } from './kata-agent-observability-aggregator.js';

// ---------------------------------------------------------------------------
// Pure helpers — extracted for direct unit testing and mutation coverage
// ---------------------------------------------------------------------------

/**
 * Resolve which directory to use for agent registry persistence.
 * Prefers `agentDir`; falls back to legacy `katakaDir`.
 * Throws if neither is provided.
 */
export function resolveRegistryDir(agentDir?: string, katakaDir?: string): string {
  const dir = agentDir ?? katakaDir;
  if (!dir) {
    throw new Error('KataAgentConfidenceCalculator requires agentDir (or legacy katakaDir).');
  }
  return dir;
}

/**
 * Compute the average confidence from a list of learnings.
 * Returns 0 when the list is empty.
 */
export function computeAverageConfidence(learnings: ReadonlyArray<{ confidence: number }>): number {
  if (learnings.length === 0) return 0;
  return learnings.reduce((sum, l) => sum + l.confidence, 0) / learnings.length;
}

// ---------------------------------------------------------------------------
// KataAgentConfidenceCalculator — computes and persists per-agent confidence
// ---------------------------------------------------------------------------

export class KataAgentConfidenceCalculator {
  constructor(private readonly deps: {
    runsDir: string;
    knowledgeDir: string;
    agentDir?: string;
    /** Compatibility alias for the persisted .kata/kataka directory. */
    katakaDir?: string;
  }) {}

  /**
   * Compute a confidence profile for an agent from run observations and agent learnings.
   * Writes the result to the configured agent registry directory.
   */
  compute(agentId: string, agentName: string): KataAgentConfidenceProfile {
    const aggregator = new KataAgentObservabilityAggregator(this.deps.runsDir, this.deps.knowledgeDir);
    const stats = aggregator.computeStats(agentId, agentName);

    let overallConfidence = 0;
    let learningCount = 0;
    try {
      const store = new KnowledgeStore(this.deps.knowledgeDir);
      const agentLearnings = store.query({ tier: 'agent', agentId: agentName });
      learningCount = agentLearnings.length;
      overallConfidence = computeAverageConfidence(agentLearnings);
    } catch {
      // KnowledgeStore unavailable — leave defaults
    }

    const profile: KataAgentConfidenceProfile = {
      agentId,
      katakaId: agentId,
      katakaName: agentName,
      computedAt: new Date().toISOString(),
      domainScores: {},
      overallConfidence,
      observationCount: stats.observationCount,
      learningCount,
    };

    const registryDir = resolveRegistryDir(this.deps.agentDir, this.deps.katakaDir);
    const confidencePath = join(registryDir, agentId, 'confidence.json');
    mkdirSync(dirname(confidencePath), { recursive: true });
    JsonStore.write(confidencePath, profile, KataAgentConfidenceProfileSchema);

    return profile;
  }

  /**
   * Load a previously persisted confidence profile. Returns null if absent or corrupt.
   */
  load(agentId: string): KataAgentConfidenceProfile | null {
    const registryDir = resolveRegistryDir(this.deps.agentDir, this.deps.katakaDir);
    const confidencePath = join(registryDir, agentId, 'confidence.json');
    try {
      return JsonStore.read(confidencePath, KataAgentConfidenceProfileSchema);
    } catch {
      return null;
    }
  }
}
