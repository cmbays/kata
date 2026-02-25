import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { JsonStore } from './json-store.js';
import {
  RunSchema,
  StageStateSchema,
  FlavorStateSchema,
  type Run,
  type StageState,
  type FlavorState,
} from '@domain/types/run-state.js';
import type { StageCategory } from '@domain/types/stage.js';

/**
 * Path helpers for the .kata/runs/ tree.
 *
 * Directory structure:
 *   .kata/runs/<run-id>/
 *     run.json
 *     decisions.jsonl
 *     decision-outcomes.jsonl
 *     artifact-index.jsonl
 *     stages/
 *       <category>/
 *         state.json
 *         flavors/
 *           <flavor-name>/
 *             state.json
 *             artifact-index.jsonl
 *             artifacts/
 *               <files>
 *             synthesis.md  (optional)
 */
export function runPaths(runsDir: string, runId: string) {
  const runDir = join(runsDir, runId);
  return {
    runDir,
    runJson: join(runDir, 'run.json'),
    decisionsJsonl: join(runDir, 'decisions.jsonl'),
    decisionOutcomesJsonl: join(runDir, 'decision-outcomes.jsonl'),
    artifactIndexJsonl: join(runDir, 'artifact-index.jsonl'),
    stagesDir: join(runDir, 'stages'),
    stageDir: (category: StageCategory) => join(runDir, 'stages', category),
    stateJson: (category: StageCategory) => join(runDir, 'stages', category, 'state.json'),
    flavorsDir: (category: StageCategory) => join(runDir, 'stages', category, 'flavors'),
    flavorDir: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor),
    flavorStateJson: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'state.json'),
    flavorArtifactIndexJsonl: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'artifact-index.jsonl'),
    flavorArtifactsDir: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'artifacts'),
    flavorSynthesis: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'synthesis.md'),
    stageSynthesis: (category: StageCategory) =>
      join(runDir, 'stages', category, 'synthesis.md'),
  };
}

/**
 * Create the full directory tree for a new run.
 * Creates run directory + per-stage directories + placeholder state files.
 */
export function createRunTree(runsDir: string, run: Run): void {
  const paths = runPaths(runsDir, run.id);

  // Create top-level run directory
  mkdirSync(paths.runDir, { recursive: true });

  // Write run.json
  JsonStore.write(paths.runJson, run, RunSchema);

  // Create stage directories + initial state files
  for (const category of run.stageSequence) {
    mkdirSync(paths.stageDir(category), { recursive: true });

    const stageState: StageState = {
      category,
      status: 'pending',
      selectedFlavors: [],
      gaps: [],
      decisions: [],
    };
    JsonStore.write(paths.stateJson(category), stageState, StageStateSchema);
  }
}

// ---------------------------------------------------------------------------
// Run CRUD
// ---------------------------------------------------------------------------

export function readRun(runsDir: string, runId: string): Run {
  return JsonStore.read(runPaths(runsDir, runId).runJson, RunSchema);
}

export function writeRun(runsDir: string, run: Run): void {
  JsonStore.write(runPaths(runsDir, run.id).runJson, run, RunSchema);
}

// ---------------------------------------------------------------------------
// Stage state CRUD
// ---------------------------------------------------------------------------

export function readStageState(runsDir: string, runId: string, category: StageCategory): StageState {
  return JsonStore.read(runPaths(runsDir, runId).stateJson(category), StageStateSchema);
}

export function writeStageState(runsDir: string, runId: string, state: StageState): void {
  JsonStore.write(runPaths(runsDir, runId).stateJson(state.category), state, StageStateSchema);
}

// ---------------------------------------------------------------------------
// Flavor state CRUD
// ---------------------------------------------------------------------------

export function readFlavorState(
  runsDir: string,
  runId: string,
  category: StageCategory,
  flavorName: string,
): FlavorState {
  return JsonStore.read(
    runPaths(runsDir, runId).flavorStateJson(category, flavorName),
    FlavorStateSchema,
  );
}

export function writeFlavorState(
  runsDir: string,
  runId: string,
  category: StageCategory,
  state: FlavorState,
): void {
  const flavorDir = runPaths(runsDir, runId).flavorDir(category, state.name);
  mkdirSync(flavorDir, { recursive: true });
  JsonStore.write(
    runPaths(runsDir, runId).flavorStateJson(category, state.name),
    state,
    FlavorStateSchema,
  );
}
