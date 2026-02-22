import { z } from 'zod/v4';

export const LearningTier = z.enum(['stage', 'category', 'agent']);

export type LearningTier = z.infer<typeof LearningTier>;

export const LearningEvidenceSchema = z.object({
  pipelineId: z.string(),
  stageType: z.string(),
  observation: z.string(),
  recordedAt: z.string().datetime(),
});

export type LearningEvidence = z.infer<typeof LearningEvidenceSchema>;

export const LearningSchema = z.object({
  id: z.string().uuid(),
  tier: LearningTier,
  category: z.string().min(1),
  content: z.string().min(1),
  evidence: z.array(LearningEvidenceSchema).default([]),
  /** Confidence score 0-1, derived from evidence count and consistency */
  confidence: z.number().min(0).max(1).default(0),
  /** Which stage type this applies to (Tier 1) */
  stageType: z.string().optional(),
  /** Which agent this belongs to (Tier 3) */
  agentId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Learning = z.infer<typeof LearningSchema>;

export const LearningFilterSchema = z.object({
  tier: LearningTier.optional(),
  category: z.string().optional(),
  stageType: z.string().optional(),
  agentId: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
});

export type LearningFilter = z.infer<typeof LearningFilterSchema>;
