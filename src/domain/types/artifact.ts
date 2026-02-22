import { z } from 'zod/v4';

export const ArtifactSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** JSON Schema string or Zod schema identifier for validation */
  schema: z.string().optional(),
  required: z.boolean().default(true),
  /** File extension hint (e.g., ".json", ".md") */
  extension: z.string().optional(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ArtifactResultSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  producedAt: z.string().datetime(),
  valid: z.boolean().optional(),
});

export type ArtifactResult = z.infer<typeof ArtifactResultSchema>;
