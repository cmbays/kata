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
  runPaths,
} from './run-store.js';
import {
  DecisionEntrySchema,
  ArtifactIndexEntrySchema,
  type DecisionEntry,
  type ArtifactIndexEntry,
} from '@domain/types/run-state.js';
import { JsonlStore } from './jsonl-store.js';
import type { Run } from '@domain/types/run-state.js';

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
