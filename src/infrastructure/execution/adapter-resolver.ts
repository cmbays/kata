import type { KataConfig } from '@domain/types/config.js';
import type { IExecutionAdapter } from './execution-adapter.js';
import { ManualAdapter } from './manual-adapter.js';
import { ClaudeCliAdapter } from './claude-cli-adapter.js';
import { ComposioAdapter } from './composio-adapter.js';

const VALID_ADAPTERS = ['manual', 'claude-cli', 'composio'] as const;

/**
 * Resolves the correct execution adapter based on project configuration.
 *
 * Reads the `execution.adapter` field from KataConfig and returns
 * the matching adapter instance. Defaults to ManualAdapter if no
 * config or adapter field is provided.
 */
export class AdapterResolver {
  /**
   * Resolve an execution adapter from the given configuration.
   *
   * @param config - The kata project configuration. If undefined or missing
   *   the execution.adapter field, defaults to ManualAdapter.
   * @returns The resolved execution adapter instance.
   * @throws Error if the adapter name is not recognized.
   */
  resolve(config?: KataConfig): IExecutionAdapter {
    const adapterName = config?.execution?.adapter ?? 'manual';

    switch (adapterName) {
      case 'manual':
        return new ManualAdapter();
      case 'claude-cli':
        return new ClaudeCliAdapter();
      case 'composio':
        return new ComposioAdapter();
      default: {
        const validList = VALID_ADAPTERS.join(', ');
        throw new Error(
          `Unknown execution adapter: "${adapterName as string}". Valid adapters are: ${validList}`,
        );
      }
    }
  }
}
