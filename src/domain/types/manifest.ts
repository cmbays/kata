import { z } from 'zod/v4';
import { GateSchema } from './gate.js';
import { ArtifactSchema } from './artifact.js';
import { LearningSchema } from './learning.js';
import { StageResourcesSchema } from './stage.js';

export const ExecutionContextSchema = z.object({
  pipelineId: z.string().uuid(),
  stageIndex: z.number().int().min(0),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;

export const ExecutionManifestSchema = z.object({
  stageType: z.string().min(1),
  stageFlavor: z.string().optional(),
  /** Fully resolved prompt (all $refs replaced with content) */
  prompt: z.string().min(1),
  context: ExecutionContextSchema,
  entryGate: GateSchema.optional(),
  exitGate: GateSchema.optional(),
  artifacts: z.array(ArtifactSchema).default([]),
  /** Learnings injected as additional context */
  learnings: z.array(LearningSchema).default([]),
  /**
   * Structured tool/agent/skill hints for this stage.
   *
   * Note: ManifestBuilder also serializes these into the `prompt` field as a
   * "## Suggested Resources" section. The two representations are intentionally
   * kept in sync — the structured field enables downstream adapters to act on
   * resources without prompt parsing; the embedded prompt section serves as a
   * fallback when the structured field is not available to the consuming agent.
   */
  resources: StageResourcesSchema.optional(),
});

export type ExecutionManifest = z.infer<typeof ExecutionManifestSchema>;

export const ExecutionResultSchema = z.object({
  success: z.boolean(),
  /** Artifacts produced during execution */
  artifacts: z.array(z.object({
    name: z.string(),
    path: z.string().optional(),
  })).default([]),
  /** Token usage if available */
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0).default(0),
    outputTokens: z.number().int().min(0).default(0),
    cacheCreationTokens: z.number().int().min(0).default(0),
    cacheReadTokens: z.number().int().min(0).default(0),
    total: z.number().int().min(0).default(0),
  }).optional(),
  /** Duration in milliseconds */
  durationMs: z.number().int().min(0).optional(),
  /** Free-form notes from execution */
  notes: z.string().optional(),
  completedAt: z.string().datetime(),
});

export type ExecutionResult = z.infer<typeof ExecutionResultSchema>;
