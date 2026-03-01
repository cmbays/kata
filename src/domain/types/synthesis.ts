import { z } from 'zod/v4';
import { LearningTier } from './learning.js';
import type { Observation } from './observation.js';
import { ObservationSchema } from './observation.js';
import { LearningSchema } from './learning.js';
import type { Learning } from './learning.js';

// ---------------------------------------------------------------------------
// SynthesisDepth — controls filter breadth and model selection
// ---------------------------------------------------------------------------

export const SynthesisDepth = z.enum(['quick', 'standard', 'thorough']);

export type SynthesisDepth = z.infer<typeof SynthesisDepth>;

// ---------------------------------------------------------------------------
// SynthesisProposalType
// ---------------------------------------------------------------------------

export const SynthesisProposalType = z.enum([
  'new-learning',
  'update-learning',
  'promote',
  'archive',
  'methodology-recommendation',
]);

export type SynthesisProposalType = z.infer<typeof SynthesisProposalType>;

// ---------------------------------------------------------------------------
// Base shared fields
// ---------------------------------------------------------------------------

const SynthesisProposalBaseSchema = z.object({
  id: z.string().uuid(),
  confidence: z.number().min(0).max(1),
  /** Observation or learning UUIDs supporting this proposal. Minimum 2 required at application time. */
  citations: z.array(z.string()),
  reasoning: z.string(),
  createdAt: z.string().datetime(),
});

// ---------------------------------------------------------------------------
// Discriminated union variants
// ---------------------------------------------------------------------------

export const NewLearningProposalSchema = SynthesisProposalBaseSchema.extend({
  type: z.literal('new-learning'),
  proposedContent: z.string(),
  proposedTier: LearningTier,
  proposedCategory: z.string(),
});

export const UpdateLearningProposalSchema = SynthesisProposalBaseSchema.extend({
  type: z.literal('update-learning'),
  targetLearningId: z.string().uuid(),
  proposedContent: z.string(),
  /** Signed delta applied to the learning's confidence score. Range: -1 to 1. */
  confidenceDelta: z.number().min(-1).max(1),
});

export const PromoteProposalSchema = SynthesisProposalBaseSchema.extend({
  type: z.literal('promote'),
  targetLearningId: z.string().uuid(),
  fromTier: LearningTier,
  toTier: LearningTier,
});

export const ArchiveProposalSchema = SynthesisProposalBaseSchema.extend({
  type: z.literal('archive'),
  targetLearningId: z.string().uuid(),
  reason: z.string(),
});

export const MethodologyRecommendationProposalSchema = SynthesisProposalBaseSchema.extend({
  type: z.literal('methodology-recommendation'),
  recommendation: z.string(),
  area: z.string(),
});

// ---------------------------------------------------------------------------
// SynthesisProposalSchema — discriminated union
// ---------------------------------------------------------------------------

export const SynthesisProposalSchema = z.discriminatedUnion('type', [
  NewLearningProposalSchema,
  UpdateLearningProposalSchema,
  PromoteProposalSchema,
  ArchiveProposalSchema,
  MethodologyRecommendationProposalSchema,
]);

export type SynthesisProposal = z.infer<typeof SynthesisProposalSchema>;
export type NewLearningProposal = z.infer<typeof NewLearningProposalSchema>;
export type UpdateLearningProposal = z.infer<typeof UpdateLearningProposalSchema>;
export type PromoteProposal = z.infer<typeof PromoteProposalSchema>;
export type ArchiveProposal = z.infer<typeof ArchiveProposalSchema>;
export type MethodologyRecommendationProposal = z.infer<typeof MethodologyRecommendationProposalSchema>;

// ---------------------------------------------------------------------------
// SynthesisInputSchema
// Written to .kata/synthesis/pending-<id>.json by cooldown --prepare
// ---------------------------------------------------------------------------

export const SynthesisInputSchema = z.object({
  /** Matches the pending file suffix */
  id: z.string().uuid(),
  cycleId: z.string().uuid(),
  createdAt: z.string().datetime(),
  depth: SynthesisDepth,
  /** All observations gathered from all runs in this cycle */
  observations: z.array(ObservationSchema),
  /** Current active learnings from KnowledgeStore at the time of preparation */
  learnings: z.array(LearningSchema),
  cycleName: z.string().optional(),
  tokenBudget: z.number().optional(),
  tokensUsed: z.number().optional(),
});

export type SynthesisInput = z.infer<typeof SynthesisInputSchema>;

// Re-export the component types so consumers don't need to import from learning/observation separately
export type { Observation, Learning };

// ---------------------------------------------------------------------------
// SynthesisResultSchema
// Written to .kata/synthesis/result-<id>.json after synthesis
// ---------------------------------------------------------------------------

export const SynthesisResultSchema = z.object({
  /** Matches the pending file id */
  inputId: z.string().uuid(),
  proposals: z.array(SynthesisProposalSchema),
  appliedAt: z.string().datetime().optional(),
  /** IDs of proposals the user accepted */
  appliedProposalIds: z.array(z.string()).optional(),
});

export type SynthesisResult = z.infer<typeof SynthesisResultSchema>;
