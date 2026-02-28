import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Shared base fields (present on every observation variant)
// ---------------------------------------------------------------------------

const ObservationBaseSchema = z.object({
  id: z.string().uuid(),
  timestamp: z.string().datetime(),
  content: z.string().min(1),
  /** Agent that recorded this observation (populated when kataka ship in Wave G) */
  katakaId: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export const PredictionQuantitativeSchema = z.object({
  metric: z.string().min(1),
  predicted: z.number(),
  unit: z.string().min(1),
});

export type PredictionQuantitative = z.infer<typeof PredictionQuantitativeSchema>;

export const PredictionQualitativeSchema = z.object({
  expected: z.string().min(1),
});

export type PredictionQualitative = z.infer<typeof PredictionQualitativeSchema>;

const PredictionObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('prediction'),
  quantitative: PredictionQuantitativeSchema.optional(),
  qualitative: PredictionQualitativeSchema.optional(),
  timeframe: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Friction taxonomy
// ---------------------------------------------------------------------------

export const FrictionTaxonomy = z.enum([
  'stale-learning',
  'config-drift',
  'convention-clash',
  'tool-mismatch',
  'scope-creep',
]);

export type FrictionTaxonomy = z.infer<typeof FrictionTaxonomy>;

const FrictionObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('friction'),
  /** What this observation contradicts (ID or description) */
  contradicts: z.string().optional(),
  taxonomy: FrictionTaxonomy,
});

// ---------------------------------------------------------------------------
// Gap severity
// ---------------------------------------------------------------------------

export const GapSeverity = z.enum(['critical', 'major', 'minor']);

export type GapSeverity = z.infer<typeof GapSeverity>;

const GapObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('gap'),
  severity: GapSeverity,
});

// ---------------------------------------------------------------------------
// Simple variants (no extra fields beyond the base)
// ---------------------------------------------------------------------------

const DecisionObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('decision'),
});

const OutcomeObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('outcome'),
});

const AssumptionObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('assumption'),
});

const InsightObservationSchema = ObservationBaseSchema.extend({
  type: z.literal('insight'),
});

// ---------------------------------------------------------------------------
// Discriminated union
// ---------------------------------------------------------------------------

export const ObservationSchema = z.discriminatedUnion('type', [
  DecisionObservationSchema,
  PredictionObservationSchema,
  FrictionObservationSchema,
  GapObservationSchema,
  OutcomeObservationSchema,
  AssumptionObservationSchema,
  InsightObservationSchema,
]);

export type Observation = z.infer<typeof ObservationSchema>;

// Re-export member schemas for consumers that need the narrowed types
export {
  DecisionObservationSchema,
  PredictionObservationSchema,
  FrictionObservationSchema,
  GapObservationSchema,
  OutcomeObservationSchema,
  AssumptionObservationSchema,
  InsightObservationSchema,
};
