import { describe, it, expect } from 'vitest';
import { LearningTier, LearningEvidenceSchema, LearningSchema, LearningFilterSchema } from './learning.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('LearningTier', () => {
  it('accepts all tiers', () => {
    for (const t of ['stage', 'category', 'agent']) {
      expect(LearningTier.parse(t)).toBe(t);
    }
  });
});

describe('LearningEvidenceSchema', () => {
  it('parses evidence', () => {
    const result = LearningEvidenceSchema.parse({
      pipelineId: 'pipe-123',
      stageType: 'build',
      observation: 'Parallel sessions reduced conflicts when touching non-overlapping dirs',
      recordedAt: now(),
    });
    expect(result.observation).toContain('Parallel sessions');
  });
});

describe('LearningSchema', () => {
  it('parses minimal learning with defaults', () => {
    const ts = now();
    const result = LearningSchema.parse({
      id: uuid(),
      tier: 'stage',
      category: 'build-patterns',
      content: 'Co-locate tests with source files for faster discovery',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.evidence).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.stageType).toBeUndefined();
  });

  it('parses full learning with evidence', () => {
    const ts = now();
    const result = LearningSchema.parse({
      id: uuid(),
      tier: 'agent',
      category: 'testing',
      content: 'Schema tests should cover both valid parsing and rejection',
      evidence: [
        {
          pipelineId: 'pipe-1',
          stageType: 'build',
          observation: 'Found missing validation during review',
          recordedAt: ts,
        },
      ],
      confidence: 0.85,
      stageType: 'build',
      agentId: 'build-reviewer',
      createdAt: ts,
      updatedAt: ts,
    });
    expect(result.evidence).toHaveLength(1);
    expect(result.confidence).toBe(0.85);
    expect(result.agentId).toBe('build-reviewer');
  });

  it('rejects confidence > 1', () => {
    expect(() =>
      LearningSchema.parse({
        id: uuid(),
        tier: 'stage',
        category: 'test',
        content: 'test',
        confidence: 1.5,
        createdAt: now(),
        updatedAt: now(),
      })
    ).toThrow();
  });

  it('rejects empty category', () => {
    expect(() =>
      LearningSchema.parse({
        id: uuid(),
        tier: 'stage',
        category: '',
        content: 'test',
        createdAt: now(),
        updatedAt: now(),
      })
    ).toThrow();
  });
});

describe('LearningFilterSchema', () => {
  it('parses empty filter', () => {
    const result = LearningFilterSchema.parse({});
    expect(result.tier).toBeUndefined();
  });

  it('parses full filter', () => {
    const result = LearningFilterSchema.parse({
      tier: 'category',
      category: 'testing',
      stageType: 'build',
      agentId: 'reviewer',
      minConfidence: 0.5,
    });
    expect(result.minConfidence).toBe(0.5);
  });
});
