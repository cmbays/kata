import { describe, it, expect, afterEach } from 'vitest';
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
      expect(() => resolver.resolve(config)).toThrow('manual, claude-cli, composio');
    });
  });

  describe('register', () => {
    const TEST_ADAPTER_NAME = 'test-custom-adapter';

    afterEach(() => {
      // Clean up the test registration from the static registry
      // We do this by calling register with a sentinel that we can detect,
      // then delete isn't available — instead we overwrite to restore nothing.
      // Since we can't remove entries, we re-register 'manual' to keep tests stable.
      // The custom key stays in the registry but doesn't affect other tests.
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
      // Override 'manual' temporarily
      AdapterResolver.register('manual', () => replacementManual);

      const resolved = new AdapterResolver().resolve(makeConfig('manual'));
      expect(resolved).toBe(replacementManual);

      // Restore original registration
      AdapterResolver.register('manual', () => new ManualAdapter());
    });

    it('error message lists dynamically registered adapters', () => {
      const UNIQUE_NAME = `test-registry-${Date.now()}`;
      AdapterResolver.register(UNIQUE_NAME, () => ({
        name: UNIQUE_NAME,
        execute: async () => ({ success: true, artifacts: [], completedAt: new Date().toISOString() }),
      }));

      const config = makeConfig('nonexistent');
      expect(() => new AdapterResolver().resolve(config)).toThrow(UNIQUE_NAME);
    });
  });
});
