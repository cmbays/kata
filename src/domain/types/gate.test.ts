import { describe, it, expect } from 'vitest';
import { GateConditionType, GateConditionSchema, GateType, GateSchema, GateResultSchema } from './gate.js';

describe('GateConditionType', () => {
  it('accepts valid condition types', () => {
    for (const type of ['artifact-exists', 'schema-valid', 'human-approved', 'predecessor-complete', 'command-passes']) {
      expect(GateConditionType.parse(type)).toBe(type);
    }
  });

  it('rejects invalid condition type', () => {
    expect(() => GateConditionType.parse('invalid')).toThrow();
  });
});

describe('GateConditionSchema', () => {
  it('parses minimal condition', () => {
    const result = GateConditionSchema.parse({ type: 'artifact-exists' });
    expect(result.type).toBe('artifact-exists');
    expect(result.description).toBeUndefined();
  });

  it('parses full condition with optional fields', () => {
    const result = GateConditionSchema.parse({
      type: 'artifact-exists',
      description: 'Check shaping doc exists',
      artifactName: 'shaping.md',
    });
    expect(result.description).toBe('Check shaping doc exists');
    expect(result.artifactName).toBe('shaping.md');
  });

  it('parses artifact-exists with sourceStage for cross-stage dependencies', () => {
    const result = GateConditionSchema.parse({
      type: 'artifact-exists',
      artifactName: 'implementation-plan.md',
      sourceStage: 'plan',
    });
    expect(result.artifactName).toBe('implementation-plan.md');
    expect(result.sourceStage).toBe('plan');
  });

  it('sourceStage is undefined when not provided', () => {
    const result = GateConditionSchema.parse({ type: 'artifact-exists', artifactName: 'file.md' });
    expect(result.sourceStage).toBeUndefined();
  });

  it('parses predecessor-complete with predecessorType', () => {
    const result = GateConditionSchema.parse({
      type: 'predecessor-complete',
      predecessorType: 'research',
    });
    expect(result.predecessorType).toBe('research');
  });

  it('parses command-passes with command field', () => {
    const result = GateConditionSchema.parse({
      type: 'command-passes',
      command: 'node --version',
    });
    expect(result.type).toBe('command-passes');
    expect(result.command).toBe('node --version');
  });
});

describe('GateType', () => {
  it('accepts entry and exit', () => {
    expect(GateType.parse('entry')).toBe('entry');
    expect(GateType.parse('exit')).toBe('exit');
  });
});

describe('GateSchema', () => {
  it('parses minimal gate with defaults', () => {
    const result = GateSchema.parse({ type: 'entry' });
    expect(result.type).toBe('entry');
    expect(result.conditions).toEqual([]);
    expect(result.required).toBe(true);
  });

  it('parses gate with conditions', () => {
    const result = GateSchema.parse({
      type: 'exit',
      conditions: [
        { type: 'artifact-exists', artifactName: 'breadboard.md' },
        { type: 'human-approved' },
      ],
      required: false,
    });
    expect(result.conditions).toHaveLength(2);
    expect(result.required).toBe(false);
  });
});

describe('GateResultSchema', () => {
  it('parses a passing gate result', () => {
    const now = new Date().toISOString();
    const result = GateResultSchema.parse({
      gate: { type: 'entry', conditions: [], required: true },
      passed: true,
      results: [],
      evaluatedAt: now,
    });
    expect(result.passed).toBe(true);
    expect(result.evaluatedAt).toBe(now);
  });

  it('parses gate result with per-condition details', () => {
    const now = new Date().toISOString();
    const result = GateResultSchema.parse({
      gate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'plan.md' }],
      },
      passed: false,
      results: [
        {
          condition: { type: 'artifact-exists', artifactName: 'plan.md' },
          passed: false,
          detail: 'File not found at .kata/artifacts/plan.md',
        },
      ],
      evaluatedAt: now,
    });
    expect(result.passed).toBe(false);
    expect(result.results[0]!.detail).toContain('File not found');
  });

  it('rejects invalid datetime', () => {
    expect(() =>
      GateResultSchema.parse({
        gate: { type: 'entry' },
        passed: true,
        results: [],
        evaluatedAt: 'not-a-date',
      })
    ).toThrow();
  });
});
