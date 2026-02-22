import {
  ExecutionManifestSchema,
  type ExecutionManifest,
  type ExecutionContext,
} from '@domain/types/manifest.js';
import type { Stage } from '@domain/types/stage.js';
import type { Gate } from '@domain/types/gate.js';
import type { Learning } from '@domain/types/learning.js';
import type { IRefResolver } from '@domain/ports/ref-resolver.js';

/**
 * Manifest Builder — composes ExecutionManifests for stage execution.
 *
 * An ExecutionManifest is a self-contained document describing what to do
 * during a stage execution: the prompt, context, gates, artifacts, and learnings.
 */
export const ManifestBuilder = {
  /**
   * Build a complete ExecutionManifest for a given stage.
   *
   * @param stage - The stage definition to build a manifest for
   * @param context - Execution context (pipeline ID, stage index, metadata)
   * @param learnings - Optional learnings to inject as additional context
   * @returns A fully composed ExecutionManifest
   */
  build(
    stage: Stage,
    context: ExecutionContext,
    learnings?: Learning[],
  ): ExecutionManifest {
    // Start with the prompt template or a default
    let prompt = stage.promptTemplate ?? `Execute the "${stage.type}" stage.`;

    // If the prompt looks like a file path (not already content), try to resolve it
    // The prompt template field contains the raw path or already-resolved content
    // For resolution, the caller should use resolveRefs() first

    // Inject learnings into the prompt if any
    if (learnings && learnings.length > 0) {
      const learningsText = ManifestBuilder.injectLearnings(learnings);
      prompt = `${prompt}\n\n${learningsText}`;
    }

    // Extract gates
    const gates = ManifestBuilder.attachGates(stage);

    const manifest: ExecutionManifest = ExecutionManifestSchema.parse({
      stageType: stage.type,
      stageFlavor: stage.flavor,
      prompt,
      context,
      entryGate: gates.entryGate,
      exitGate: gates.exitGate,
      artifacts: stage.artifacts,
      learnings: learnings ?? [],
    });

    return manifest;
  },

  /**
   * Resolve $ref-style paths in a stage's promptTemplate field.
   * Reads the file at `basePath/template` and returns its contents.
   *
   * @param template - Relative path to the prompt template file
   * @param basePath - Base directory for resolving the path
   * @returns The file contents as a string
   */
  resolveRefs(template: string, basePath: string, resolver: IRefResolver): string {
    return resolver.resolveRef(template, basePath);
  },

  /**
   * Extract gate definitions from a stage.
   * Returns both entry and exit gates if defined.
   */
  attachGates(stage: Stage): { entryGate?: Gate; exitGate?: Gate } {
    return {
      entryGate: stage.entryGate,
      exitGate: stage.exitGate,
    };
  },

  /**
   * Format learnings as additional context text to append to prompts.
   * Each learning is formatted with its tier, category, content, and confidence.
   */
  injectLearnings(learnings: Learning[]): string {
    if (learnings.length === 0) {
      return '';
    }

    const lines: string[] = [
      '---',
      '## Learnings from Previous Executions',
      '',
    ];

    for (const learning of learnings) {
      lines.push(`### [${learning.tier.toUpperCase()}] ${learning.category}`);
      lines.push(`**Confidence**: ${(learning.confidence * 100).toFixed(0)}%`);
      lines.push('');
      lines.push(learning.content);

      if (learning.evidence.length > 0) {
        lines.push('');
        lines.push('**Evidence**:');
        for (const ev of learning.evidence) {
          lines.push(`- ${ev.observation} (${ev.stageType}, ${ev.recordedAt})`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  },
};
