import { join } from 'node:path';
import { mkdirSync, readdirSync, existsSync } from 'node:fs';
import { JsonStore } from './json-store.js';
import { JsonlStore } from './jsonl-store.js';
import {
  RunSchema,
  StageStateSchema,
  FlavorStateSchema,
  DecisionEntrySchema,
  ArtifactIndexEntrySchema,
  type Run,
  type StageState,
  type FlavorState,
  type DecisionEntry,
  type ArtifactIndexEntry,
} from '@domain/types/run-state.js';
import { ObservationSchema, type Observation } from '@domain/types/observation.js';
import { ReflectionSchema, type Reflection } from '@domain/types/reflection.js';
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
 *     observations.jsonl          (Wave F — run-level cross-stage observations)
 *     reflections.jsonl           (Wave F — run-level detection engine output)
 *     stages/
 *       <category>/
 *         state.json
 *         observations.jsonl      (Wave F — stage-level observations)
 *         reflections.jsonl       (Wave F — stage-level reflections)
 *         flavors/
 *           <flavor-name>/
 *             state.json
 *             artifact-index.jsonl
 *             observations.jsonl  (Wave F — flavor-level observations)
 *             reflections.jsonl   (Wave F — flavor-level reflections)
 *             steps/
 *               <step-name>/
 *                 observations.jsonl  (Wave F — step-level granular observations)
 *                 reflections.jsonl   (Wave F — step-level reflections)
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
    /** Wave F — run-level observations (cross-stage signals) */
    observationsJsonl: join(runDir, 'observations.jsonl'),
    /** Wave F — run-level reflections (detection engine output) */
    reflectionsJsonl: join(runDir, 'reflections.jsonl'),
    stagesDir: join(runDir, 'stages'),
    stageDir: (category: StageCategory) => join(runDir, 'stages', category),
    stateJson: (category: StageCategory) => join(runDir, 'stages', category, 'state.json'),
    /** Wave F — stage-level observations */
    stageObservationsJsonl: (category: StageCategory) =>
      join(runDir, 'stages', category, 'observations.jsonl'),
    /** Wave F — stage-level reflections */
    stageReflectionsJsonl: (category: StageCategory) =>
      join(runDir, 'stages', category, 'reflections.jsonl'),
    flavorsDir: (category: StageCategory) => join(runDir, 'stages', category, 'flavors'),
    flavorDir: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor),
    flavorStateJson: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'state.json'),
    flavorArtifactIndexJsonl: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'artifact-index.jsonl'),
    /** Wave F — flavor-level observations */
    flavorObservationsJsonl: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'observations.jsonl'),
    /** Wave F — flavor-level reflections */
    flavorReflectionsJsonl: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'reflections.jsonl'),
    /** Wave F — step-level observation directory */
    stepsDir: (category: StageCategory, flavor: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'steps'),
    /** Wave F — step-level observations */
    stepObservationsJsonl: (category: StageCategory, flavor: string, step: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'steps', step, 'observations.jsonl'),
    /** Wave F — step-level reflections */
    stepReflectionsJsonl: (category: StageCategory, flavor: string, step: string) =>
      join(runDir, 'stages', category, 'flavors', flavor, 'steps', step, 'reflections.jsonl'),
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
 *
 * **What is created:**
 * - `<runsDir>/<run.id>/` — run root directory
 * - `<runsDir>/<run.id>/run.json` — serialized Run object
 * - `<runsDir>/<run.id>/stages/<category>/` — one directory per stageSequence entry
 * - `<runsDir>/<run.id>/stages/<category>/state.json` — initial StageState (status: pending)
 *
 * **What is NOT created:**
 * - `decisions.jsonl`, `decision-outcomes.jsonl`, `artifact-index.jsonl` — written on first append
 * - `stages/<category>/flavors/` — created by `writeFlavorState` when a flavor is selected
 * - `stages/<category>/synthesis.md` — written by the synthesis phase
 *
 * This function is **idempotent when called with a unique run.id** — re-calling
 * it with the same run will overwrite `run.json` and each `state.json` with the
 * same values, producing no observable difference.
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
      approvedGates: [],
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
  { allowMissing }: { allowMissing?: boolean } = {},
): FlavorState | undefined {
  const path = runPaths(runsDir, runId).flavorStateJson(category, flavorName);
  if (allowMissing && !JsonStore.exists(path)) return undefined;
  return JsonStore.read(path, FlavorStateSchema);
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

// ---------------------------------------------------------------------------
// Convenience append helpers
// ---------------------------------------------------------------------------

/** Append a decision entry to the run's decisions.jsonl. */
export function appendDecision(runsDir: string, runId: string, entry: DecisionEntry): void {
  JsonlStore.append(runPaths(runsDir, runId).decisionsJsonl, entry, DecisionEntrySchema);
}

/** Append an artifact index entry to the run's artifact-index.jsonl. */
export function appendArtifact(runsDir: string, runId: string, entry: ArtifactIndexEntry): void {
  JsonlStore.append(runPaths(runsDir, runId).artifactIndexJsonl, entry, ArtifactIndexEntrySchema);
}

// ---------------------------------------------------------------------------
// Wave F — Observation + Reflection append helpers
// ---------------------------------------------------------------------------

/**
 * Observation target — specifies where in the run tree to write the observation.
 *
 * - `{ level: 'run' }` — run-level (cross-stage signals)
 * - `{ level: 'stage', category }` — stage-level (gyo-wide patterns)
 * - `{ level: 'flavor', category, flavor }` — flavor-level (ryu-specific signals)
 * - `{ level: 'step', category, flavor, step }` — step-level (granular per-waza)
 */
export type ObservationTarget =
  | { level: 'run' }
  | { level: 'stage'; category: StageCategory }
  | { level: 'flavor'; category: StageCategory; flavor: string }
  | { level: 'step'; category: StageCategory; flavor: string; step: string };

/** Resolve the JSONL path for an observation target. */
function resolveObservationPath(paths: ReturnType<typeof runPaths>, target: ObservationTarget): string {
  switch (target.level) {
    case 'run':    return paths.observationsJsonl;
    case 'stage':  return paths.stageObservationsJsonl(target.category);
    case 'flavor': return paths.flavorObservationsJsonl(target.category, target.flavor);
    case 'step':   return paths.stepObservationsJsonl(target.category, target.flavor, target.step);
  }
}

/** Resolve the JSONL path for a reflection target. */
function resolveReflectionPath(paths: ReturnType<typeof runPaths>, target: ObservationTarget): string {
  switch (target.level) {
    case 'run':    return paths.reflectionsJsonl;
    case 'stage':  return paths.stageReflectionsJsonl(target.category);
    case 'flavor': return paths.flavorReflectionsJsonl(target.category, target.flavor);
    case 'step':   return paths.stepReflectionsJsonl(target.category, target.flavor, target.step);
  }
}

/**
 * Append a typed observation to the specified level of the run tree.
 * The JSONL file and its parent directories are created on first append.
 */
export function appendObservation(
  runsDir: string,
  runId: string,
  observation: Observation,
  target: ObservationTarget,
): void {
  const paths = runPaths(runsDir, runId);
  const path = resolveObservationPath(paths, target);
  JsonlStore.append(path, observation, ObservationSchema);
}

/**
 * Read all observations from the specified level of the run tree.
 * Returns an empty array if the file does not exist.
 */
export function readObservations(
  runsDir: string,
  runId: string,
  target: ObservationTarget,
): Observation[] {
  const paths = runPaths(runsDir, runId);
  const path = resolveObservationPath(paths, target);
  return JsonlStore.readAll(path, ObservationSchema);
}

/**
 * Append a typed reflection to the specified level of the run tree.
 * The JSONL file and its parent directories are created on first append.
 */
export function appendReflection(
  runsDir: string,
  runId: string,
  reflection: Reflection,
  target: ObservationTarget,
): void {
  const paths = runPaths(runsDir, runId);
  const path = resolveReflectionPath(paths, target);
  JsonlStore.append(path, reflection, ReflectionSchema);
}

/**
 * Read all reflections from the specified level of the run tree.
 * Returns an empty array if the file does not exist.
 */
export function readReflections(
  runsDir: string,
  runId: string,
  target: ObservationTarget,
): Reflection[] {
  const paths = runPaths(runsDir, runId);
  const path = resolveReflectionPath(paths, target);
  return JsonlStore.readAll(path, ReflectionSchema);
}

/**
 * Read ALL observations for a run, aggregated across every level of the run tree:
 *   - run level
 *   - each stage level
 *   - each flavor level (discovered from filesystem)
 *   - each step level (discovered from filesystem)
 *
 * The stageSequence from the run.json determines which stages to scan.
 * Flavors and steps are discovered by listing subdirectories.
 *
 * Returns observations sorted by timestamp ascending (oldest first).
 */
export function readAllObservationsForRun(
  runsDir: string,
  runId: string,
  stageSequence: StageCategory[],
): Observation[] {
  const paths = runPaths(runsDir, runId);
  const allObservations: Observation[] = [];

  // 1. Run-level observations
  allObservations.push(...JsonlStore.readAll(paths.observationsJsonl, ObservationSchema));

  // 2. Stage-level observations + nested flavor/step observations
  for (const category of stageSequence) {
    // Stage-level
    allObservations.push(
      ...JsonlStore.readAll(paths.stageObservationsJsonl(category), ObservationSchema),
    );

    // Discover flavors on disk
    const flavorsDir = paths.flavorsDir(category);
    if (!existsSync(flavorsDir)) continue;

    let flavorNames: string[];
    try {
      flavorNames = readdirSync(flavorsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);
    } catch {
      continue;
    }

    for (const flavorName of flavorNames) {
      // Flavor-level
      allObservations.push(
        ...JsonlStore.readAll(paths.flavorObservationsJsonl(category, flavorName), ObservationSchema),
      );

      // Discover steps on disk
      const stepsDir = paths.stepsDir(category, flavorName);
      if (!existsSync(stepsDir)) continue;

      let stepNames: string[];
      try {
        stepNames = readdirSync(stepsDir, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        continue;
      }

      for (const stepName of stepNames) {
        allObservations.push(
          ...JsonlStore.readAll(paths.stepObservationsJsonl(category, flavorName, stepName), ObservationSchema),
        );
      }
    }
  }

  // Sort by timestamp ascending
  allObservations.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return allObservations;
}

/**
 * Scan all run directories and return Run objects whose cycleId matches the given cycle ID.
 * Returns runs sorted by startedAt ascending (oldest first — chronological order for cross-run display).
 */
export function listRunsForCycle(runsDir: string, cycleId: string): Run[] {
  if (!existsSync(runsDir)) return [];

  let dirNames: string[];
  try {
    dirNames = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const runs: Run[] = [];
  for (const dirName of dirNames) {
    const runJsonPath = join(runsDir, dirName, 'run.json');
    if (!existsSync(runJsonPath)) continue;
    try {
      const run = JsonStore.read(runJsonPath, RunSchema);
      if (run.cycleId === cycleId) {
        runs.push(run);
      }
    } catch {
      // Skip invalid/corrupt run files
    }
  }

  // Sort by startedAt ascending (chronological — oldest run first)
  runs.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return runs;
}
