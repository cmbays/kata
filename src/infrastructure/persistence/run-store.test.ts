import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  createRunTree,
  readRun,
  writeRun,
  readStageState,
  writeStageState,
  readFlavorState,
  writeFlavorState,
  appendDecision,
  appendArtifact,
  appendObservation,
  readObservations,
  readAllObservationsForRun,
  appendReflection,
  readReflections,
  runPaths,
  type ObservationTarget,
} from './run-store.js';
import {
  DecisionEntrySchema,
  ArtifactIndexEntrySchema,
  type DecisionEntry,
  type ArtifactIndexEntry,
} from '@domain/types/run-state.js';
import { JsonlStore } from './jsonl-store.js';
import type { Run } from '@domain/types/run-state.js';
import { ObservationSchema, type Observation } from '@domain/types/observation.js';
import { ReflectionSchema, type Reflection } from '@domain/types/reflection.js';

const VALID_UUID = () => randomUUID();
const VALID_TS = '2026-01-01T00:00:00.000Z';

function tempRunsDir(): string {
  const dir = join(tmpdir(), `kata-run-store-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: VALID_UUID(),
    cycleId: VALID_UUID(),
    betId: VALID_UUID(),
    betPrompt: 'Implement auth',
    stageSequence: ['research', 'plan'],
    currentStage: null,
    status: 'pending',
    startedAt: VALID_TS,
    ...overrides,
  };
}

describe('createRunTree', () => {
  it('creates the run directory and run.json', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();

    createRunTree(runsDir, run);

    const paths = runPaths(runsDir, run.id);
    expect(existsSync(paths.runDir)).toBe(true);
    expect(existsSync(paths.runJson)).toBe(true);
  });

  it('creates per-stage directories and state.json files', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['research', 'plan', 'build'] });

    createRunTree(runsDir, run);

    const paths = runPaths(runsDir, run.id);
    for (const category of ['research', 'plan', 'build'] as const) {
      expect(existsSync(paths.stageDir(category))).toBe(true);
      expect(existsSync(paths.stateJson(category))).toBe(true);
    }
  });

  it('round-trips run.json via readRun', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ kataPattern: 'full-feature', currentStage: 'research', status: 'running' });

    createRunTree(runsDir, run);

    const loaded = readRun(runsDir, run.id);
    expect(loaded).toEqual(run);
  });

  it('initializes stage states as pending with empty arrays', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();

    createRunTree(runsDir, run);

    const researchState = readStageState(runsDir, run.id, 'research');
    expect(researchState.status).toBe('pending');
    expect(researchState.selectedFlavors).toEqual([]);
    expect(researchState.gaps).toEqual([]);
    expect(researchState.decisions).toEqual([]);
  });
});

describe('readRun / writeRun', () => {
  it('round-trips run state updates', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const updated: Run = { ...run, status: 'running', currentStage: 'research' };
    writeRun(runsDir, updated);

    const loaded = readRun(runsDir, run.id);
    expect(loaded.status).toBe('running');
    expect(loaded.currentStage).toBe('research');
  });
});

describe('readStageState / writeStageState', () => {
  it('round-trips stage state updates', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    writeStageState(runsDir, run.id, {
      category: 'research',
      status: 'running',
      selectedFlavors: ['technical-research'],
      executionMode: 'parallel',
      gaps: [{ description: 'No security flavor', severity: 'medium' as const }],
      decisions: [VALID_UUID()],
      startedAt: VALID_TS,
    });

    const state = readStageState(runsDir, run.id, 'research');
    expect(state.status).toBe('running');
    expect(state.selectedFlavors).toEqual(['technical-research']);
    expect(state.executionMode).toBe('parallel');
    expect(state.gaps).toHaveLength(1);
  });
});

describe('readFlavorState / writeFlavorState', () => {
  it('creates flavor directory on write and round-trips', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const flavorState = {
      name: 'technical-research',
      stageCategory: 'research' as const,
      status: 'running' as const,
      steps: [{ type: 'gather-context', status: 'completed' as const, artifacts: ['ctx.md'] }],
      currentStep: 0,
    };

    writeFlavorState(runsDir, run.id, 'research', flavorState);

    const paths = runPaths(runsDir, run.id);
    expect(existsSync(paths.flavorDir('research', 'technical-research'))).toBe(true);

    const loaded = readFlavorState(runsDir, run.id, 'research', 'technical-research');
    expect(loaded.name).toBe('technical-research');
    expect(loaded.steps).toHaveLength(1);
    expect(loaded.steps[0].artifacts).toEqual(['ctx.md']);
  });
});

describe('appendDecision', () => {
  it('appends a decision entry to decisions.jsonl', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const entry: DecisionEntry = {
      id: VALID_UUID(),
      stageCategory: 'research',
      flavor: 'technical-research',
      step: 'gather-context',
      decisionType: 'flavor-selection',
      context: { bet: 'auth' },
      options: ['a', 'b'],
      selection: 'a',
      reasoning: 'Best match',
      confidence: 0.85,
      decidedAt: VALID_TS,
    };

    appendDecision(runsDir, run.id, entry);

    const paths = runPaths(runsDir, run.id);
    const entries = JsonlStore.readAll(paths.decisionsJsonl, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
    expect(entries[0].selection).toBe('a');
  });

  it('appends multiple entries without overwriting', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const base: DecisionEntry = {
      id: VALID_UUID(),
      stageCategory: 'research',
      flavor: null,
      step: null,
      decisionType: 'gap-assessment',
      context: {},
      options: [],
      selection: 'gap-found',
      reasoning: 'Gap detected',
      confidence: 0.7,
      decidedAt: VALID_TS,
    };

    appendDecision(runsDir, run.id, base);
    appendDecision(runsDir, run.id, { ...base, id: VALID_UUID() });

    const paths = runPaths(runsDir, run.id);
    const entries = JsonlStore.readAll(paths.decisionsJsonl, DecisionEntrySchema);
    expect(entries).toHaveLength(2);
  });
});

describe('appendArtifact', () => {
  it('appends an artifact entry to artifact-index.jsonl', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const entry: ArtifactIndexEntry = {
      id: VALID_UUID(),
      stageCategory: 'build',
      flavor: 'tdd',
      step: 'write-tests',
      fileName: 'tests.md',
      filePath: 'stages/build/flavors/tdd/artifacts/tests.md',
      summary: 'Unit tests for auth module',
      type: 'artifact',
      recordedAt: VALID_TS,
    };

    appendArtifact(runsDir, run.id, entry);

    const paths = runPaths(runsDir, run.id);
    const entries = JsonlStore.readAll(paths.artifactIndexJsonl, ArtifactIndexEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(entry.id);
    expect(entries[0].fileName).toBe('tests.md');
  });

  it('accepts null flavor for stage-level synthesis', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const entry: ArtifactIndexEntry = {
      id: VALID_UUID(),
      stageCategory: 'research',
      flavor: null,
      step: null,
      fileName: 'synthesis.md',
      filePath: 'stages/research/synthesis.md',
      summary: 'Stage-level research synthesis',
      type: 'synthesis',
      recordedAt: VALID_TS,
    };

    appendArtifact(runsDir, run.id, entry);

    const paths = runPaths(runsDir, run.id);
    const entries = JsonlStore.readAll(paths.artifactIndexJsonl, ArtifactIndexEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].flavor).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Wave F — runPaths observation/reflection path helpers
// ---------------------------------------------------------------------------

describe('runPaths — Wave F observation/reflection paths', () => {
  it('exposes run-level observation paths', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    const paths = runPaths(runsDir, run.id);
    expect(paths.observationsJsonl).toContain('observations.jsonl');
    expect(paths.reflectionsJsonl).toContain('reflections.jsonl');
  });

  it('exposes stage-level observation paths', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    const paths = runPaths(runsDir, run.id);
    expect(paths.stageObservationsJsonl('build')).toContain('/stages/build/observations.jsonl');
    expect(paths.stageReflectionsJsonl('research')).toContain('/stages/research/reflections.jsonl');
  });

  it('exposes flavor-level observation paths', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    const paths = runPaths(runsDir, run.id);
    expect(paths.flavorObservationsJsonl('build', 'tdd')).toContain('/flavors/tdd/observations.jsonl');
    expect(paths.flavorReflectionsJsonl('build', 'tdd')).toContain('/flavors/tdd/reflections.jsonl');
  });

  it('exposes step-level observation paths', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    const paths = runPaths(runsDir, run.id);
    expect(paths.stepObservationsJsonl('build', 'tdd', 'write-tests')).toContain('/steps/write-tests/observations.jsonl');
    expect(paths.stepReflectionsJsonl('build', 'tdd', 'write-tests')).toContain('/steps/write-tests/reflections.jsonl');
  });
});

// ---------------------------------------------------------------------------
// Wave F — appendObservation / readObservations
// ---------------------------------------------------------------------------

function makeObservation(overrides: Partial<Observation> = {}): Observation {
  return ObservationSchema.parse({
    id: VALID_UUID(),
    timestamp: VALID_TS,
    content: 'test observation',
    type: 'insight',
    ...overrides,
  });
}

describe('appendObservation / readObservations', () => {
  it('appends and reads a run-level observation', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const obs = makeObservation({ type: 'decision', content: 'chose TDD approach' });
    const target: ObservationTarget = { level: 'run' };

    appendObservation(runsDir, run.id, obs, target);

    const loaded = readObservations(runsDir, run.id, target);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(obs.id);
    expect(loaded[0].type).toBe('decision');
    expect(loaded[0].content).toBe('chose TDD approach');
  });

  it('appends and reads a stage-level observation', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);
    const target: ObservationTarget = { level: 'stage', category: 'build' };

    const frictionObs = ObservationSchema.parse({
      id: VALID_UUID(),
      timestamp: VALID_TS,
      content: 'style guide conflict',
      type: 'friction',
      taxonomy: 'convention-clash',
      katakaId: 'builder-ka',
    });

    appendObservation(runsDir, run.id, frictionObs, target);

    const loaded = readObservations(runsDir, run.id, target);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].type).toBe('friction');
    if (loaded[0].type === 'friction') {
      expect(loaded[0].taxonomy).toBe('convention-clash');
      expect(loaded[0].katakaId).toBe('builder-ka');
    }
  });

  it('appends and reads a flavor-level observation', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const obs = makeObservation({ type: 'insight', content: 'TDD works better here' });
    const target: ObservationTarget = { level: 'flavor', category: 'build', flavor: 'tdd' };

    appendObservation(runsDir, run.id, obs, target);

    const loaded = readObservations(runsDir, run.id, target);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].content).toBe('TDD works better here');
  });

  it('appends and reads a step-level observation', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const gapObs = ObservationSchema.parse({
      id: VALID_UUID(),
      timestamp: VALID_TS,
      content: 'No tests for error paths',
      type: 'gap',
      severity: 'major',
    });
    const target: ObservationTarget = { level: 'step', category: 'build', flavor: 'tdd', step: 'write-tests' };

    appendObservation(runsDir, run.id, gapObs, target);

    const loaded = readObservations(runsDir, run.id, target);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].type).toBe('gap');
    if (loaded[0].type === 'gap') {
      expect(loaded[0].severity).toBe('major');
    }
  });

  it('returns empty array when no observations exist', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const loaded = readObservations(runsDir, run.id, { level: 'run' });
    expect(loaded).toEqual([]);
  });

  it('accumulates multiple observations without overwriting', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);
    const target: ObservationTarget = { level: 'run' };

    appendObservation(runsDir, run.id, makeObservation({ content: 'first' }), target);
    appendObservation(runsDir, run.id, makeObservation({ content: 'second' }), target);
    appendObservation(runsDir, run.id, makeObservation({ content: 'third' }), target);

    const loaded = readObservations(runsDir, run.id, target);
    expect(loaded).toHaveLength(3);
    expect(loaded.map((o) => o.content)).toEqual(['first', 'second', 'third']);
  });

  it('does not mix observations from different levels', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const runTarget: ObservationTarget = { level: 'run' };
    const stageTarget: ObservationTarget = { level: 'stage', category: 'research' };

    appendObservation(runsDir, run.id, makeObservation({ content: 'run-level' }), runTarget);
    appendObservation(runsDir, run.id, makeObservation({ content: 'stage-level' }), stageTarget);

    const runObs = readObservations(runsDir, run.id, runTarget);
    const stageObs = readObservations(runsDir, run.id, stageTarget);

    expect(runObs).toHaveLength(1);
    expect(runObs[0].content).toBe('run-level');
    expect(stageObs).toHaveLength(1);
    expect(stageObs[0].content).toBe('stage-level');
  });
});

// ---------------------------------------------------------------------------
// Wave F — appendReflection / readReflections
// ---------------------------------------------------------------------------

function makeReflection(): Reflection {
  return ReflectionSchema.parse({
    id: VALID_UUID(),
    timestamp: VALID_TS,
    observationIds: [],
    type: 'synthesis',
    sourceReflectionIds: [],
    insight: 'Calibration improves over time',
  });
}

describe('appendReflection / readReflections', () => {
  it('appends and reads a run-level reflection', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const ref = makeReflection();
    const target: ObservationTarget = { level: 'run' };

    appendReflection(runsDir, run.id, ref, target);

    const loaded = readReflections(runsDir, run.id, target);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe(ref.id);
    expect(loaded[0].type).toBe('synthesis');
  });

  it('returns empty array when no reflections exist', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);

    const loaded = readReflections(runsDir, run.id, { level: 'run' });
    expect(loaded).toEqual([]);
  });

  it('accumulates multiple reflections', () => {
    const runsDir = tempRunsDir();
    const run = makeRun();
    createRunTree(runsDir, run);
    const target: ObservationTarget = { level: 'stage', category: 'build' };

    appendReflection(runsDir, run.id, makeReflection(), target);
    appendReflection(runsDir, run.id, makeReflection(), target);

    const loaded = readReflections(runsDir, run.id, target);
    expect(loaded).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// readAllObservationsForRun — aggregation across all levels
// ---------------------------------------------------------------------------

describe('readAllObservationsForRun', () => {
  it('collects run-level, stage-level, flavor-level, and step-level observations', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['research', 'build'] });
    createRunTree(runsDir, run);

    const runObs = makeObservation({ content: 'run-level', timestamp: '2026-01-01T01:00:00.000Z' });
    const stageObs = makeObservation({ content: 'stage-level', timestamp: '2026-01-01T02:00:00.000Z' });
    const flavorObs = makeObservation({ content: 'flavor-level', timestamp: '2026-01-01T03:00:00.000Z' });
    const stepObs = makeObservation({ content: 'step-level', timestamp: '2026-01-01T04:00:00.000Z' });

    appendObservation(runsDir, run.id, runObs, { level: 'run' });
    appendObservation(runsDir, run.id, stageObs, { level: 'stage', category: 'build' });
    appendObservation(runsDir, run.id, flavorObs, { level: 'flavor', category: 'build', flavor: 'tdd' });
    appendObservation(runsDir, run.id, stepObs, { level: 'step', category: 'build', flavor: 'tdd', step: 'write-tests' });

    const all = readAllObservationsForRun(runsDir, run.id, run.stageSequence);
    expect(all).toHaveLength(4);
    const contents = all.map((o) => o.content);
    expect(contents).toContain('run-level');
    expect(contents).toContain('stage-level');
    expect(contents).toContain('flavor-level');
    expect(contents).toContain('step-level');
  });

  it('returns observations sorted by timestamp ascending', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['build'] });
    createRunTree(runsDir, run);

    // Write in reverse order to confirm sorting
    const laterObs = makeObservation({ content: 'later', timestamp: '2026-01-01T05:00:00.000Z' });
    const earlierObs = makeObservation({ content: 'earlier', timestamp: '2026-01-01T01:00:00.000Z' });
    const middleObs = makeObservation({ content: 'middle', timestamp: '2026-01-01T03:00:00.000Z' });

    appendObservation(runsDir, run.id, laterObs, { level: 'run' });
    appendObservation(runsDir, run.id, earlierObs, { level: 'stage', category: 'build' });
    appendObservation(runsDir, run.id, middleObs, { level: 'flavor', category: 'build', flavor: 'core' });

    const all = readAllObservationsForRun(runsDir, run.id, run.stageSequence);
    expect(all[0].content).toBe('earlier');
    expect(all[1].content).toBe('middle');
    expect(all[2].content).toBe('later');
  });

  it('returns empty array when no observations exist at any level', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['research', 'build'] });
    createRunTree(runsDir, run);

    const all = readAllObservationsForRun(runsDir, run.id, run.stageSequence);
    expect(all).toEqual([]);
  });

  it('handles runs with no stage sequence gracefully', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['research'] });
    createRunTree(runsDir, run);

    const runObs = makeObservation({ content: 'only run-level' });
    appendObservation(runsDir, run.id, runObs, { level: 'run' });

    // Pass empty stageSequence — only run-level observations should be returned
    const all = readAllObservationsForRun(runsDir, run.id, []);
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('only run-level');
  });

  it('aggregates observations across multiple stages', () => {
    const runsDir = tempRunsDir();
    const run = makeRun({ stageSequence: ['research', 'build'] });
    createRunTree(runsDir, run);

    const researchObs = makeObservation({ content: 'research stage', timestamp: '2026-01-01T01:00:00.000Z' });
    const buildObs = makeObservation({ content: 'build stage', timestamp: '2026-01-01T02:00:00.000Z' });

    appendObservation(runsDir, run.id, researchObs, { level: 'stage', category: 'research' });
    appendObservation(runsDir, run.id, buildObs, { level: 'stage', category: 'build' });

    const all = readAllObservationsForRun(runsDir, run.id, run.stageSequence);
    expect(all).toHaveLength(2);
    expect(all.map((o) => o.content)).toContain('research stage');
    expect(all.map((o) => o.content)).toContain('build stage');
  });
});
