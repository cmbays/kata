import { describe, it, expect } from 'vitest';
import type { KataConfig } from '@domain/types/config.js';
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
});
