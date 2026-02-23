import type { Gate } from '@domain/types/gate.js';
import { evaluateGate, type GateEvalContext } from './gate-evaluator.js';

describe('evaluateGate', () => {
  const baseContext: GateEvalContext = {
    availableArtifacts: ['pitch-doc', 'breadboard'],
    completedStages: ['research', 'shape'],
    humanApproved: false,
  };

  describe('artifact-exists condition', () => {
    it('should pass when artifact is available', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', artifactName: 'pitch-doc' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      expect(result.results[0]?.passed).toBe(true);
      expect(result.results[0]?.detail).toContain('pitch-doc');
      expect(result.results[0]?.detail).toContain('available');
    });

    it('should fail when artifact is not available', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', artifactName: 'missing-artifact' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[0]?.detail).toContain('not found');
    });

    it('should fail when artifactName is missing from condition', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[0]?.detail).toContain('missing artifactName');
    });
  });

  describe('predecessor-complete condition', () => {
    it('should pass when predecessor is complete', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'predecessor-complete', predecessorType: 'research' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      expect(result.results[0]?.passed).toBe(true);
      expect(result.results[0]?.detail).toContain('complete');
    });

    it('should fail when predecessor is not complete', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'predecessor-complete', predecessorType: 'build' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[0]?.detail).toContain('has not been completed');
    });

    it('should fail when predecessorType is missing from condition', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'predecessor-complete' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[0]?.detail).toContain('missing predecessorType');
    });
  });

  describe('human-approved condition', () => {
    it('should pass when human has approved', async () => {
      const gate: Gate = {
        type: 'exit',
        conditions: [
          { type: 'human-approved' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, { ...baseContext, humanApproved: true });

      expect(result.passed).toBe(true);
      expect(result.results[0]?.passed).toBe(true);
      expect(result.results[0]?.detail).toContain('granted');
    });

    it('should fail when human has not approved', async () => {
      const gate: Gate = {
        type: 'exit',
        conditions: [
          { type: 'human-approved' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, { ...baseContext, humanApproved: false });

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[0]?.detail).toContain('not yet granted');
    });

    it('should fail when humanApproved is undefined', async () => {
      const gate: Gate = {
        type: 'exit',
        conditions: [
          { type: 'human-approved' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, {
        availableArtifacts: [],
        completedStages: [],
      });

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(false);
    });
  });

  describe('schema-valid condition', () => {
    it('should always pass (validation deferred to capture time)', async () => {
      const gate: Gate = {
        type: 'exit',
        conditions: [
          { type: 'schema-valid' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      expect(result.results[0]?.passed).toBe(true);
      expect(result.results[0]?.detail).toContain('deferred');
    });
  });

  describe('multiple conditions', () => {
    it('should pass when all conditions pass', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', artifactName: 'pitch-doc' },
          { type: 'predecessor-complete', predecessorType: 'research' },
          { type: 'schema-valid' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.passed)).toBe(true);
    });

    it('should fail when any condition fails (required gate)', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', artifactName: 'pitch-doc' },
          { type: 'predecessor-complete', predecessorType: 'build' },
          { type: 'schema-valid' },
        ],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(false);
      expect(result.results[0]?.passed).toBe(true);
      expect(result.results[1]?.passed).toBe(false);
      expect(result.results[2]?.passed).toBe(true);
    });
  });

  describe('non-required gates', () => {
    it('should pass overall even when conditions fail', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [
          { type: 'artifact-exists', artifactName: 'missing-artifact' },
          { type: 'predecessor-complete', predecessorType: 'build' },
        ],
        required: false,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      // Individual conditions still report their actual status
      expect(result.results[0]?.passed).toBe(false);
      expect(result.results[1]?.passed).toBe(false);
    });
  });

  describe('empty conditions', () => {
    it('should pass when gate has no conditions', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.passed).toBe(true);
      expect(result.results).toHaveLength(0);
    });
  });

  describe('result metadata', () => {
    it('should include evaluatedAt timestamp', async () => {
      const gate: Gate = {
        type: 'entry',
        conditions: [],
        required: true,
      };

      const before = new Date().toISOString();
      const result = await evaluateGate(gate, baseContext);
      const after = new Date().toISOString();

      expect(result.evaluatedAt).toBeDefined();
      expect(result.evaluatedAt >= before).toBe(true);
      expect(result.evaluatedAt <= after).toBe(true);
    });

    it('should include the original gate in the result', async () => {
      const gate: Gate = {
        type: 'exit',
        conditions: [{ type: 'schema-valid' }],
        required: true,
      };

      const result = await evaluateGate(gate, baseContext);

      expect(result.gate).toEqual(gate);
    });
  });
});
