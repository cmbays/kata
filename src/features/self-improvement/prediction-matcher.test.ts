import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { appendObservation, appendReflection, readReflections } from '@infra/persistence/run-store.js';
import type { Observation } from '@domain/types/observation.js';
import type { Reflection } from '@domain/types/reflection.js';
import { ValidationReflectionSchema } from '@domain/types/reflection.js';
import { PredictionMatcher } from './prediction-matcher.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrediction(content: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    content,
    type: 'prediction',
    ...overrides,
  } as Observation;
}

function makeOutcome(content: string, overrides: Partial<Observation> = {}): Observation {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    content,
    type: 'outcome',
    ...overrides,
  } as Observation;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PredictionMatcher', () => {
  let tmpDir: string;
  let runsDir: string;
  let runId: string;
  let matcher: PredictionMatcher;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `kata-pm-test-${randomUUID()}`);
    runsDir = join(tmpDir, 'runs');
    runId = randomUUID();
    mkdirSync(runsDir, { recursive: true });
    matcher = new PredictionMatcher(runsDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // appendReflection + readReflections round-trip
  // -------------------------------------------------------------------------

  it('round-trips a validation reflection via appendReflection / readReflections', () => {
    const reflection: Reflection = ValidationReflectionSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      observationIds: [],
      type: 'validation',
      predictionId: randomUUID(),
      outcomeId: randomUUID(),
      correct: true,
    });
    appendReflection(runsDir, runId, reflection, { level: 'run' });
    const reflections = readReflections(runsDir, runId, { level: 'run' });
    expect(reflections).toHaveLength(1);
    expect(reflections[0]).toMatchObject({ type: 'validation', correct: true });
  });

  it('returns empty array when no reflections file exists', () => {
    const reflections = readReflections(runsDir, runId, { level: 'run' });
    expect(reflections).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Empty run
  // -------------------------------------------------------------------------

  it('returns zero matched/unmatched for empty run with no observations', () => {
    const result = matcher.match(runId);
    expect(result.runId).toBe(runId);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(0);
    expect(result.reflectionsWritten).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Matched prediction → correct: true (≥60% overlap)
  // -------------------------------------------------------------------------

  it('matches prediction to outcome with high keyword overlap → correct: true', () => {
    // 5 non-stop words: "deploy", "service", "kubernetes", "cluster", "production"
    const prediction = makePrediction('deploy service kubernetes cluster production');
    const outcome = makeOutcome('deployed service to kubernetes cluster in production environment');
    appendObservation(runsDir, runId, prediction, { level: 'run' });
    appendObservation(runsDir, runId, outcome, { level: 'run' });

    const result = matcher.match(runId);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.matched[0]).toMatchObject({
      predictionId: prediction.id,
      outcomeId: outcome.id,
      correct: true,
    });
  });

  // -------------------------------------------------------------------------
  // Unmatched prediction → no outcome found
  // -------------------------------------------------------------------------

  it('writes UnmatchedReflection when no outcome exists for a prediction', () => {
    const prediction = makePrediction('cache invalidation strategy redis memcached');
    appendObservation(runsDir, runId, prediction, { level: 'run' });

    const result = matcher.match(runId);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
    expect(result.unmatched[0]).toMatchObject({
      predictionId: prediction.id,
      reason: 'no-outcome-found',
    });

    // Verify the reflection is written to disk
    const reflections = readReflections(runsDir, runId, { level: 'run' });
    expect(reflections).toHaveLength(1);
    expect(reflections[0]).toMatchObject({ type: 'unmatched', predictionId: prediction.id });
  });

  // -------------------------------------------------------------------------
  // Low keyword overlap → match found but correct: false (<60%)
  // -------------------------------------------------------------------------

  it('matches prediction to outcome but marks correct: false when overlap < 60%', () => {
    // Prediction keywords: deploy, release, staging, environment, smoke (5 words)
    // Outcome shares only: deploy (1 / 5 = 20% → < 60%)
    const prediction = makePrediction('deploy release staging environment smoke');
    const outcome = makeOutcome('deploy completed');
    appendObservation(runsDir, runId, prediction, { level: 'run' });
    appendObservation(runsDir, runId, outcome, { level: 'run' });

    const result = matcher.match(runId);
    // overlap > 0 so there IS a match, but overlap < 60% so correct: false
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].correct).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Multiple predictions — each matched independently
  // -------------------------------------------------------------------------

  it('handles multiple predictions matched to distinct outcomes', () => {
    const pred1 = makePrediction('database migration postgres schema');
    const pred2 = makePrediction('frontend build webpack bundle size');
    const out1 = makeOutcome('database migration postgres schema completed successfully');
    const out2 = makeOutcome('frontend build webpack bundle size reduced');
    appendObservation(runsDir, runId, pred1, { level: 'run' });
    appendObservation(runsDir, runId, pred2, { level: 'run' });
    appendObservation(runsDir, runId, out1, { level: 'run' });
    appendObservation(runsDir, runId, out2, { level: 'run' });

    const result = matcher.match(runId);
    expect(result.matched).toHaveLength(2);
    expect(result.unmatched).toHaveLength(0);
    const outcomeIds = result.matched.map((m) => m.outcomeId);
    expect(new Set(outcomeIds).size).toBe(2); // distinct outcomes
  });

  // -------------------------------------------------------------------------
  // Reflections count is accurate
  // -------------------------------------------------------------------------

  it('reflectionsWritten matches the actual reflections on disk', () => {
    const pred = makePrediction('test coverage unit integration end-to-end');
    const out = makeOutcome('test coverage unit integration end-to-end achieved');
    appendObservation(runsDir, runId, pred, { level: 'run' });
    appendObservation(runsDir, runId, out, { level: 'run' });

    const result = matcher.match(runId);
    const onDisk = readReflections(runsDir, runId, { level: 'run' });
    expect(result.reflectionsWritten).toBe(onDisk.length);
  });

  // -------------------------------------------------------------------------
  // Observations at stage level are also collected
  // -------------------------------------------------------------------------

  it('collects observations from stage-level and matches them', () => {
    const prediction = makePrediction('auth token expiry jwt refresh cycle');
    const outcome = makeOutcome('auth token expiry jwt refresh cycle implemented');
    appendObservation(runsDir, runId, prediction, { level: 'stage', category: 'build' });
    appendObservation(runsDir, runId, outcome, { level: 'stage', category: 'build' });

    const result = matcher.match(runId);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].correct).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Prediction with all stop-word content → no keywords → no match
  // -------------------------------------------------------------------------

  it('prediction with only stop words yields no match (treated as unmatched)', () => {
    // All stop words: "the", "a", "is", "for", "in"
    const prediction = makePrediction('the a is for in');
    const outcome = makeOutcome('the a is for in');
    appendObservation(runsDir, runId, prediction, { level: 'run' });
    appendObservation(runsDir, runId, outcome, { level: 'run' });

    const result = matcher.match(runId);
    // No keywords extracted → overlap ratio = 0 → no match
    expect(result.unmatched).toHaveLength(1);
    expect(result.matched).toHaveLength(0);
  });
});
