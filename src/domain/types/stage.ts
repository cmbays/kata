import { z } from 'zod/v4';
import { GateSchema } from './gate.js';
import { ArtifactSchema } from './artifact.js';

export const StageType = z.enum([
  'research',
  'interview',
  'shape',
  'breadboard',
  'plan',
  'build',
  'review',
  'wrap-up',
  'custom',
]);

export type StageType = z.infer<typeof StageType>;

export const StageRefSchema = z.object({
  type: z.string().min(1),
  flavor: z.string().optional(),
});

export type StageRef = z.infer<typeof StageRefSchema>;

export const StageSchema = z.object({
  type: z.string().min(1),
  flavor: z.string().optional(),
  description: z.string().optional(),
  entryGate: GateSchema.optional(),
  exitGate: GateSchema.optional(),
  artifacts: z.array(ArtifactSchema).default([]),
  /** $ref path to prompt template .md file */
  promptTemplate: z.string().optional(),
  learningHooks: z.array(z.string()).default([]),
  /** Arbitrary stage-specific configuration */
  config: z.record(z.string(), z.unknown()).default({}),
});

export type Stage = z.infer<typeof StageSchema>;
