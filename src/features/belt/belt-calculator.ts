import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonStore } from '@infra/persistence/json-store.js';
import { CycleSchema } from '@domain/types/cycle.js';
import { LearningSchema } from '@domain/types/learning.js';
import {
  type BeltLevel,
  type BeltDiscovery,
  type BeltSnapshot,
  type ProjectState,
  ProjectStateSchema,
  computeBelt,
} from '@domain/types/belt.js';

export type { BeltSnapshot };

// ---------------------------------------------------------------------------
// BeltComputeResult — return type from computeAndStore()
// ---------------------------------------------------------------------------

export interface BeltComputeResult {
  belt: BeltLevel;
  leveledUp: boolean;
  previous: BeltLevel;
  snapshot: BeltSnapshot;
}

// ---------------------------------------------------------------------------
// Belt level ordering (low → high)
// ---------------------------------------------------------------------------

const BELT_ORDER: readonly BeltLevel[] = [
  'mukyu', 'go-kyu', 'yon-kyu', 'san-kyu', 'ni-kyu', 'ik-kyu', 'shodan',
] as const;

// ---------------------------------------------------------------------------
// BeltCalculator — reads project data, builds BeltSnapshot, stores result
// ---------------------------------------------------------------------------

export class BeltCalculator {
  constructor(private readonly deps: {
    cyclesDir: string;
    knowledgeDir: string;
    runsDir?: string;
    flavorsDir?: string;
    decisionsDir?: string;
    savedKataDir?: string;
    synthesisDir?: string;
    dojoSessionsDir?: string;
  }) {}

  computeSnapshot(): BeltSnapshot {
    const cycles = this.readCycles();
    const learnings = this.readLearnings();
    const runMetrics = this.readRunMetrics();
    const flavorsTotal = this.countJsonFiles(this.deps.flavorsDir);
    const decisionOutcomePairs = this.countDecisionOutcomes();
    const katasSaved = this.countJsonFiles(this.deps.savedKataDir);
    const dojoSessionsGenerated = this.countJsonFiles(this.deps.dojoSessionsDir);
    const { synthesisApplied, methodologyRecommendationsApplied } = this.readSynthesisMetrics();

    const cyclesCompleted = cycles.filter((c) => c.state === 'complete').length;
    const betsCompleted = cycles.flatMap((c) => c.bets).filter((b) => b.outcome !== 'pending').length;

    const activeLearnings = learnings.filter((l) => !l.archived);
    const learningsTotal = activeLearnings.length;
    const strategicLearnings = activeLearnings.filter((l) => l.permanence === 'strategic').length;
    const constitutionalLearnings = activeLearnings.filter((l) => l.permanence === 'constitutional').length;
    const userCreatedConstitutional = activeLearnings.filter(
      (l) => l.permanence === 'constitutional' && l.source === 'user',
    ).length;
    const learningVersionCount = activeLearnings.filter((l) => l.versions.length >= 2).length;

    const strategicWithCitations = activeLearnings.filter(
      (l) => l.permanence === 'strategic' && l.citations.length > 0,
    );
    const avgCitationsPerStrategic = strategicWithCitations.length > 0
      ? strategicWithCitations.reduce((sum, l) => sum + l.citations.length, 0) / strategicLearnings
      : 0;

    // Domain categories from bets with domainTags
    const domainCategories = new Set<string>();
    for (const cycle of cycles) {
      for (const bet of cycle.bets) {
        if (bet.domainTags?.domain) domainCategories.add(bet.domainTags.domain);
      }
    }

    return {
      cyclesCompleted,
      betsCompleted,
      learningsTotal,
      strategicLearnings,
      constitutionalLearnings,
      userCreatedConstitutional,
      learningVersionCount,
      avgCitationsPerStrategic,
      predictionOutcomePairs: runMetrics.predictionOutcomePairs,
      frictionObservations: runMetrics.frictionObservations,
      frictionResolutionRate: runMetrics.frictionResolutionRate,
      gapsIdentified: runMetrics.gapsIdentified,
      calibrationAccuracy: runMetrics.calibrationAccuracy,
      synthesisApplied,
      gapsClosed: 0, // Populated from ProjectState in computeAndStore
      ranWithYolo: false, // Populated from ProjectState in computeAndStore
      discovery: {
        ranFirstExecution: false,
        completedFirstCycleCooldown: false,
        savedKataSequence: false,
        createdCustomStepOrFlavor: false,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
      flavorsTotal,
      decisionOutcomePairs,
      katasSaved,
      dojoSessionsGenerated,
      domainCategoryCount: domainCategories.size,
      crossCyclePatternsActive: synthesisApplied > 0,
      methodologyRecommendationsApplied,
    };
  }

  computeAndStore(
    projectStateFile: string,
    projectState: ProjectState,
  ): BeltComputeResult {
    const snapshot = this.computeSnapshot();

    // Overlay persisted state fields onto snapshot
    snapshot.gapsClosed = projectState.gapsClosedCount;
    snapshot.ranWithYolo = projectState.ranWithYolo;
    snapshot.discovery = projectState.discovery;
    snapshot.synthesisApplied = Math.max(snapshot.synthesisApplied, projectState.synthesisAppliedCount);

    const computed = computeBelt(snapshot);
    const previous = projectState.currentBelt;
    const previousIdx = BELT_ORDER.indexOf(previous);
    const computedIdx = BELT_ORDER.indexOf(computed);

    const winner = computedIdx > previousIdx ? computed : previous;
    const leveledUp = winner !== previous;

    const newState: ProjectState = {
      ...projectState,
      currentBelt: winner,
      ...(leveledUp ? { earnedAt: new Date().toISOString() } : {}),
      checkHistory: [
        ...projectState.checkHistory,
        {
          checkedAt: new Date().toISOString(),
          computedLevel: computed,
          cyclesCompleted: snapshot.cyclesCompleted,
          learningsTotal: snapshot.learningsTotal,
          synthesisApplied: snapshot.synthesisApplied,
        },
      ],
    };
    JsonStore.write(projectStateFile, newState, ProjectStateSchema);

    return { belt: winner, leveledUp, previous, snapshot };
  }

  // ---- Private readers ----

  private readCycles(): import('@domain/types/cycle.js').Cycle[] {
    if (!existsSync(this.deps.cyclesDir)) return [];
    return JsonStore.list(this.deps.cyclesDir, CycleSchema);
  }

  private readLearnings(): import('@domain/types/learning.js').Learning[] {
    if (!existsSync(this.deps.knowledgeDir)) return [];
    return JsonStore.list(this.deps.knowledgeDir, LearningSchema);
  }

  private readRunMetrics(): {
    predictionOutcomePairs: number;
    frictionObservations: number;
    frictionResolutionRate: number;
    gapsIdentified: number;
    calibrationAccuracy: number;
  } {
    const defaults = {
      predictionOutcomePairs: 0,
      frictionObservations: 0,
      frictionResolutionRate: 0,
      gapsIdentified: 0,
      calibrationAccuracy: 0,
    };

    if (!this.deps.runsDir || !existsSync(this.deps.runsDir)) return defaults;

    let predictionValidations = 0;
    let frictionObs = 0;
    let frictionResolutions = 0;
    let gapObs = 0;
    let calibrationCorrect = 0;
    let calibrationTotal = 0;

    try {
      const runDirs = readdirSync(this.deps.runsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const runId of runDirs) {
        const obsPath = join(this.deps.runsDir, runId, 'observations.jsonl');
        const refPath = join(this.deps.runsDir, runId, 'reflections.jsonl');

        // Read observations
        if (existsSync(obsPath)) {
          const lines = readLines(obsPath);
          for (const line of lines) {
            try {
              const obs = JSON.parse(line);
              if (obs.type === 'friction') frictionObs++;
              if (obs.type === 'gap') gapObs++;
            } catch { /* skip malformed lines */ }
          }
        }

        // Read reflections
        if (existsSync(refPath)) {
          const lines = readLines(refPath);
          for (const line of lines) {
            try {
              const ref = JSON.parse(line);
              if (ref.type === 'validation') predictionValidations++;
              if (ref.type === 'resolution') frictionResolutions++;
              if (ref.type === 'calibration') {
                calibrationTotal++;
                if (ref.accurate) calibrationCorrect++;
              }
            } catch { /* skip malformed lines */ }
          }
        }
      }
    } catch { /* graceful degradation */ }

    return {
      predictionOutcomePairs: predictionValidations,
      frictionObservations: frictionObs,
      frictionResolutionRate: frictionObs > 0 ? frictionResolutions / frictionObs : 0,
      gapsIdentified: gapObs,
      calibrationAccuracy: calibrationTotal > 0 ? calibrationCorrect / calibrationTotal : 0,
    };
  }

  private readSynthesisMetrics(): { synthesisApplied: number; methodologyRecommendationsApplied: number } {
    if (!this.deps.synthesisDir || !existsSync(this.deps.synthesisDir)) {
      return { synthesisApplied: 0, methodologyRecommendationsApplied: 0 };
    }

    let synthesisApplied = 0;
    let methodologyRecs = 0;

    try {
      const files = readdirSync(this.deps.synthesisDir).filter(
        (f) => f.startsWith('result-') && f.endsWith('.json'),
      );
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.deps.synthesisDir, file), 'utf-8');
          const result = JSON.parse(raw);
          if (Array.isArray(result.proposals)) {
            synthesisApplied += result.proposals.length;
            methodologyRecs += result.proposals.filter(
              (p: { type: string }) => p.type === 'methodology-recommendation',
            ).length;
          }
        } catch { /* skip unreadable result files */ }
      }
    } catch { /* graceful degradation */ }

    return { synthesisApplied, methodologyRecommendationsApplied: methodologyRecs };
  }

  private countDecisionOutcomes(): number {
    if (!this.deps.decisionsDir || !existsSync(this.deps.decisionsDir)) return 0;
    // Count decisions that have an outcome recorded
    try {
      const files = readdirSync(this.deps.decisionsDir).filter((f) => f.endsWith('.json'));
      let count = 0;
      for (const file of files) {
        try {
          const raw = readFileSync(join(this.deps.decisionsDir, file), 'utf-8');
          const decision = JSON.parse(raw);
          if (decision.outcome) count++;
        } catch { /* skip */ }
      }
      return count;
    } catch { return 0; }
  }

  private countJsonFiles(dir?: string): number {
    if (!dir || !existsSync(dir)) return 0;
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.json')).length;
    } catch { return 0; }
  }
}

// ---------------------------------------------------------------------------
// ProjectStateUpdater — fire-and-forget helpers for marking discoveries
// ---------------------------------------------------------------------------

export class ProjectStateUpdater {
  static markDiscovery(projectStateFile: string, flag: keyof BeltDiscovery): void {
    try {
      const state = loadProjectState(projectStateFile);
      if (state.discovery[flag]) return; // Already set
      state.discovery[flag] = true;
      JsonStore.write(projectStateFile, state, ProjectStateSchema);
    } catch { /* fire-and-forget */ }
  }

  static incrementSynthesisApplied(projectStateFile: string, count: number): void {
    try {
      const state = loadProjectState(projectStateFile);
      state.synthesisAppliedCount += count;
      JsonStore.write(projectStateFile, state, ProjectStateSchema);
    } catch { /* fire-and-forget */ }
  }

  static incrementGapsClosed(projectStateFile: string, count: number): void {
    try {
      const state = loadProjectState(projectStateFile);
      state.gapsClosedCount += count;
      JsonStore.write(projectStateFile, state, ProjectStateSchema);
    } catch { /* fire-and-forget */ }
  }

  static markRanWithYolo(projectStateFile: string): void {
    try {
      const state = loadProjectState(projectStateFile);
      if (state.ranWithYolo) return; // Already set
      state.ranWithYolo = true;
      JsonStore.write(projectStateFile, state, ProjectStateSchema);
    } catch { /* fire-and-forget */ }
  }
}

// ---------------------------------------------------------------------------
// loadProjectState — create default if missing
// ---------------------------------------------------------------------------

export function loadProjectState(projectStateFile: string): ProjectState {
  if (!existsSync(projectStateFile)) {
    return ProjectStateSchema.parse({});
  }
  return JsonStore.read(projectStateFile, ProjectStateSchema);
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

function readLines(filePath: string): string[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return content.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return [];
  }
}
