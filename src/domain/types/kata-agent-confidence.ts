import { z } from 'zod/v4';
import { DomainConfidenceScoreSchema } from './domain-tags.js';

// ---------------------------------------------------------------------------
// KataAgentConfidenceProfileSchema — per-agent confidence profile (Wave J)
// ---------------------------------------------------------------------------

export const KataAgentConfidenceProfileSchema = z.object({
  /** Canonical agent attribution for new records. */
  agentId: z.string().uuid().optional(),
  /** Compatibility alias retained for older kataka-attributed records. */
  katakaId: z.string().uuid(),
  /** Human-readable agent display name used for summaries and lookups. */
  katakaName: z.string(),
  computedAt: z.string().datetime(),
  /** Per-domain confidence keyed by DomainArea value */
  domainScores: z.record(z.string(), DomainConfidenceScoreSchema),
  /** Weighted average across all domains with nonzero sampleSize */
  overallConfidence: z.number().min(0).max(1),
  /** Total observations attributed to this agent across all runs. */
  observationCount: z.number().int().min(0),
  /** Agent-tier learnings attributed to this agent in KnowledgeStore. */
  learningCount: z.number().int().min(0),
});

export type KataAgentConfidenceProfile = z.infer<typeof KataAgentConfidenceProfileSchema>;
