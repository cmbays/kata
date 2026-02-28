import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRunTree, writeStageState, runPaths } from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { DecisionEntrySchema, ArtifactIndexEntrySchema } from '@domain/types/run-state.js';
import type { Run, StageState } from '@domain/types/run-state.js';
import { loadRunSummary } from './run-summary-loader.js';

describe('loadRunSummary', () => {
  const baseDir = join(tmpdir(), `kata-run-summary-loader-test-${Date.now()}`);
  const runsDir = join(baseDir, 'runs');

  function makeRun(overrides: Partial<Run> = {}): Run {
    return {
      id: crypto.randomUUID(),
      cycleId: crypto.randomUUID(),
      betId: crypto.randomUUID(),
      betPrompt: 'Test bet',
      stageSequence: ['build'],
      currentStage: null,
      status: 'completed',
      startedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function makeStageState(category: 'build' | 'research' | 'review', overrides: Partial<StageState> = {}): StageState {
    return {
      category,
      status: 'completed',
      selectedFlavors: [],
      gaps: [],
      decisions: [],
      approvedGates: [],
      ...overrides,
    };
  }

  beforeEach(() => {
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns null when run file does not exist', () => {
    const result = loadRunSummary(runsDir, 'bet-1', 'nonexistent-run');
    expect(result).toBeNull();
  });

  it('loads a basic run summary with completed stage', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result).not.toBeNull();
    expect(result!.betId).toBe('bet-1');
    expect(result!.runId).toBe(run.id);
    expect(result!.stagesCompleted).toBe(1);
    expect(result!.gapCount).toBe(0);
    expect(result!.gapsBySeverity).toEqual({ low: 0, medium: 0, high: 0 });
    expect(result!.yoloDecisionCount).toBe(0);
  });

  it('counts gaps by severity correctly', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build', {
      gaps: [
        { description: 'Missing tests', severity: 'high' },
        { description: 'No docs', severity: 'medium' },
        { description: 'Minor style', severity: 'low' },
        { description: 'Another high', severity: 'high' },
      ],
    }));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.gapCount).toBe(4);
    expect(result!.gapsBySeverity).toEqual({ low: 1, medium: 1, high: 2 });
  });

  it('populates stageDetails with category, flavors, and gaps', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build', {
      selectedFlavors: ['tdd', 'pair-review'],
      gaps: [{ description: 'Coverage gap', severity: 'medium' }],
    }));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.stageDetails).toHaveLength(1);
    expect(result!.stageDetails[0]!.category).toBe('build');
    expect(result!.stageDetails[0]!.selectedFlavors).toEqual(['tdd', 'pair-review']);
    expect(result!.stageDetails[0]!.gaps).toHaveLength(1);
  });

  it('counts only completed stages', () => {
    const run = makeRun({ stageSequence: ['research', 'build'] });
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('research', { status: 'completed' }));
    writeStageState(runsDir, run.id, makeStageState('build', { status: 'running' }));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.stagesCompleted).toBe(1);
    expect(result!.stageDetails).toHaveLength(2);
  });

  it('skips unreadable stage states and continues', () => {
    const run = makeRun({ stageSequence: ['research', 'build'] });
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build', { status: 'completed' }));

    // Corrupt the research state file so it fails to parse
    const researchStatePath = runPaths(runsDir, run.id).stateJson('research');
    writeFileSync(researchStatePath, '{ invalid json !!!');

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result).not.toBeNull();
    // Only 'build' loaded successfully, 'research' skipped due to corrupt file
    expect(result!.stageDetails).toHaveLength(1);
    expect(result!.stageDetails[0]!.category).toBe('build');
    expect(result!.stagesCompleted).toBe(1);
  });

  it('returns null avgConfidence when no decisions recorded', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.avgConfidence).toBeNull();
  });

  it('computes avgConfidence from decisions', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const paths = runPaths(runsDir, run.id);
    const makeDecision = (confidence: number) => ({
      id: crypto.randomUUID(),
      stageCategory: 'build' as const,
      flavor: null,
      step: null,
      decisionType: 'flavor-selection',
      context: {},
      options: ['a', 'b'],
      selection: 'a',
      reasoning: 'test',
      confidence,
      decidedAt: new Date().toISOString(),
    });

    JsonlStore.append(paths.decisionsJsonl, makeDecision(0.8), DecisionEntrySchema);
    JsonlStore.append(paths.decisionsJsonl, makeDecision(0.6), DecisionEntrySchema);

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.avgConfidence).toBeCloseTo(0.7, 5);
  });

  it('counts yoloDecisionCount from lowConfidence decisions', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const paths = runPaths(runsDir, run.id);
    const makeDecision = (lowConfidence?: boolean) => ({
      id: crypto.randomUUID(),
      stageCategory: 'build' as const,
      flavor: null,
      step: null,
      decisionType: 'flavor-selection',
      context: {},
      options: ['a', 'b'],
      selection: 'a',
      reasoning: 'test',
      confidence: lowConfidence ? 0.3 : 0.9,
      decidedAt: new Date().toISOString(),
      ...(lowConfidence ? { lowConfidence: true } : {}),
    });

    JsonlStore.append(paths.decisionsJsonl, makeDecision(), DecisionEntrySchema);
    JsonlStore.append(paths.decisionsJsonl, makeDecision(true), DecisionEntrySchema);
    JsonlStore.append(paths.decisionsJsonl, makeDecision(true), DecisionEntrySchema);

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.yoloDecisionCount).toBe(2);
  });

  it('collects artifact paths from artifact index', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const paths = runPaths(runsDir, run.id);
    const makeArtifact = (filePath: string) => ({
      id: crypto.randomUUID(),
      stageCategory: 'build' as const,
      flavor: 'tdd',
      step: 'write-code',
      fileName: filePath.split('/').pop()!,
      filePath,
      summary: `Artifact at ${filePath}`,
      type: 'artifact' as const,
      recordedAt: new Date().toISOString(),
    });

    JsonlStore.append(paths.artifactIndexJsonl, makeArtifact('src/feature.ts'), ArtifactIndexEntrySchema);
    JsonlStore.append(paths.artifactIndexJsonl, makeArtifact('tests/feature.test.ts'), ArtifactIndexEntrySchema);

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.artifactPaths).toEqual(['src/feature.ts', 'tests/feature.test.ts']);
  });

  it('returns empty artifactPaths when no artifacts recorded', () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    writeStageState(runsDir, run.id, makeStageState('build'));

    const result = loadRunSummary(runsDir, 'bet-1', run.id);

    expect(result!.artifactPaths).toEqual([]);
  });
});
