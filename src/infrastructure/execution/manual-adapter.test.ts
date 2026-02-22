import { describe, it, expect } from 'vitest';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import { ManualAdapter } from './manual-adapter.js';

function makeManifest(overrides: Partial<ExecutionManifest> = {}): ExecutionManifest {
  return {
    stageType: 'build',
    prompt: 'Build the feature according to the plan.',
    context: {
      pipelineId: crypto.randomUUID(),
      stageIndex: 2,
      metadata: {},
    },
    artifacts: [],
    learnings: [],
    ...overrides,
  };
}

describe('ManualAdapter', () => {
  it('has name "manual"', () => {
    const adapter = new ManualAdapter();
    expect(adapter.name).toBe('manual');
  });

  it('returns a successful ExecutionResult', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    const result = await adapter.execute(makeManifest());

    expect(result.success).toBe(true);
    expect(result.completedAt).toBeDefined();
    expect(result.notes).toContain('Manual execution');
  });

  it('outputs stage header with type', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({ stageType: 'research' }));

    const text = output.join('');
    expect(text).toContain('Stage: research');
  });

  it('outputs stage header with flavor when present', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({ stageType: 'build', stageFlavor: 'frontend' }));

    const text = output.join('');
    expect(text).toContain('Stage: build (frontend)');
  });

  it('outputs the prompt content', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({ prompt: 'Implement the auth module' }));

    const text = output.join('');
    expect(text).toContain('Implement the auth module');
  });

  it('outputs artifacts to produce', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({
      artifacts: [
        { name: 'shaping-doc', description: 'The shaping document', required: true },
        { name: 'spike-notes', description: 'Optional spike notes', required: false },
      ],
    }));

    const text = output.join('');
    expect(text).toContain('Artifacts to Produce');
    expect(text).toContain('shaping-doc [required]');
    expect(text).toContain('spike-notes [optional]');
    expect(text).toContain('The shaping document');
    expect(text).toContain('Optional spike notes');
  });

  it('outputs gate requirements when present', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({
      entryGate: {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', description: 'Research doc exists', artifactName: 'research-doc' },
        ],
        required: true,
      },
      exitGate: {
        type: 'exit',
        conditions: [
          { type: 'human-approved', description: 'Shaping approved by stakeholder' },
        ],
        required: true,
      },
    }));

    const text = output.join('');
    expect(text).toContain('Gate Requirements');
    expect(text).toContain('Entry gate');
    expect(text).toContain('artifact-exists');
    expect(text).toContain('Research doc exists');
    expect(text).toContain('Exit gate');
    expect(text).toContain('human-approved');
    expect(text).toContain('Shaping approved by stakeholder');
  });

  it('outputs injected learnings when present', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({
      learnings: [
        {
          id: crypto.randomUUID(),
          tier: 'stage',
          category: 'testing',
          content: 'Write tests first',
          evidence: [],
          confidence: 0.85,
          stageType: 'build',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }));

    const text = output.join('');
    expect(text).toContain('Injected Learnings');
    expect(text).toContain('stage/testing');
    expect(text).toContain('Write tests first');
    expect(text).toContain('85%');
  });

  it('omits sections that have no data', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest({
      artifacts: [],
      learnings: [],
    }));

    const text = output.join('');
    expect(text).not.toContain('Artifacts to Produce');
    expect(text).not.toContain('Gate Requirements');
    expect(text).not.toContain('Injected Learnings');
  });

  it('includes completion instruction at the end', async () => {
    const output: string[] = [];
    const adapter = new ManualAdapter((text) => output.push(text));

    await adapter.execute(makeManifest());

    const text = output.join('');
    expect(text).toContain('Complete the above stage manually');
  });
});
