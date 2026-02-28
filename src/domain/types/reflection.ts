import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Shared base fields (present on every reflection variant)
// ---------------------------------------------------------------------------

const ReflectionBaseSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  /** IDs of observations that contributed to this reflection */
  observationIds: z.array(z.string().uuid()).default([]),
});

// ---------------------------------------------------------------------------
// Calibration — prediction accuracy analysis for a domain/kataka
// ---------------------------------------------------------------------------

const CalibrationReflectionSchema = ReflectionBaseSchema.extend({
  type: z.literal('calibration'),
  domain: z.string().min(1),
  katakaId: z.string().optional(),
  totalPredictions: z.number().int().min(0),
  correctPredictions: z.number().int().min(0),
  accuracyRate: z.number().min(0).max(1),
  /** Detected systematic bias (e.g. overconfidence, domain-bias) */
  bias: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Validation — a single prediction checked against its outcome
// ---------------------------------------------------------------------------

const ValidationReflectionSchema = ReflectionBaseSchema.extend({
  type: z.literal('validation'),
  predictionId: z.string().uuid(),
  outcomeId: z.string().uuid(),
  correct: z.boolean(),
  notes: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Resolution — a friction resolved through one of 4 resolution paths
// ---------------------------------------------------------------------------

export const FrictionResolutionPath = z.enum([
  'invalidate',
  'scope',
  'synthesize',
  'escalate',
]);

export type FrictionResolutionPath = z.infer<typeof FrictionResolutionPath>;

const ResolutionReflectionSchema = ReflectionBaseSchema.extend({
  type: z.literal('resolution'),
  frictionId: z.string().uuid(),
  path: FrictionResolutionPath,
  summary: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Unmatched — prediction with no matching outcome (inconclusive)
// ---------------------------------------------------------------------------

const UnmatchedReflectionSchema = ReflectionBaseSchema.extend({
  type: z.literal('unmatched'),
  predictionId: z.string().uuid(),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Synthesis — multiple reflections consolidated into a higher-level insight
// ---------------------------------------------------------------------------

const SynthesisReflectionSchema = ReflectionBaseSchema.extend({
  type: z.literal('synthesis'),
  /** IDs of the source reflections this was synthesized from */
  sourceReflectionIds: z.array(z.string().uuid()).default([]),
  insight: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const ReflectionSchema = z.discriminatedUnion('type', [
  CalibrationReflectionSchema,
  ValidationReflectionSchema,
  ResolutionReflectionSchema,
  UnmatchedReflectionSchema,
  SynthesisReflectionSchema,
]);

export type Reflection = z.infer<typeof ReflectionSchema>;

// Re-export member schemas for consumers that need the narrowed types
export {
  CalibrationReflectionSchema,
  ValidationReflectionSchema,
  ResolutionReflectionSchema,
  UnmatchedReflectionSchema,
  SynthesisReflectionSchema,
};
