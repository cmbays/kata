import { describe, it, expect } from 'vitest';
import {
  PipelineType,
  PipelineState,
  PipelineStageStateSchema,
  PipelineMetadataSchema,
  PipelineSchema,
  PipelineTemplateSchema,
} from './pipeline.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('PipelineType', () => {
  it('accepts all valid types', () => {
    for (const t of ['vertical', 'bug-fix', 'polish', 'spike', 'cooldown', 'custom']) {
      expect(PipelineType.parse(t)).toBe(t);
    }
  });
});

describe('PipelineState', () => {
  it('accepts all valid states', () => {
    for (const s of ['draft', 'active', 'paused', 'complete', 'abandoned']) {
      expect(PipelineState.parse(s)).toBe(s);
    }
  });
});

describe('PipelineStageStateSchema', () => {
  it('parses with defaults', () => {
    const result = PipelineStageStateSchema.parse({
      stageRef: { type: 'build' },
    });
    expect(result.state).toBe('pending');
    expect(result.artifacts).toEqual([]);
  });

  it('parses complete stage state', () => {
    const ts = now();
    const result = PipelineStageStateSchema.parse({
      stageRef: { type: 'review', flavor: 'security' },
      state: 'complete',
      artifacts: [{ name: 'report', producedAt: ts }],
      startedAt: ts,
      completedAt: ts,
    });
    expect(result.state).toBe('complete');
    expect(result.artifacts).toHaveLength(1);
  });
});

describe('PipelineMetadataSchema', () => {
  it('parses empty metadata with defaults', () => {
    const result = PipelineMetadataSchema.parse({});
    expect(result.issueRefs).toEqual([]);
  });

  it('parses full metadata', () => {
    const result = PipelineMetadataSchema.parse({
      projectRef: 'cmbays/kata',
      issueRefs: ['#1', '#2'],
      betId: uuid(),
      cycleId: uuid(),
    });
    expect(result.issueRefs).toHaveLength(2);
  });
});

describe('PipelineSchema', () => {
  it('parses minimal pipeline', () => {
    const ts = now();
    const result = PipelineSchema.parse({
      id: uuid(),
      name: 'Feature Build',
      type: 'vertical',
      stages: [{ stageRef: { type: 'build' } }],
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.state).toBe('draft');
    expect(result.currentStageIndex).toBe(0);
    expect(result.stages).toHaveLength(1);
  });

  it('parses full pipeline with all fields', () => {
    const ts = now();
    const result = PipelineSchema.parse({
      id: uuid(),
      name: 'Methodology Engine',
      type: 'vertical',
      stages: [
        { stageRef: { type: 'research' }, state: 'complete', startedAt: ts, completedAt: ts },
        { stageRef: { type: 'build' }, state: 'active', startedAt: ts },
      ],
      state: 'active',
      currentStageIndex: 1,
      metadata: { projectRef: 'cmbays/kata', issueRefs: ['#10'] },
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.stages).toHaveLength(2);
    expect(result.currentStageIndex).toBe(1);
    expect(result.metadata.projectRef).toBe('cmbays/kata');
  });

  it('rejects pipeline with no stages', () => {
    expect(() =>
      PipelineSchema.parse({
        id: uuid(),
        name: 'Empty',
        type: 'vertical',
        stages: [],
        createdAt: now(),
        updatedAt: now(),
      })
    ).toThrow();
  });

  it('rejects invalid UUID', () => {
    expect(() =>
      PipelineSchema.parse({
        id: 'not-a-uuid',
        name: 'Bad',
        type: 'vertical',
        stages: [{ stageRef: { type: 'build' } }],
        createdAt: now(),
        updatedAt: now(),
      })
    ).toThrow();
  });
});

describe('PipelineTemplateSchema', () => {
  it('parses template', () => {
    const result = PipelineTemplateSchema.parse({
      name: 'Standard Vertical',
      type: 'vertical',
      description: 'Full vertical pipeline',
      stages: [
        { type: 'research' },
        { type: 'shape' },
        { type: 'breadboard' },
        { type: 'plan' },
        { type: 'build' },
        { type: 'review' },
        { type: 'wrap-up' },
      ],
    });
    expect(result.stages).toHaveLength(7);
  });
});
