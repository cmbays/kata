import { describe, it, expect } from 'vitest';
import {
  LearningTier,
  LearningEvidenceSchema,
  LearningSchema,
  LearningFilterSchema,
  LearningPermanence,
  LearningSource,
  CitationSchema,
  ReinforcementSchema,
  LearningVersionSchema,
} from './learning.js';

const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

describe('LearningTier', () => {
  it('accepts all tiers including Wave F additions', () => {
    for (const t of ['step', 'flavor', 'stage', 'category', 'agent']) {
      expect(LearningTier.parse(t)).toBe(t);
    }
  });

  it('rejects unknown tier', () => {
    expect(() => LearningTier.parse('run')).toThrow();
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

describe('CitationSchema', () => {
  it('parses a minimal citation', () => {
    const c = CitationSchema.parse({
      observationId: uuid(),
      citedAt: now(),
    });
    expect(c.observationId).toBeDefined();
    expect(c.path).toBeUndefined();
  });

  it('accepts optional path', () => {
    const c = CitationSchema.parse({
      observationId: uuid(),
      path: 'run-1/build/obs-3',
      citedAt: now(),
    });
    expect(c.path).toBe('run-1/build/obs-3');
  });
});

describe('ReinforcementSchema', () => {
  it('parses a reinforcement event', () => {
    const r = ReinforcementSchema.parse({
      observationId: uuid(),
      reinforcedAt: now(),
    });
    expect(r.observationId).toBeDefined();
    expect(r.confidenceDelta).toBeUndefined();
  });

  it('accepts optional confidenceDelta', () => {
    const r = ReinforcementSchema.parse({
      observationId: uuid(),
      reinforcedAt: now(),
      confidenceDelta: 0.05,
    });
    expect(r.confidenceDelta).toBe(0.05);
  });
});

describe('LearningVersionSchema', () => {
  it('parses a version snapshot', () => {
    const v = LearningVersionSchema.parse({
      content: 'Previous content',
      confidence: 0.6,
      updatedAt: now(),
    });
    expect(v.content).toBe('Previous content');
    expect(v.changeReason).toBeUndefined();
  });
});

describe('LearningPermanence', () => {
  it('accepts all permanence tiers', () => {
    for (const p of ['operational', 'strategic', 'constitutional']) {
      expect(LearningPermanence.parse(p)).toBe(p);
    }
  });
});

describe('LearningSource', () => {
  it('accepts all source values', () => {
    for (const s of ['extracted', 'synthesized', 'imported', 'user']) {
      expect(LearningSource.parse(s)).toBe(s);
    }
  });
});

describe('LearningSchema — Wave F graph fields', () => {
  const ts = () => new Date().toISOString();

  it('defaults all graph fields correctly', () => {
    const l = LearningSchema.parse({
      id: uuid(),
      tier: 'stage',
      category: 'testing',
      content: 'Write tests first',
      createdAt: ts(),
      updatedAt: ts(),
    });
    expect(l.citations).toEqual([]);
    expect(l.derivedFrom).toEqual([]);
    expect(l.reinforcedBy).toEqual([]);
    expect(l.usageCount).toBe(0);
    expect(l.versions).toEqual([]);
    expect(l.archived).toBe(false);
    expect(l.permanence).toBeUndefined();
    expect(l.source).toBeUndefined();
    expect(l.overrides).toBeUndefined();
    expect(l.refreshBy).toBeUndefined();
    expect(l.expiresAt).toBeUndefined();
  });

  it('parses a fully-enriched learning', () => {
    const obsId = uuid();
    const parentId = uuid();
    const t = ts();

    const l = LearningSchema.parse({
      id: uuid(),
      tier: 'flavor',
      category: 'tdd-patterns',
      content: 'TDD ryu reduces rework in data models',
      createdAt: t,
      updatedAt: t,
      citations: [{ observationId: obsId, path: 'run-1/build/obs-1', citedAt: t }],
      derivedFrom: [parentId],
      reinforcedBy: [{ observationId: obsId, reinforcedAt: t, confidenceDelta: 0.1 }],
      usageCount: 3,
      lastUsedAt: t,
      versions: [{ content: 'Old content', confidence: 0.5, updatedAt: t }],
      archived: false,
      permanence: 'strategic',
      source: 'extracted',
      overrides: [parentId],
      refreshBy: t,
      expiresAt: t,
    });

    expect(l.citations).toHaveLength(1);
    expect(l.citations[0].observationId).toBe(obsId);
    expect(l.derivedFrom).toContain(parentId);
    expect(l.reinforcedBy).toHaveLength(1);
    expect(l.usageCount).toBe(3);
    expect(l.lastUsedAt).toBeDefined();
    expect(l.versions).toHaveLength(1);
    expect(l.archived).toBe(false);
    expect(l.permanence).toBe('strategic');
    expect(l.source).toBe('extracted');
  });

  it('accepts step and flavor tiers (Wave F)', () => {
    const base = {
      id: uuid(),
      category: 'test',
      content: 'test content',
      createdAt: ts(),
      updatedAt: ts(),
    };
    expect(LearningSchema.parse({ ...base, tier: 'step' }).tier).toBe('step');
    expect(LearningSchema.parse({ ...base, tier: 'flavor' }).tier).toBe('flavor');
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

  it('accepts Wave F filter fields', () => {
    const result = LearningFilterSchema.parse({
      includeArchived: true,
      permanence: 'constitutional',
      source: 'user',
    });
    expect(result.includeArchived).toBe(true);
    expect(result.permanence).toBe('constitutional');
    expect(result.source).toBe('user');
  });
});
