import { describe, it, expect } from 'vitest';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import { ComposioAdapter } from './composio-adapter.js';

function makeManifest(): ExecutionManifest {
  return {
    stageType: 'build',
    prompt: 'Build it.',
    context: {
      pipelineId: crypto.randomUUID(),
      stageIndex: 0,
      metadata: {},
    },
    artifacts: [],
    learnings: [],
  };
}

describe('ComposioAdapter', () => {
  it('has name "composio"', () => {
    const adapter = new ComposioAdapter();
    expect(adapter.name).toBe('composio');
  });

  it('returns failure with not-implemented message', async () => {
    const adapter = new ComposioAdapter();
    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(false);
    expect(result.notes).toContain('not yet implemented');
    expect(result.notes).toContain('manual');
    expect(result.notes).toContain('claude-cli');
    expect(result.completedAt).toBeDefined();
  });

  it('returns empty artifacts array', async () => {
    const adapter = new ComposioAdapter();
    const result = await adapter.execute(makeManifest());

    expect(result.artifacts).toEqual([]);
  });
});
