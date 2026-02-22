import type { KataConfig } from '@domain/types/config.js';
import type { IExecutionAdapter } from './execution-adapter.js';
import { ManualAdapter } from './manual-adapter.js';
import { ClaudeCliAdapter } from './claude-cli-adapter.js';
import { ComposioAdapter } from './composio-adapter.js';

type AdapterFactory = (config?: KataConfig) => IExecutionAdapter;

/**
 * Resolves the correct execution adapter based on project configuration.
 *
 * Uses a static registry so external code can register additional adapters
 * without modifying this source file:
 *
 *   AdapterResolver.register('my-adapter', (config) => new MyAdapter(config));
 *
 * The three built-in adapters (manual, claude-cli, composio) are pre-registered.
 */
export class AdapterResolver {
  private static readonly registry = new Map<string, AdapterFactory>([
    ['manual', () => new ManualAdapter()],
    ['claude-cli', () => new ClaudeCliAdapter()],
    ['composio', () => new ComposioAdapter()],
  ]);

  /**
   * Register a new adapter factory under the given name.
   * Overwrites any existing registration for that name.
   */
  static register(name: string, factory: AdapterFactory): void {
    AdapterResolver.registry.set(name, factory);
  }

  /**
   * Resolve an execution adapter from the given configuration.
   *
   * @param config - The kata project configuration. If undefined or missing
   *   the execution.adapter field, defaults to ManualAdapter.
   * @returns The resolved execution adapter instance.
   * @throws Error if the adapter name is not registered.
   */
  resolve(config?: KataConfig): IExecutionAdapter {
    const adapterName = config?.execution?.adapter ?? 'manual';
    const factory = AdapterResolver.registry.get(adapterName);

    if (!factory) {
      const validList = [...AdapterResolver.registry.keys()].join(', ');
      throw new Error(
        `Unknown execution adapter: "${adapterName}". Valid adapters are: ${validList}`,
      );
    }

    return factory(config);
  }
}
