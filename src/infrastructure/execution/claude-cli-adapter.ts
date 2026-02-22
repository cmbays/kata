import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type { IExecutionAdapter } from './execution-adapter.js';

const execFileAsync = promisify(execFile);

/**
 * Options for configuring the Claude CLI adapter.
 */
export interface ClaudeCliAdapterOptions {
  /** Path to the claude binary. Defaults to 'claude'. */
  binaryPath?: string;
  /** Additional CLI arguments to pass to the claude command. */
  additionalArgs?: string[];
  /** Maximum execution time in milliseconds. Defaults to 300000 (5 minutes). */
  timeoutMs?: number;
}

/**
 * Check if a binary exists on the system PATH.
 * Exported for testing purposes.
 */
export async function checkBinaryExists(binaryPath: string): Promise<boolean> {
  try {
    // Use 'which' on macOS/Linux to find the binary
    await execFileAsync('which', [binaryPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execution adapter that spawns the `claude` CLI as a subprocess with
 * the manifest prompt as input.
 */
export class ClaudeCliAdapter implements IExecutionAdapter {
  readonly name = 'claude-cli';

  private readonly binaryPath: string;
  private readonly additionalArgs: string[];
  private readonly timeoutMs: number;

  /**
   * Internal hook for testing: allows injection of a mock binary checker
   * and a mock exec function.
   */
  private _checkBinary: (path: string) => Promise<boolean>;
  private _execFile: typeof execFileAsync;

  constructor(options: ClaudeCliAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'claude';
    this.additionalArgs = options.additionalArgs ?? [];
    this.timeoutMs = options.timeoutMs ?? 300_000;
    this._checkBinary = checkBinaryExists;
    this._execFile = execFileAsync;
  }

  /**
   * Replace the binary existence check (for testing).
   */
  setBinaryChecker(checker: (path: string) => Promise<boolean>): void {
    this._checkBinary = checker;
  }

  /**
   * Replace the exec function (for testing).
   */
  setExecFunction(execFn: typeof execFileAsync): void {
    this._execFile = execFn;
  }

  async execute(manifest: ExecutionManifest): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check if claude binary exists
    const exists = await this._checkBinary(this.binaryPath);
    if (!exists) {
      return {
        success: false,
        artifacts: [],
        notes: `Claude CLI binary not found at "${this.binaryPath}". Install it from https://docs.anthropic.com/en/docs/claude-cli or use the "manual" adapter instead.`,
        completedAt: new Date().toISOString(),
      };
    }

    // Build the prompt string from manifest
    const prompt = this.buildPrompt(manifest);

    try {
      const args = [
        '--print',
        ...this.additionalArgs,
        prompt,
      ];

      const { stdout, stderr } = await this._execFile(
        this.binaryPath,
        args,
        {
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          encoding: 'utf-8',
        },
      );

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        artifacts: [],
        durationMs,
        notes: stderr ? `stdout:\n${stdout}\n\nstderr:\n${stderr}` : stdout,
        completedAt: new Date().toISOString(),
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);

      return {
        success: false,
        artifacts: [],
        durationMs,
        notes: `Claude CLI execution failed: ${errorMessage}`,
        completedAt: new Date().toISOString(),
      };
    }
  }

  private buildPrompt(manifest: ExecutionManifest): string {
    const sections: string[] = [];

    // Stage context
    const flavor = manifest.stageFlavor ? ` (${manifest.stageFlavor})` : '';
    sections.push(`# Stage: ${manifest.stageType}${flavor}\n`);

    // Main prompt
    sections.push(manifest.prompt);

    // Artifacts to produce
    if (manifest.artifacts.length > 0) {
      sections.push('\n## Artifacts to Produce\n');
      for (const artifact of manifest.artifacts) {
        const req = artifact.required ? 'required' : 'optional';
        const desc = artifact.description ? ` - ${artifact.description}` : '';
        sections.push(`- ${artifact.name} (${req})${desc}`);
      }
    }

    // Learnings context
    if (manifest.learnings.length > 0) {
      sections.push('\n## Relevant Learnings\n');
      for (const learning of manifest.learnings) {
        sections.push(`- [${learning.tier}/${learning.category}] ${learning.content} (confidence: ${(learning.confidence * 100).toFixed(0)}%)`);
      }
    }

    return sections.join('\n');
  }
}
