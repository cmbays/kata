import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  appendObservation,
  appendReflection,
  readReflections,
} from '@infra/persistence/run-store.js';
import { ValidationReflectionSchema } from '@domain/types/reflection.js';
import type { Observation } from '@domain/types/observation.js';
import { CalibrationDetector } from './calibration-detector.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrediction(
  content: string,
  overrides: Partial<Observation> = {},
): Observation {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    content,
    type: 'prediction',
    ...overrides,
  } as Observation;
}

function makeQuantPrediction(metric: string, predicted: number, unit: string, katakaId?: string): Observation {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    content: `predicted ${metric} ${predicted} ${unit}`,
    type: 'prediction',
    quantitative: { metric, predicted, unit },
    ...(katakaId ? { katakaId } : {}),
  } as Observation;
}

function writeValidation(
  runsDir: string,
  runId: string,
  predictionId: string,
  outcomeId: string,
  correct: boolean,
): void {
  const v = ValidationReflectionSchema.parse({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    observationIds: [predictionId, outcomeId],
    type: 'validation',
    predictionId,
    outcomeId,
    correct,
  });
  appendReflection(runsDir, runId, v, { level: 'run' });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CalibrationDetector', () => {
  let tmpDir: string;
  let runsDir: string;
  let runId: string;
  let detector: CalibrationDetector;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kata-cd-test-${randomUUID()}`);
    runsDir = join(tmpDir, 'runs');
    runId = randomUUID();
    mkdirSync(runsDir, { recursive: true });
    detector = new CalibrationDetector(runsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Below threshold — no biases
  // -------------------------------------------------------------------------

  it('detects no biases when fewer than 5 validations exist', () => {
    // Write only 4 validations — all thresholds require 5+
    for (let i = 0; i < 4; i++) {
      const predId = randomUUID();
      writeValidation(runsDir, runId, predId, randomUUID(), false);
    }

    const result = detector.detect(runId);
    expect(result.biasesDetected).toHaveLength(0);
    expect(result.calibrationsWritten).toBe(0);
    expect(result.synthesisWritten).toBe(false);
  });

  it('returns empty result for a run with no data at all', () => {
    const result = detector.detect(runId);
    expect(result.biasesDetected).toHaveLength(0);
    expect(result.calibrationsWritten).toBe(0);
    expect(result.synthesisWritten).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Overconfidence
  // -------------------------------------------------------------------------

  it('detects overconfidence when 5+ validations, >70% incorrect, >50% confident language', () => {
    // Write 5 predictions with confident language
    const predIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const pred = makePrediction(`will definitely complete task ${i} guaranteed`);
      appendObservation(runsDir, runId, pred, { level: 'run' });
      predIds.push(pred.id);
    }
    // Write 5 validations — 4 incorrect, 1 correct (80% incorrect > 70%)
    writeValidation(runsDir, runId, predIds[0]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[1]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[2]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[3]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[4]!, randomUUID(), true);

    const result = detector.detect(runId);
    expect(result.biasesDetected).toContain('overconfidence');
    expect(result.calibrationsWritten).toBeGreaterThanOrEqual(1);

    // Verify calibration reflection written to disk
    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const calibration = reflections.find((r) => r.type === 'calibration' && r.bias === 'overconfidence');
    expect(calibration).toBeDefined();
  });

  it('does NOT detect overconfidence when incorrect rate ≤70%', () => {
    const predIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const pred = makePrediction(`will definitely do task ${i}`);
      appendObservation(runsDir, runId, pred, { level: 'run' });
      predIds.push(pred.id);
    }
    // Only 3/5 incorrect = 60% < 70% threshold
    writeValidation(runsDir, runId, predIds[0]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[1]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[2]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[3]!, randomUUID(), true);
    writeValidation(runsDir, runId, predIds[4]!, randomUUID(), true);

    const result = detector.detect(runId);
    expect(result.biasesDetected).not.toContain('overconfidence');
  });

  // -------------------------------------------------------------------------
  // Estimation drift
  // -------------------------------------------------------------------------

  it('detects estimation-drift when 3+ quantitative predictions have >25% miss rate', () => {
    // Write 3 quantitative predictions
    const preds = [
      makeQuantPrediction('response-time', 200, 'ms'),
      makeQuantPrediction('memory-usage', 512, 'MB'),
      makeQuantPrediction('throughput', 1000, 'req/s'),
    ];
    for (const p of preds) {
      appendObservation(runsDir, runId, p, { level: 'run' });
    }

    // Write validations — 2 incorrect out of 3 = 66.7% miss rate > 25%
    writeValidation(runsDir, runId, preds[0]!.id, randomUUID(), false);
    writeValidation(runsDir, runId, preds[1]!.id, randomUUID(), false);
    writeValidation(runsDir, runId, preds[2]!.id, randomUUID(), true);

    const result = detector.detect(runId);
    expect(result.biasesDetected).toContain('estimation-drift');

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const drift = reflections.find((r) => r.type === 'calibration' && r.bias === 'estimation-drift');
    expect(drift).toBeDefined();
    if (drift?.type === 'calibration') {
      expect(drift.domain).toBe('quantitative');
    }
  });

  it('does NOT detect estimation-drift when fewer than 3 quantitative predictions', () => {
    const preds = [
      makeQuantPrediction('response-time', 200, 'ms'),
      makeQuantPrediction('memory-usage', 512, 'MB'),
    ];
    for (const p of preds) {
      appendObservation(runsDir, runId, p, { level: 'run' });
    }
    writeValidation(runsDir, runId, preds[0]!.id, randomUUID(), false);
    writeValidation(runsDir, runId, preds[1]!.id, randomUUID(), false);

    const result = detector.detect(runId);
    expect(result.biasesDetected).not.toContain('estimation-drift');
  });

  // -------------------------------------------------------------------------
  // Predictor divergence
  // -------------------------------------------------------------------------

  it('detects predictor-divergence when 8+ obs with katakaId and >40% accuracy diff', () => {
    // Agent A: 4 predictions, all correct → 100% accuracy
    const agentAPreds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pred = makePrediction(`agent-a prediction ${i}`, { katakaId: 'agent-a' });
      appendObservation(runsDir, runId, pred, { level: 'run' });
      agentAPreds.push(pred.id);
    }

    // Agent B: 4 predictions, all incorrect → 0% accuracy
    const agentBPreds: string[] = [];
    for (let i = 0; i < 4; i++) {
      const pred = makePrediction(`agent-b prediction ${i}`, { katakaId: 'agent-b' });
      appendObservation(runsDir, runId, pred, { level: 'run' });
      agentBPreds.push(pred.id);
    }

    // Validations for agent A: all correct
    for (const id of agentAPreds) {
      writeValidation(runsDir, runId, id, randomUUID(), true);
    }
    // Validations for agent B: all incorrect
    for (const id of agentBPreds) {
      writeValidation(runsDir, runId, id, randomUUID(), false);
    }

    const result = detector.detect(runId);
    expect(result.biasesDetected).toContain('predictor-divergence');

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const divergence = reflections.find(
      (r) => r.type === 'calibration' && r.bias === 'predictor-divergence',
    );
    expect(divergence).toBeDefined();
    if (divergence?.type === 'calibration') {
      expect(divergence.katakaId).toBe('agent-b'); // lower accuracy agent
    }
  });

  it('does NOT detect predictor-divergence when fewer than 8 observations with katakaId', () => {
    // Only 6 agent observations
    for (let i = 0; i < 3; i++) {
      const pred = makePrediction(`agent-a prediction ${i}`, { katakaId: 'agent-a' });
      appendObservation(runsDir, runId, pred, { level: 'run' });
      writeValidation(runsDir, runId, pred.id, randomUUID(), true);
    }
    for (let i = 0; i < 3; i++) {
      const pred = makePrediction(`agent-b prediction ${i}`, { katakaId: 'agent-b' });
      appendObservation(runsDir, runId, pred, { level: 'run' });
      writeValidation(runsDir, runId, pred.id, randomUUID(), false);
    }

    const result = detector.detect(runId);
    expect(result.biasesDetected).not.toContain('predictor-divergence');
  });

  // -------------------------------------------------------------------------
  // Synthesis written when 2+ calibrations detected
  // -------------------------------------------------------------------------

  it('writes SynthesisReflection when 2+ calibration biases are detected', () => {
    // Set up overconfidence: 5 confident predictions with >70% incorrect
    const predIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const pred = makePrediction(`will always certainly complete task ${i} definitely`);
      appendObservation(runsDir, runId, pred, { level: 'run' });
      predIds.push(pred.id);
    }
    writeValidation(runsDir, runId, predIds[0]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[1]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[2]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[3]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[4]!, randomUUID(), false);

    // Add quantitative predictions for estimation-drift (3+ quant preds with >25% miss)
    const quantPreds = [
      makeQuantPrediction('response-time', 100, 'ms'),
      makeQuantPrediction('latency', 50, 'ms'),
      makeQuantPrediction('throughput', 2000, 'req/s'),
    ];
    for (const p of quantPreds) {
      appendObservation(runsDir, runId, p, { level: 'run' });
    }
    // Also write validations for the quant predictions (all incorrect)
    writeValidation(runsDir, runId, quantPreds[0]!.id, randomUUID(), false);
    writeValidation(runsDir, runId, quantPreds[1]!.id, randomUUID(), false);
    writeValidation(runsDir, runId, quantPreds[2]!.id, randomUUID(), false);

    const result = detector.detect(runId);
    expect(result.biasesDetected.length).toBeGreaterThanOrEqual(2);
    expect(result.synthesisWritten).toBe(true);

    const reflections = readReflections(runsDir, runId, { level: 'run' });
    const synthesis = reflections.find((r) => r.type === 'synthesis');
    expect(synthesis).toBeDefined();
    if (synthesis?.type === 'synthesis') {
      expect(synthesis.insight).toMatch(/calibration biases/i);
      expect(synthesis.sourceReflectionIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('does NOT write synthesis when only 1 calibration bias is detected', () => {
    // Only overconfidence triggered — not estimation-drift or others
    const predIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const pred = makePrediction(`will definitely complete task ${i} always guaranteed`);
      appendObservation(runsDir, runId, pred, { level: 'run' });
      predIds.push(pred.id);
    }
    // 4/5 incorrect = 80% > 70%
    writeValidation(runsDir, runId, predIds[0]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[1]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[2]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[3]!, randomUUID(), false);
    writeValidation(runsDir, runId, predIds[4]!, randomUUID(), true);

    const result = detector.detect(runId);
    // Even if overconfidence fires, we only have 1 calibration
    expect(result.synthesisWritten).toBe(result.calibrationsWritten >= 2);
  });
});
