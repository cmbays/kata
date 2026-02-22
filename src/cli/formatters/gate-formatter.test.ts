import type { GateResult } from '@domain/types/gate.js';
import { formatGateResult, formatGateResultJson } from './gate-formatter.js';

function makeGateResult(overrides?: Partial<GateResult>): GateResult {
  return {
    gate: {
      type: 'entry',
      conditions: [],
      required: true,
    },
    passed: true,
    results: [],
    evaluatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('formatGateResult', () => {
  it('should display gate type and status', () => {
    const result = makeGateResult({ passed: true });
    const output = formatGateResult(result);

    expect(output).toContain('Entry Gate');
    expect(output).toContain('required');
    expect(output).toContain('PASSED');
  });

  it('should display FAILED for failing gates', () => {
    const result = makeGateResult({ passed: false });
    const output = formatGateResult(result);

    expect(output).toContain('FAILED');
  });

  it('should display optional for non-required gates', () => {
    const result = makeGateResult({
      gate: { type: 'exit', conditions: [], required: false },
    });
    const output = formatGateResult(result);

    expect(output).toContain('Exit Gate');
    expect(output).toContain('optional');
  });

  it('should display condition results with icons', () => {
    const result = makeGateResult({
      results: [
        {
          condition: { type: 'artifact-exists', artifactName: 'pitch-doc' },
          passed: true,
          detail: 'Artifact "pitch-doc" is available',
        },
        {
          condition: { type: 'predecessor-complete', predecessorType: 'research' },
          passed: false,
          detail: 'Predecessor "research" has not been completed',
        },
      ],
    });
    const output = formatGateResult(result);

    expect(output).toContain('+ [artifact-exists]');
    expect(output).toContain('x [predecessor-complete]');
    expect(output).toContain('Artifact "pitch-doc" is available');
    expect(output).toContain('has not been completed');
  });

  it('should use condition description when available', () => {
    const result = makeGateResult({
      results: [
        {
          condition: {
            type: 'artifact-exists',
            artifactName: 'doc',
            description: 'Documentation must exist',
          },
          passed: true,
          detail: 'Found it',
        },
      ],
    });
    const output = formatGateResult(result);

    expect(output).toContain('Documentation must exist');
  });

  it('should handle empty conditions', () => {
    const result = makeGateResult({
      results: [],
    });
    const output = formatGateResult(result);

    expect(output).toContain('No conditions to evaluate');
  });
});

describe('formatGateResultJson', () => {
  it('should return valid JSON', () => {
    const result = makeGateResult({
      gate: { type: 'entry', conditions: [{ type: 'schema-valid' }], required: true },
      results: [
        {
          condition: { type: 'schema-valid' },
          passed: true,
          detail: 'Deferred',
        },
      ],
    });
    const json = formatGateResultJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.gateType).toBe('entry');
    expect(parsed.required).toBe(true);
    expect(parsed.passed).toBe(true);
    expect(parsed.conditions).toHaveLength(1);
    expect(parsed.conditions[0].type).toBe('schema-valid');
    expect(parsed.conditions[0].passed).toBe(true);
  });

  it('should include evaluatedAt', () => {
    const result = makeGateResult();
    const json = formatGateResultJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.evaluatedAt).toBeDefined();
  });
});
