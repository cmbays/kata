import { describe, it, expect } from 'vitest';
import {
  RunSchema,
  StageStateSchema,
  FlavorStateSchema,
  FlavorStepRunSchema,
  DecisionEntrySchema,
  DecisionOutcomeEntrySchema,
  ArtifactIndexEntrySchema,
} from './run-state.js';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_TS = '2026-01-01T00:00:00.000Z';

describe('RunSchema', () => {
  const minimal = {
    id: VALID_UUID,
    cycleId: VALID_UUID,
    betId: VALID_UUID,
    betPrompt: 'Implement auth',
    stageSequence: ['research', 'plan'],
    currentStage: null,
    status: 'pending',
    startedAt: VALID_TS,
  };

  it('parses a minimal valid run', () => {
    const result = RunSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });

  it('parses a full run with optional fields', () => {
    const full = {
      ...minimal,
      kataPattern: 'full-feature',
      currentStage: 'research',
      status: 'running',
      completedAt: VALID_TS,
    };
    const result = RunSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects empty stageSequence', () => {
    const result = RunSchema.safeParse({ ...minimal, stageSequence: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid status', () => {
    const result = RunSchema.safeParse({ ...minimal, status: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid stage in stageSequence', () => {
    const result = RunSchema.safeParse({ ...minimal, stageSequence: ['research', 'deploy'] });
    expect(result.success).toBe(false);
  });
});

describe('StageStateSchema', () => {
  const minimal = {
    category: 'research',
    status: 'pending',
  };

  it('parses minimal stage state (arrays default to [])', () => {
    const result = StageStateSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectedFlavors).toEqual([]);
      expect(result.data.gaps).toEqual([]);
      expect(result.data.decisions).toEqual([]);
    }
  });

  it('parses full stage state', () => {
    const full = {
      category: 'plan',
      status: 'running',
      selectedFlavors: ['architecture', 'task-breakdown'],
      executionMode: 'parallel',
      gaps: [{ description: 'No security flavor', severity: 'medium' }],
      synthesisArtifact: 'stages/plan/synthesis.md',
      decisions: [VALID_UUID],
      startedAt: VALID_TS,
      completedAt: VALID_TS,
    };
    const result = StageStateSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects invalid executionMode', () => {
    const result = StageStateSchema.safeParse({ ...minimal, executionMode: 'random' });
    expect(result.success).toBe(false);
  });
});

describe('FlavorStateSchema', () => {
  const minimal = {
    name: 'technical-research',
    stageCategory: 'research',
    status: 'pending',
    currentStep: null,
  };

  it('parses minimal flavor state (steps defaults to [])', () => {
    const result = FlavorStateSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps).toEqual([]);
    }
  });

  it('parses flavor with steps', () => {
    const full = {
      ...minimal,
      status: 'running',
      currentStep: 0,
      steps: [
        {
          type: 'gather-context',
          status: 'completed',
          artifacts: ['context.md'],
          startedAt: VALID_TS,
          completedAt: VALID_TS,
        },
        { type: 'deep-dive', status: 'running', startedAt: VALID_TS },
      ],
    };
    const result = FlavorStateSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('rejects negative currentStep', () => {
    const result = FlavorStateSchema.safeParse({ ...minimal, currentStep: -1 });
    expect(result.success).toBe(false);
  });
});

describe('FlavorStepRunSchema', () => {
  it('parses minimal step run (artifacts defaults to [])', () => {
    const result = FlavorStepRunSchema.safeParse({ type: 'build', status: 'pending' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.artifacts).toEqual([]);
    }
  });

  it('rejects empty type', () => {
    const result = FlavorStepRunSchema.safeParse({ type: '', status: 'pending' });
    expect(result.success).toBe(false);
  });
});

describe('DecisionEntrySchema', () => {
  const valid = {
    id: VALID_UUID,
    stageCategory: 'research',
    flavor: 'technical-research',
    step: 'gather-context',
    decisionType: 'flavor-selection',
    context: { betType: 'auth' },
    options: ['technical-research', 'codebase-analysis'],
    selection: 'technical-research',
    reasoning: 'Best match for auth bet',
    confidence: 0.87,
    decidedAt: VALID_TS,
  };

  it('parses a valid decision entry', () => {
    const result = DecisionEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('allows null flavor and step', () => {
    const result = DecisionEntrySchema.safeParse({ ...valid, flavor: null, step: null });
    expect(result.success).toBe(true);
  });

  it('rejects confidence > 1', () => {
    const result = DecisionEntrySchema.safeParse({ ...valid, confidence: 1.1 });
    expect(result.success).toBe(false);
  });

  it('accepts empty options array (gap-assessment decisions may have no discrete options)', () => {
    const result = DecisionEntrySchema.safeParse({ ...valid, options: [] });
    expect(result.success).toBe(true);
  });

  it('accepts arbitrary decisionType strings (open vocabulary)', () => {
    const result = DecisionEntrySchema.safeParse({ ...valid, decisionType: 'custom-judgment' });
    expect(result.success).toBe(true);
  });
});

describe('DecisionOutcomeEntrySchema', () => {
  const valid = {
    decisionId: VALID_UUID,
    outcome: 'good',
    notes: 'Worked perfectly',
    updatedAt: VALID_TS,
  };

  it('parses a valid outcome entry', () => {
    const result = DecisionOutcomeEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('parses without optional fields', () => {
    const result = DecisionOutcomeEntrySchema.safeParse({
      decisionId: VALID_UUID,
      outcome: 'unknown',
      updatedAt: VALID_TS,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid outcome value', () => {
    const result = DecisionOutcomeEntrySchema.safeParse({ ...valid, outcome: 'excellent' });
    expect(result.success).toBe(false);
  });
});

describe('ArtifactIndexEntrySchema', () => {
  const valid = {
    id: VALID_UUID,
    stageCategory: 'build',
    flavor: 'tdd',
    step: 'write-tests',
    fileName: 'tests.md',
    filePath: '/abs/path/tests.md',
    summary: 'Unit tests for auth module',
    type: 'artifact',
    recordedAt: VALID_TS,
  };

  it('parses a valid artifact index entry', () => {
    const result = ArtifactIndexEntrySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('parses synthesis type with null step', () => {
    const result = ArtifactIndexEntrySchema.safeParse({ ...valid, step: null, type: 'synthesis' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = ArtifactIndexEntrySchema.safeParse({ ...valid, type: 'report' });
    expect(result.success).toBe(false);
  });

  it('rejects empty fileName', () => {
    const result = ArtifactIndexEntrySchema.safeParse({ ...valid, fileName: '' });
    expect(result.success).toBe(false);
  });
});
