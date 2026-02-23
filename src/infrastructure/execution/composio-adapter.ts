import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type { IExecutionAdapter } from './execution-adapter.js';

/**
 * Placeholder adapter for Composio Agent Orchestrator (AO) integration.
 *
 * Full implementation is tracked in issue #23. This stub returns a descriptive
 * failure with setup instructions so users know what to do.
 *
 * When complete, this adapter will:
 * - Write the manifest to a temp file and pass it via AO's systemPromptFile config
 * - Use @composio/ao-core SDK to spawn an AO session (SessionManager.spawn)
 * - Poll for terminal status (merged/done/errored) with configurable timeout
 * - Map AO CostEstimate.totalCost to tokenUsage.costUsd for budget tracking
 * - Clean up the temp file and return a structured ExecutionResult
 */
export class ComposioAdapter implements IExecutionAdapter {
  readonly name = 'composio';

  async execute(_manifest: ExecutionManifest): Promise<ExecutionResult> {
    return {
      success: false,
      artifacts: [],
      notes: [
        'Composio Agent Orchestrator (AO) adapter is not yet implemented (see issue #23).',
        '',
        'To run stages now, use:',
        '  kata init --adapter manual       Human-driven execution',
        '  kata init --adapter claude-cli   Automated via Claude Code (requires claude CLI)',
        '',
        'AO integration prerequisites (for when it ships):',
        '  1. Install: npm install -g @composio/ao-core',
        '  2. Ensure tmux and git 2.25+ are installed',
        '  3. Configure agent-orchestrator.yaml (kata init will generate this)',
        '  4. Set GITHUB_TOKEN in your environment',
      ].join('\n'),
      completedAt: new Date().toISOString(),
    };
  }
}
