import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type { IExecutionAdapter } from './execution-adapter.js';

/**
 * The null-state default adapter (R5).
 *
 * Formats the execution manifest as human-readable instructions and prints
 * to the terminal. The human does the actual work — this adapter always
 * returns success since its job is just to present the instructions.
 */
export class ManualAdapter implements IExecutionAdapter {
  readonly name = 'manual';

  private readonly output: (text: string) => void;

  /**
   * @param output - Function to write output text. Defaults to process.stdout.write.
   *   Accepting this as a parameter enables testing without capturing stdout.
   */
  constructor(output?: (text: string) => void) {
    this.output = output ?? ((text: string) => process.stdout.write(text));
  }

  async execute(manifest: ExecutionManifest): Promise<ExecutionResult> {
    const lines: string[] = [];

    // Stage header
    lines.push('');
    lines.push('='.repeat(60));
    const flavor = manifest.stageFlavor ? ` (${manifest.stageFlavor})` : '';
    lines.push(`  Stage: ${manifest.stageType}${flavor}`);
    lines.push('='.repeat(60));
    lines.push('');

    // Prompt content
    lines.push('--- Prompt ---');
    lines.push('');
    lines.push(manifest.prompt);
    lines.push('');

    // Artifacts to produce
    if (manifest.artifacts.length > 0) {
      lines.push('--- Artifacts to Produce ---');
      lines.push('');
      for (const artifact of manifest.artifacts) {
        const requiredTag = artifact.required ? ' [required]' : ' [optional]';
        const desc = artifact.description ? ` - ${artifact.description}` : '';
        lines.push(`  * ${artifact.name}${requiredTag}${desc}`);
      }
      lines.push('');
    }

    // Gate requirements
    if (manifest.entryGate || manifest.exitGate) {
      lines.push('--- Gate Requirements ---');
      lines.push('');

      if (manifest.entryGate) {
        lines.push('  Entry gate:');
        for (const condition of manifest.entryGate.conditions) {
          const desc = condition.description ? ` - ${condition.description}` : '';
          lines.push(`    * [${condition.type}]${desc}`);
        }
      }

      if (manifest.exitGate) {
        lines.push('  Exit gate:');
        for (const condition of manifest.exitGate.conditions) {
          const desc = condition.description ? ` - ${condition.description}` : '';
          lines.push(`    * [${condition.type}]${desc}`);
        }
      }
      lines.push('');
    }

    // Injected learnings summary
    if (manifest.learnings.length > 0) {
      lines.push('--- Injected Learnings ---');
      lines.push('');
      for (const learning of manifest.learnings) {
        lines.push(`  * [${learning.tier}/${learning.category}] ${learning.content}`);
        lines.push(`    Confidence: ${(learning.confidence * 100).toFixed(0)}%`);
      }
      lines.push('');
    }

    lines.push('='.repeat(60));
    lines.push('  Complete the above stage manually, then continue.');
    lines.push('='.repeat(60));
    lines.push('');

    this.output(lines.join('\n'));

    return {
      success: true,
      artifacts: [],
      notes: 'Manual execution — instructions displayed to user.',
      completedAt: new Date().toISOString(),
    };
  }
}
