import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// LearningTier — extended with step (waza) and flavor (ryu) in Wave F
// ---------------------------------------------------------------------------

export const LearningTier = z.enum(['step', 'flavor', 'stage', 'category', 'agent']);

export type LearningTier = z.infer<typeof LearningTier>;

// ---------------------------------------------------------------------------
// Legacy evidence (pre-Wave F — still supported for backwards compat)
// ---------------------------------------------------------------------------

export const LearningEvidenceSchema = z.object({
  pipelineId: z.string(),
  stageType: z.string(),
  observation: z.string(),
  recordedAt: z.string().datetime(),
});

export type LearningEvidence = z.infer<typeof LearningEvidenceSchema>;

// ---------------------------------------------------------------------------
// Graph fields (Wave F)
// ---------------------------------------------------------------------------

/** A citation linking a learning back to a source observation entry. */
export const CitationSchema = z.object({
  observationId: z.string().uuid(),
  /** Human-readable path hint — e.g. "run-1/build/obs-3" */
  path: z.string().optional(),
  citedAt: z.string().datetime(),
});

export type Citation = z.infer<typeof CitationSchema>;

/** A reinforcement event: additional evidence that strengthened a learning. */
export const ReinforcementSchema = z.object({
  observationId: z.string().uuid(),
  reinforcedAt: z.string().datetime(),
  /** Confidence delta applied at reinforcement time */
  confidenceDelta: z.number().optional(),
});

export type Reinforcement = z.infer<typeof ReinforcementSchema>;

/** A snapshot of the learning's previous state before it was updated. */
export const LearningVersionSchema = z.object({
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string().datetime(),
  /** Summary of what changed */
  changeReason: z.string().optional(),
});

export type LearningVersion = z.infer<typeof LearningVersionSchema>;

// ---------------------------------------------------------------------------
// Learning permanence tier
// ---------------------------------------------------------------------------

export const LearningPermanence = z.enum([
  'operational',  // Short-lived; auto-archived when TTL expires
  'strategic',    // Long-lived; flagged stale in cooldown if not reinforced
  'constitutional', // Permanent; can only be archived or overridden, never modified
]);

export type LearningPermanence = z.infer<typeof LearningPermanence>;

// ---------------------------------------------------------------------------
// Learning source
// ---------------------------------------------------------------------------

export const LearningSource = z.enum([
  'extracted',    // Pattern detected by LearningExtractor from execution history/observations
  'synthesized',  // Created by LLM synthesis pipeline during cooldown
  'imported',     // Loaded from a constitutional pack or external source
  'user',         // Manually created by the user
]);

export type LearningSource = z.infer<typeof LearningSource>;

// ---------------------------------------------------------------------------
// LearningSchema — enriched with knowledge graph fields
// ---------------------------------------------------------------------------

export const LearningSchema = z.object({
  id: z.string().uuid(),
  tier: LearningTier,
  category: z.string().min(1),
  content: z.string().min(1),
  /** Legacy evidence entries (pre-Wave F) */
  evidence: z.array(LearningEvidenceSchema).default([]),
  /** Confidence score 0-1, derived from evidence count and consistency */
  confidence: z.number().min(0).max(1).default(0),
  /** Which stage type this applies to (Tier 1 — stage tier) */
  stageType: z.string().optional(),
  /** Which agent this belongs to (Tier 3 — agent tier) */
  agentId: z.string().optional(),

  // -- Wave F graph fields -------------------------------------------------

  /** Direct links back to the source observations that spawned this learning */
  citations: z.array(CitationSchema).default([]),
  /** UUIDs of parent learnings this was synthesized from */
  derivedFrom: z.array(z.string().uuid()).default([]),
  /** Additional evidence events that reinforced this learning after creation */
  reinforcedBy: z.array(ReinforcementSchema).default([]),
  /** How many times this learning has been injected into agent prompts */
  usageCount: z.number().int().min(0).default(0),
  /** When this learning was last injected into an agent prompt */
  lastUsedAt: z.string().datetime().optional(),
  /** Full mutation history — previous states pushed here on each update */
  versions: z.array(LearningVersionSchema).default([]),
  /** Soft-delete flag — archived learnings are retained for provenance */
  archived: z.boolean().default(false),
  /** Permanence tier — affects TTL and immutability rules */
  permanence: LearningPermanence.optional(),
  /** How this learning was created */
  source: LearningSource.optional(),
  /** UUIDs of learnings this learning supersedes */
  overrides: z.array(z.string().uuid()).optional(),
  /** When this learning should be re-evaluated (strategic and constitutional) */
  refreshBy: z.string().datetime().optional(),
  /** When this learning auto-archives (operational learnings) */
  expiresAt: z.string().datetime().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Learning = z.infer<typeof LearningSchema>;
/** Input type for LearningSchema — fields with defaults (citations, derivedFrom, etc.) are optional */
export type LearningInput = z.input<typeof LearningSchema>;

// ---------------------------------------------------------------------------
// LearningFilterSchema — extended for graph-aware querying
// ---------------------------------------------------------------------------

export const LearningFilterSchema = z.object({
  tier: LearningTier.optional(),
  category: z.string().optional(),
  stageType: z.string().optional(),
  agentId: z.string().optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  /** When true, include archived learnings in results */
  includeArchived: z.boolean().optional(),
  permanence: LearningPermanence.optional(),
  source: LearningSource.optional(),
});

export type LearningFilter = z.infer<typeof LearningFilterSchema>;
