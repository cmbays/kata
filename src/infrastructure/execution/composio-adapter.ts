import type { ExecutionManifest, ExecutionResult } from '@domain/types/manifest.js';
import type { IExecutionAdapter } from './execution-adapter.js';

/**
 * Placeholder adapter for Composio/ao integration.
 *
 * This is a v1 stub — it returns a failure result with a helpful message
 * directing users to use the manual or claude-cli adapter instead.
 * Full Composio integration is planned for a future cycle.
 */
export class ComposioAdapter implements IExecutionAdapter {
  readonly name = 'composio';

  async execute(_manifest: ExecutionManifest): Promise<ExecutionResult> {
    return {
      success: false,
      artifacts: [],
      notes: 'Composio adapter is not yet implemented. Use manual or claude-cli adapter.',
      completedAt: new Date().toISOString(),
    };
  }
}
