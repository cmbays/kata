import { z } from 'zod/v4';
import { StageRefSchema } from './stage.js';
import { ArtifactResultSchema } from './artifact.js';

export const PipelineType = z.enum([
  'vertical',
  'bug-fix',
  'polish',
  'spike',
  'cooldown',
  'custom',
]);

export type PipelineType = z.infer<typeof PipelineType>;

export const PipelineState = z.enum([
  'draft',
  'active',
  'paused',
  'complete',
  'abandoned',
]);

export type PipelineState = z.infer<typeof PipelineState>;

export const PipelineStageStateSchema = z.object({
  stageRef: StageRefSchema,
  state: z.enum(['pending', 'active', 'skipped', 'complete', 'failed']).default('pending'),
  artifacts: z.array(ArtifactResultSchema).default([]),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /** Set when a human has approved this stage via `kata flow approve` */
  humanApprovedAt: z.string().datetime().optional(),
});

export type PipelineStageState = z.infer<typeof PipelineStageStateSchema>;

export const PipelineMetadataSchema = z.object({
  projectRef: z.string().optional(),
  issueRefs: z.array(z.string()).default([]),
  betId: z.string().optional(),
  cycleId: z.string().optional(),
});

export type PipelineMetadata = z.infer<typeof PipelineMetadataSchema>;

export const PipelineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: PipelineType,
  stages: z.array(PipelineStageStateSchema).min(1),
  state: PipelineState.default('draft'),
  currentStageIndex: z.number().int().min(0).default(0),
  metadata: PipelineMetadataSchema.default(() => ({ issueRefs: [] as string[] })),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Pipeline = z.infer<typeof PipelineSchema>;

/** Template for creating pipeline instances (no runtime state) */
export const PipelineTemplateSchema = z.object({
  name: z.string().min(1),
  type: PipelineType,
  description: z.string().optional(),
  stages: z.array(StageRefSchema).min(1),
});

export type PipelineTemplate = z.infer<typeof PipelineTemplateSchema>;
