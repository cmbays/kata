import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';

/**
 * Port interface for execution adapters.
 *
 * All execution adapters must implement this interface. The adapter receives
 * a fully-resolved ExecutionManifest and returns an ExecutionResult.
 *
 * Built-in adapters:
 * - ManualAdapter: Formats manifest as human-readable instructions (null-state default)
 * - ClaudeCliAdapter: Spawns the `claude` CLI as a subprocess
 * - ComposioAdapter: Placeholder for Composio/ao integration
 */
export interface IExecutionAdapter {
  /** Human-readable name of this adapter (e.g., 'manual', 'claude-cli', 'composio') */
  readonly name: string;

  /**
   * Execute the given manifest and return a result.
   *
   * @param manifest - The fully-resolved execution manifest containing prompt,
   *   context, gates, artifacts, and injected learnings.
   * @returns The execution result including success status, artifacts produced,
   *   optional token usage, and notes.
   */
  execute(manifest: ExecutionManifest): Promise<ExecutionResult>;
}
