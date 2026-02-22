import { PipelineTemplateSchema, type PipelineTemplate } from '@domain/types/pipeline.js';
import { JsonStore } from '@infra/persistence/json-store.js';

/**
 * Load pipeline template JSON files from a directory.
 * Each .json file should conform to PipelineTemplateSchema.
 * Returns an empty array if the directory does not exist or contains no valid templates.
 */
export function loadPipelineTemplates(templateDir: string): PipelineTemplate[] {
  return JsonStore.list(templateDir, PipelineTemplateSchema);
}
