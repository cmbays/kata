import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type { IExecutionAdapter } from './execution-adapter.js';
import { logger } from '@shared/lib/logger.js';

const execFileAsync = promisify(execFile);

/**
 * Options for configuring the Claude CLI adapter.
 */
export interface ClaudeCliAdapterOptions {
  /** Path to the claude binary. Defaults to 'claude'. */
  binaryPath?: string;
  /**
   * Project root directory — when useWorktree is true, claude creates worktrees under
   * `<projectRoot>/.claude/worktrees/kata-<stageType>-<id>/`.
   * Defaults to process.cwd().
   */
  projectRoot?: string;
  /** Maximum execution time in milliseconds. Defaults to 1,800,000 (30 min). */
  timeoutMs?: number;
  /**
   * Whether to use `claude -w` for workspace-isolated execution.
   * Defaults to true. Set false to skip worktree creation (e.g. in tests).
   */
  useWorktree?: boolean;
}

/**
 * Check if a binary exists on the system PATH.
 * Exported for testing purposes.
 */
export async function checkBinaryExists(binaryPath: string): Promise<boolean> {
  try {
    await promisify(execFile)('which', [binaryPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execution adapter that spawns `claude` as a subprocess using:
 * - `-w kata-<stageType>-<id>` for workspace isolation (claude creates a git worktree)
 * - `-p` for non-interactive print mode
 * - `--system-prompt-file <path>` for large manifest delivery without truncation
 *
 * The adapter writes the full execution manifest to a temp file, invokes claude,
 * parses the JSON result from stdout, and cleans up the temp file.
 */
export class ClaudeCliAdapter implements IExecutionAdapter {
  readonly name = 'claude-cli';

  private readonly binaryPath: string;
  private readonly projectRoot: string;
  private readonly timeoutMs: number;
  private readonly useWorktree: boolean;

  // Injection points for testing
  private _checkBinary: (path: string) => Promise<boolean>;
  private _execFile: typeof execFileAsync;
  private _writeFile: (path: string, content: string) => void;
  private _deleteFile: (path: string) => void;
  private _generateId: () => string;

  constructor(options: ClaudeCliAdapterOptions = {}) {
    this.binaryPath = options.binaryPath ?? 'claude';
    this.projectRoot = options.projectRoot ?? process.cwd();
    this.timeoutMs = options.timeoutMs ?? 1_800_000;
    this.useWorktree = options.useWorktree ?? true;
    this._checkBinary = checkBinaryExists;
    this._execFile = execFileAsync;
    this._writeFile = (path, content) => writeFileSync(path, content, 'utf-8');
    this._deleteFile = (path) => unlinkSync(path);
    this._generateId = () => randomUUID().replace(/-/g, '').slice(0, 8);
  }

  /** Replace the binary existence check (for testing). */
  setBinaryChecker(checker: (path: string) => Promise<boolean>): void {
    this._checkBinary = checker;
  }

  /** Replace the exec function (for testing). */
  setExecFunction(execFn: typeof execFileAsync): void {
    this._execFile = execFn;
  }

  /** Replace file write (for testing). */
  setFileWriter(fn: (path: string, content: string) => void): void {
    this._writeFile = fn;
  }

  /** Replace file delete (for testing). */
  setFileDeleter(fn: (path: string) => void): void {
    this._deleteFile = fn;
  }

  /** Replace ID generator for deterministic testing. */
  setIdGenerator(fn: () => string): void {
    this._generateId = fn;
  }

  async execute(manifest: ExecutionManifest): Promise<ExecutionResult> {
    const startTime = Date.now();

    const exists = await this._checkBinary(this.binaryPath);
    if (!exists) {
      return {
        success: false,
        artifacts: [],
        notes: `Claude CLI binary not found at "${this.binaryPath}". Install Claude Code or use the "manual" adapter instead.`,
        completedAt: new Date().toISOString(),
      };
    }

    const id = this._generateId();
    const manifestPath = join(tmpdir(), `kata-manifest-${id}.md`);

    try {
      this._writeFile(manifestPath, this.serializeManifest(manifest));

      const args = this.buildArgs(manifest.stageType, id, manifestPath);

      const { stdout, stderr } = await this._execFile(
        this.binaryPath,
        args,
        {
          cwd: this.projectRoot,
          timeout: this.timeoutMs,
          maxBuffer: 10 * 1024 * 1024, // 10MB
          encoding: 'utf-8',
        },
      );

      const durationMs = Date.now() - startTime;
      return this.parseResult(stdout, stderr ?? '', durationMs, manifest.stageType);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('ClaudeCliAdapter.execute failed', {
        stageType: manifest.stageType,
        manifestPath,
        error: errorMessage,
      });
      return {
        success: false,
        artifacts: [],
        durationMs,
        notes: `Claude CLI execution failed: ${errorMessage}`,
        completedAt: new Date().toISOString(),
      };
    } finally {
      try { this._deleteFile(manifestPath); } catch { /* best-effort cleanup */ }
    }
  }

  private buildArgs(stageType: string, id: string, manifestPath: string): string[] {
    const args: string[] = [];
    if (this.useWorktree) {
      const safeType = stageType.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      args.push('-w', `kata-${safeType}-${id}`);
    }
    args.push(
      '-p',
      '--system-prompt-file', manifestPath,
      'Execute the stage described in your system prompt. When complete, output results as JSON.',
    );
    return args;
  }

  private serializeManifest(manifest: ExecutionManifest): string {
    const sections: string[] = [];

    const flavor = manifest.stageFlavor ? ` (${manifest.stageFlavor})` : '';
    sections.push(`# Kata Stage: ${manifest.stageType}${flavor}\n`);
    sections.push(manifest.prompt);

    if (manifest.artifacts.length > 0) {
      sections.push('\n## Artifacts to Produce\n');
      for (const artifact of manifest.artifacts) {
        const req = artifact.required ? 'required' : 'optional';
        const desc = artifact.description ? ` — ${artifact.description}` : '';
        sections.push(`- ${artifact.name} (${req})${desc}`);
      }
    }

    if (manifest.learnings.length > 0) {
      sections.push('\n## Relevant Learnings\n');
      for (const learning of manifest.learnings) {
        sections.push(
          `- [${learning.tier}/${learning.category}] ${learning.content} ` +
          `(confidence: ${(learning.confidence * 100).toFixed(0)}%)`,
        );
      }
    }

    sections.push(`\n## Execution Context\n`);
    sections.push(`- Pipeline: ${manifest.context.pipelineId}`);
    sections.push(`- Stage index: ${manifest.context.stageIndex}`);

    sections.push('\n## Output Instructions\n');
    sections.push('When complete, print to stdout a JSON object:');
    sections.push('```json');
    sections.push('{ "success": true, "artifacts": [{ "name": "...", "path": "..." }], "notes": "..." }');
    sections.push('```');

    return sections.join('\n');
  }

  /**
   * Parse stdout into an ExecutionResult.
   * Tries JSON extraction first; falls back to failure result with raw notes.
   *
   * Parsing priority:
   * 1. Last ```json ... ``` fenced block in stdout
   * 2. Last bare top-level {...} object anchored to end of stdout (avoids greedy match
   *    grabbing braces in preceding prose/code)
   * 3. No JSON found → failure result with raw output as notes
   */
  private parseResult(stdout: string, stderr: string, durationMs: number, stageType?: string): ExecutionResult {
    // Try fenced JSON block first (non-greedy, finds last match)
    const jsonBlockMatches = [...stdout.matchAll(/```json\s*([\s\S]*?)\s*```/g)];
    const lastBlockMatch = jsonBlockMatches.at(-1);

    // Bare JSON: anchor to end of string to grab the last {...} block, not the first
    const bareJsonMatch = stdout.match(/(\{[\s\S]*\})\s*$/);
    const rawJson = lastBlockMatch?.[1] ?? bareJsonMatch?.[1];

    if (rawJson) {
      try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        const artifacts = Array.isArray(parsed['artifacts'])
          ? (parsed['artifacts'] as unknown[]).flatMap((a) => {
              if (typeof a === 'object' && a !== null && 'name' in a && typeof (a as Record<string, unknown>)['name'] === 'string') {
                const item = a as Record<string, unknown>;
                return [{ name: item['name'] as string, path: typeof item['path'] === 'string' ? item['path'] : undefined }];
              }
              return [];
            })
          : [];

        return {
          success: parsed['success'] === true,
          artifacts,
          durationMs,
          notes: typeof parsed['notes'] === 'string' ? parsed['notes'] : undefined,
          completedAt: new Date().toISOString(),
        };
      } catch {
        // JSON parse failed — fall through
      }
    }

    // No valid JSON found — treat as failure to avoid masking real model errors
    logger.warn('ClaudeCliAdapter: claude produced no structured JSON output', {
      stageType,
      stdoutPreview: stdout.slice(0, 200),
      hasStderr: stderr.length > 0,
    });
    const rawNotes = stderr
      ? `stdout:\n${stdout.slice(0, 2000)}\n\nstderr:\n${stderr.slice(0, 500)}`
      : stdout.slice(0, 2000) || undefined;

    return {
      success: false,
      artifacts: [],
      durationMs,
      notes: `Claude did not produce a structured result.${rawNotes ? `\n\nRaw output:\n${rawNotes}` : ''}`,
      completedAt: new Date().toISOString(),
    };
  }
}
