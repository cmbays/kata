import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import {
  KataAgentConfidenceProfileSchema,
  type KataAgentConfidenceProfile,
} from '@domain/types/kata-agent-confidence.js';
import { KataAgentObservabilityAggregator } from './kata-agent-observability-aggregator.js';

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
    // 1. Get observability stats (observation counts, agent learning count)
    const aggregator = new KataAgentObservabilityAggregator(this.deps.runsDir, this.deps.knowledgeDir);
    const stats = aggregator.computeStats(agentId, agentName);

    // 2. Load agent-tier learnings from KnowledgeStore for this agent
    let overallConfidence = 0;
    let learningCount = 0;
    try {
      const store = new KnowledgeStore(this.deps.knowledgeDir);
      const agentLearnings = store.query({ tier: 'agent', agentId: agentName });
      learningCount = agentLearnings.length;
      if (agentLearnings.length > 0) {
        overallConfidence =
          agentLearnings.reduce((sum, l) => sum + l.confidence, 0) / agentLearnings.length;
      }
    } catch {
      // KnowledgeStore unavailable — leave defaults
    }

    // 3. domainScores: empty for now
    // TODO: compute per-domain scores from observation domain tags when available
    const domainScores: Record<string, never> = {};

    const profile: KataAgentConfidenceProfile = {
      agentId,
      katakaId: agentId,
      katakaName: agentName,
      computedAt: new Date().toISOString(),
      domainScores,
      overallConfidence,
      observationCount: stats.observationCount,
      learningCount,
    };

    // 4. Write to the configured agent directory
    const registryDir = this.deps.agentDir ?? this.deps.katakaDir;
    if (!registryDir) {
      throw new Error('KataAgentConfidenceCalculator requires agentDir (or legacy katakaDir).');
    }
    const confidencePath = join(registryDir, agentId, 'confidence.json');
    const dir = dirname(confidencePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    JsonStore.write(confidencePath, profile, KataAgentConfidenceProfileSchema);

    return profile;
  }

  /**
   * Load a previously persisted confidence profile. Returns null if absent or corrupt.
   */
  load(agentId: string): KataAgentConfidenceProfile | null {
    const registryDir = this.deps.agentDir ?? this.deps.katakaDir;
    if (!registryDir) {
      throw new Error('KataAgentConfidenceCalculator requires agentDir (or legacy katakaDir).');
    }
    const confidencePath = join(registryDir, agentId, 'confidence.json');
    if (!existsSync(confidencePath)) return null;
    try {
      return JsonStore.read(confidencePath, KataAgentConfidenceProfileSchema);
    } catch {
      return null;
    }
  }
}
