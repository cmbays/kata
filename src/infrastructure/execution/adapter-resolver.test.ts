import { afterEach } from 'vitest';
import type { KataConfig } from '@domain/types/config.js';
import type { IExecutionAdapter } from './execution-adapter.js';
import { AdapterResolver } from './adapter-resolver.js';
import { ManualAdapter } from './manual-adapter.js';
import { ClaudeCliAdapter } from './claude-cli-adapter.js';
import { ComposioAdapter } from './composio-adapter.js';

function makeConfig(adapter: string): KataConfig {
  return {
    methodology: 'shape-up',
    execution: {
      adapter: adapter as KataConfig['execution']['adapter'],
      config: {},
    },
    customStagePaths: [],
    project: {},
  };
}

describe('AdapterResolver', () => {
  const resolver = new AdapterResolver();

  describe('resolve', () => {
    it('resolves ManualAdapter for "manual"', () => {
      const adapter = resolver.resolve(makeConfig('manual'));
      expect(adapter).toBeInstanceOf(ManualAdapter);
      expect(adapter.name).toBe('manual');
    });

    it('resolves ClaudeCliAdapter for "claude-cli"', () => {
      const adapter = resolver.resolve(makeConfig('claude-cli'));
      expect(adapter).toBeInstanceOf(ClaudeCliAdapter);
      expect(adapter.name).toBe('claude-cli');
    });

    it('resolves ComposioAdapter for "composio"', () => {
      const adapter = resolver.resolve(makeConfig('composio'));
      expect(adapter).toBeInstanceOf(ComposioAdapter);
      expect(adapter.name).toBe('composio');
    });

    it('defaults to ManualAdapter when config is undefined', () => {
      const adapter = resolver.resolve(undefined);
      expect(adapter).toBeInstanceOf(ManualAdapter);
    });

    it('defaults to ManualAdapter when execution config has default adapter', () => {
      const config: KataConfig = {
        methodology: 'shape-up',
        execution: {
          adapter: 'manual',
          config: {},
        },
        customStagePaths: [],
        project: {},
      };
      const adapter = resolver.resolve(config);
      expect(adapter).toBeInstanceOf(ManualAdapter);
    });

    it('throws for unknown adapter name', () => {
      // Force an invalid adapter value to test error handling
      const config = makeConfig('nonexistent');
      expect(() => resolver.resolve(config)).toThrow('Unknown execution adapter');
      expect(() => resolver.resolve(config)).toThrow('nonexistent');
      // Check each built-in name is listed (order-independent)
      for (const name of ['manual', 'claude-cli', 'composio']) {
        expect(() => resolver.resolve(config)).toThrow(name);
      }
    });
  });

  describe('register', () => {
    const TEST_ADAPTER_NAME = 'test-custom-adapter';
    let uniqueName: string;

    afterEach(() => {
      // Remove keys added by tests to prevent cross-test pollution of the static registry.
      AdapterResolver.unregister(TEST_ADAPTER_NAME);
      if (uniqueName) AdapterResolver.unregister(uniqueName);
      // Restore 'manual' in case the override test left a non-ManualAdapter replacement.
      // Unregister first to avoid the overwrite warning from AdapterResolver.register().
      AdapterResolver.unregister('manual');
      AdapterResolver.register('manual', () => new ManualAdapter());
    });

    it('allows registering a custom adapter', () => {
      const fakeAdapter: IExecutionAdapter = {
        name: TEST_ADAPTER_NAME,
        execute: async () => ({ success: true, artifacts: [], completedAt: new Date().toISOString() }),
      };
      AdapterResolver.register(TEST_ADAPTER_NAME, () => fakeAdapter);

      const resolved = new AdapterResolver().resolve(makeConfig(TEST_ADAPTER_NAME));
      expect(resolved).toBe(fakeAdapter);
      expect(resolved.name).toBe(TEST_ADAPTER_NAME);
    });

    it('allows overriding an existing adapter registration', () => {
      const replacementManual: IExecutionAdapter = {
        name: 'manual-override',
        execute: async () => ({ success: true, artifacts: [], completedAt: new Date().toISOString() }),
      };
      // Override 'manual' temporarily (afterEach restores it)
      AdapterResolver.register('manual', () => replacementManual);

      const resolved = new AdapterResolver().resolve(makeConfig('manual'));
      expect(resolved).toBe(replacementManual);
    });

    it('error message lists dynamically registered adapters', () => {
      uniqueName = `test-registry-${Date.now()}`;
      AdapterResolver.register(uniqueName, () => ({
        name: uniqueName,
        execute: async () => ({ success: true, artifacts: [], completedAt: new Date().toISOString() }),
      }));

      const config = makeConfig('nonexistent');
      expect(() => new AdapterResolver().resolve(config)).toThrow(uniqueName);
    });
  });
});
