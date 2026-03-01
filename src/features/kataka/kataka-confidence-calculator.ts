import { existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import {
  KatakaConfidenceProfileSchema,
  type KatakaConfidenceProfile,
} from '@domain/types/kataka-confidence.js';
import { KatakaObservabilityAggregator } from './kataka-observability-aggregator.js';

// ---------------------------------------------------------------------------
// KatakaConfidenceCalculator — computes and persists per-kataka confidence
// ---------------------------------------------------------------------------

export class KatakaConfidenceCalculator {
  constructor(private readonly deps: {
    runsDir: string;
    knowledgeDir: string;
    katakaDir: string;
  }) {}

  /**
   * Compute a confidence profile for a kataka from run observations and agent learnings.
   * Writes the result to .kata/kataka/<katakaId>/confidence.json.
   */
  compute(katakaId: string, katakaName: string): KatakaConfidenceProfile {
    // 1. Get observability stats (observation counts, agent learning count)
    const aggregator = new KatakaObservabilityAggregator(this.deps.runsDir, this.deps.knowledgeDir);
    const stats = aggregator.computeStats(katakaId, katakaName);

    // 2. Load agent-tier learnings from KnowledgeStore for this kataka
    let overallConfidence = 0;
    let learningCount = 0;
    try {
      const store = new KnowledgeStore(this.deps.knowledgeDir);
      const agentLearnings = store.query({ tier: 'agent', agentId: katakaName });
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

    const profile: KatakaConfidenceProfile = {
      katakaId,
      katakaName,
      computedAt: new Date().toISOString(),
      domainScores,
      overallConfidence,
      observationCount: stats.observationCount,
      learningCount,
    };

    // 4. Write to .kata/kataka/<katakaId>/confidence.json
    const confidencePath = join(this.deps.katakaDir, katakaId, 'confidence.json');
    const dir = dirname(confidencePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    JsonStore.write(confidencePath, profile, KatakaConfidenceProfileSchema);

    return profile;
  }

  /**
   * Load a previously persisted confidence profile. Returns null if absent or corrupt.
   */
  load(katakaId: string): KatakaConfidenceProfile | null {
    const confidencePath = join(this.deps.katakaDir, katakaId, 'confidence.json');
    if (!existsSync(confidencePath)) return null;
    try {
      return JsonStore.read(confidencePath, KatakaConfidenceProfileSchema);
    } catch {
      return null;
    }
  }
}
