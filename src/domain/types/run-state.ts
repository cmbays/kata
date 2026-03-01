import { z } from 'zod/v4';
import { StageCategorySchema } from './stage.js';

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

export const RunStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const StageStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);
export type StageStatus = z.infer<typeof StageStatusSchema>;

export const FlavorStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);
export type FlavorStatus = z.infer<typeof FlavorStatusSchema>;

export const StepRunStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'skipped']);
export type StepRunStatus = z.infer<typeof StepRunStatusSchema>;

// ---------------------------------------------------------------------------
// run.json — overall run state
// ---------------------------------------------------------------------------

/**
 * Top-level run record stored at .kata/runs/<run-id>/run.json.
 * Created by `kata cycle start` for each bet; tracks the big-picture state
 * of a single bet's execution through its kata stage sequence.
 */
export const RunSchema = z.object({
  /** UUID for this run. */
  id: z.string().uuid(),
  /** ID of the cycle that owns this run. */
  cycleId: z.string().uuid(),
  /** ID of the bet this run is executing. */
  betId: z.string().uuid(),
  /** The original bet prompt / description. */
  betPrompt: z.string().min(1),
  /** Named kata pattern (e.g. "full-feature") or undefined for ad-hoc. */
  kataPattern: z.string().optional(),
  /** Ordered stage categories the run will execute. */
  stageSequence: z.array(StageCategorySchema).min(1),
  /** The stage the run is currently executing, or null if not yet started. */
  currentStage: StageCategorySchema.nullable(),
  /** Overall run status. */
  status: RunStatusSchema,
  /** ISO 8601 timestamp when the run was created. */
  startedAt: z.string().datetime(),
  /** ISO 8601 timestamp when the run finished (completed or failed). */
  completedAt: z.string().datetime().optional(),
  /**
   * ID of the kataka (agent) driving this run. When set, observations recorded
   * during the run auto-populate `katakaId` on each observation. (Wave G)
   */
  katakaId: z.string().uuid().optional(),
});

export type Run = z.infer<typeof RunSchema>;

// ---------------------------------------------------------------------------
// Stage state.json
// ---------------------------------------------------------------------------

/**
 * A gap identified by the orchestrator's gap-analysis phase.
 * Stored in StageState.gaps so the TUI, reflect phase, and cooldown can
 * display and act on gap severity independently.
 */
export const GapSchema = z.object({
  /** Human-readable description of the gap. */
  description: z.string().min(1),
  /** Severity level, used for TUI display and prioritization. */
  severity: z.enum(['low', 'medium', 'high']),
});

export type Gap = z.infer<typeof GapSchema>;

/**
 * A pending gate blocking stage or flavor progress.
 * Written when an entry/exit gate is triggered; cleared on approval.
 * `kata approve` reads and clears this field; `kata run status` surfaces it.
 */
export const PendingGateSchema = z.object({
  /** Short unique identifier used by `kata approve`. */
  gateId: z.string().min(1),
  /** Gate type descriptor (e.g. "human-approved", "confidence-gate"). */
  gateType: z.string().min(1),
  /**
   * What is blocked by this gate — a flavor name, step name, or "stage"
   * for a stage-level gate.
   */
  requiredBy: z.string().min(1),
});

export type PendingGate = z.infer<typeof PendingGateSchema>;

/**
 * A gate that has been approved (moved from pending to resolved).
 * Appended to `StageState.approvedGates` by `kata approve`.
 */
export const ApprovedGateSchema = z.object({
  /** Short unique identifier matching the originating PendingGate.gateId. */
  gateId: z.string().min(1),
  /** Gate type descriptor (e.g. "human-approved", "confidence-gate"). */
  gateType: z.string().min(1),
  /** What was blocked by this gate (flavor name, step name, or "stage"). */
  requiredBy: z.string().min(1),
  /** ISO 8601 timestamp when the gate was approved. */
  approvedAt: z.string().datetime(),
  /** Who (or what) approved the gate. */
  approver: z.enum(['human', 'agent']),
});

export type ApprovedGate = z.infer<typeof ApprovedGateSchema>;

/**
 * Per-stage state stored at .kata/runs/<run-id>/stages/<category>/state.json.
 */
export const StageStateSchema = z.object({
  /** Which stage category this represents. */
  category: StageCategorySchema,
  /** Stage execution status. */
  status: StageStatusSchema,
  /** Flavors selected by the orchestrator for this stage. */
  selectedFlavors: z.array(z.string()).default([]),
  /** How flavors are being run: parallel or sequential. */
  executionMode: z.enum(['parallel', 'sequential']).optional(),
  /** Gap analysis findings from the orchestrator's gap-assessment phase. */
  gaps: z.array(GapSchema).default([]),
  /** Path to the stage-level synthesis artifact (relative to run dir). */
  synthesisArtifact: z.string().optional(),
  /** Decision IDs recorded during this stage. */
  decisions: z.array(z.string().uuid()).default([]),
  /**
   * Gate currently blocking this stage, if any.
   * Set when a gate triggers; cleared by `kata approve`.
   */
  pendingGate: PendingGateSchema.optional(),
  /**
   * Gates that have been resolved (approved) for this stage.
   * Populated by `kata approve`; preserves the approval history.
   */
  approvedGates: z.array(ApprovedGateSchema).default([]),
  /** ISO 8601 timestamp when this stage started. */
  startedAt: z.string().datetime().optional(),
  /** ISO 8601 timestamp when this stage finished. */
  completedAt: z.string().datetime().optional(),
});

export type StageState = z.infer<typeof StageStateSchema>;

// ---------------------------------------------------------------------------
// Flavor state.json
// ---------------------------------------------------------------------------

/** Per-step execution record within a flavor. */
export const FlavorStepRunSchema = z.object({
  /** Step type identifier (matches Step.type). */
  type: z.string().min(1),
  /** Execution status of this step. */
  status: StepRunStatusSchema,
  /** Relative paths to artifacts produced by this step. */
  artifacts: z.array(z.string()).default([]),
  /** ISO 8601 timestamp when this step started. */
  startedAt: z.string().datetime().optional(),
  /** ISO 8601 timestamp when this step finished. */
  completedAt: z.string().datetime().optional(),
});

export type FlavorStepRun = z.infer<typeof FlavorStepRunSchema>;

/**
 * Per-flavor state stored at .kata/runs/<run-id>/stages/<category>/flavors/<name>/state.json.
 */
export const FlavorStateSchema = z.object({
  /** Flavor name (matches Flavor.name). */
  name: z.string().min(1),
  /** Stage category this flavor belongs to. */
  stageCategory: StageCategorySchema,
  /** Flavor execution status. */
  status: FlavorStatusSchema,
  /** Ordered step execution records. */
  steps: z.array(FlavorStepRunSchema).default([]),
  /** Index of the currently executing step, or null if none. */
  currentStep: z.number().int().nonnegative().nullable(),
});

export type FlavorState = z.infer<typeof FlavorStateSchema>;

// ---------------------------------------------------------------------------
// decisions.jsonl entries
// ---------------------------------------------------------------------------

/**
 * An entry appended to decisions.jsonl.
 * Immutable once written — outcomes are recorded in decision-outcomes.jsonl.
 */
export const DecisionEntrySchema = z.object({
  /** UUID generated at record time. */
  id: z.string().uuid(),
  /** Which stage the decision was made in. */
  stageCategory: StageCategorySchema,
  /** Which flavor the decision belongs to (nullable for stage-level decisions). */
  flavor: z.string().nullable(),
  /** Which step the decision belongs to (nullable for flavor/stage-level decisions). */
  step: z.string().nullable(),
  /** Category of judgment being made (open string — warns on unknown). */
  decisionType: z.string().min(1),
  /** Contextual snapshot at decision time. */
  context: z.record(z.string(), z.unknown()),
  /** Available options the orchestrator considered. */
  options: z.array(z.string()),
  /** The chosen option. */
  selection: z.string().min(1),
  /** Orchestrator's reasoning for the selection. */
  reasoning: z.string().min(1),
  /** Confidence in the selection: [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** ISO 8601 timestamp when the decision was made. */
  decidedAt: z.string().datetime(),
  /**
   * True when confidence was below the configured threshold and the user
   * bypassed the resulting gate with --yolo. Appended at record time so the
   * decision log is fully self-describing.
   */
  lowConfidence: z.boolean().optional(),
});

export type DecisionEntry = z.infer<typeof DecisionEntrySchema>;

// ---------------------------------------------------------------------------
// decision-outcomes.jsonl entries
// ---------------------------------------------------------------------------

/**
 * An entry appended to decision-outcomes.jsonl.
 * Companion file to decisions.jsonl — preserves the append-only decision log
 * while still allowing retrospective outcome recording.
 * Latest entry per decisionId wins on merge.
 */
export const DecisionOutcomeEntrySchema = z.object({
  /** UUID of the decision being annotated. */
  decisionId: z.string().uuid(),
  /** Quality assessment of the decision's outcome. */
  outcome: z.enum(['good', 'partial', 'poor', 'unknown']),
  /** Free-text notes about the outcome. */
  notes: z.string().optional(),
  /** JSON string of user overrides applied to the decision. */
  userOverrides: z.string().optional(),
  /** ISO 8601 timestamp when this outcome was recorded. */
  updatedAt: z.string().datetime(),
});

export type DecisionOutcomeEntry = z.infer<typeof DecisionOutcomeEntrySchema>;

// ---------------------------------------------------------------------------
// artifact-index.jsonl entries
// ---------------------------------------------------------------------------

/** Whether the artifact is a step output or a flavor/stage-level synthesis. */
export const ArtifactIndexTypeSchema = z.enum(['artifact', 'synthesis']);
export type ArtifactIndexType = z.infer<typeof ArtifactIndexTypeSchema>;

/**
 * An entry appended to artifact-index.jsonl (run-level and flavor-level).
 *
 * Cross-field invariant: `flavor` must be non-null when `type` is `'artifact'`.
 * Stage-level synthesis entries (`type === 'synthesis'`) may have `flavor: null`.
 */
export const ArtifactIndexEntrySchema = z.object({
  /** UUID generated at record time. */
  id: z.string().uuid(),
  /** Stage the artifact was produced in. */
  stageCategory: StageCategorySchema,
  /** Flavor that produced the artifact. Null for stage-level synthesis artifacts. */
  flavor: z.string().min(1).nullable(),
  /** Step that produced the artifact (nullable for synthesis artifacts). */
  step: z.string().nullable(),
  /** Filename of the artifact (basename only). */
  fileName: z.string().min(1),
  /** Path to the artifact, relative to the run directory root. */
  filePath: z.string().min(1),
  /** Short human-readable summary of the artifact's content. */
  summary: z.string().min(1),
  /** Whether this is a step-level artifact or a synthesis product. */
  type: ArtifactIndexTypeSchema,
  /** ISO 8601 timestamp when the artifact was recorded. */
  recordedAt: z.string().datetime(),
}).superRefine((val, ctx) => {
  if (val.type === 'artifact' && val.flavor === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['flavor'],
      message: 'flavor must be non-null for type "artifact"',
    });
  }
});

export type ArtifactIndexEntry = z.infer<typeof ArtifactIndexEntrySchema>;
