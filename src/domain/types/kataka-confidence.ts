import { z } from 'zod/v4';
import { DomainConfidenceScoreSchema } from './domain-tags.js';

// ---------------------------------------------------------------------------
// KatakaConfidenceProfileSchema — per-kataka confidence profile (Wave J)
// ---------------------------------------------------------------------------

export const KatakaConfidenceProfileSchema = z.object({
  katakaId: z.string().uuid(),
  katakaName: z.string(),
  computedAt: z.string().datetime(),
  /** Per-domain confidence keyed by DomainArea value */
  domainScores: z.record(z.string(), DomainConfidenceScoreSchema),
  /** Weighted average across all domains with nonzero sampleSize */
  overallConfidence: z.number().min(0).max(1),
  /** Total observations attributed to this kataka across all runs */
  observationCount: z.number().int().min(0),
  /** Agent-tier learnings attributed to this kataka in KnowledgeStore */
  learningCount: z.number().int().min(0),
});

export type KatakaConfidenceProfile = z.infer<typeof KatakaConfidenceProfileSchema>;
