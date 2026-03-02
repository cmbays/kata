import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import {
  readRun,
  readStageState,
  readFlavorState,
  runPaths,
} from '@infra/persistence/run-store.js';
import {
  ArtifactIndexEntrySchema,
  DecisionEntrySchema,
  DecisionOutcomeEntrySchema,
  RunSchema,
  type Gap,
  type StageState,
  type Run,
  type DecisionEntry,
  type DecisionOutcomeEntry,
} from '@domain/types/run-state.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { CycleSchema } from '@domain/types/cycle.js';
import type { StageCategory } from '@domain/types/stage.js';

// ---------------------------------------------------------------------------
// Types for the aggregated run status payload
// ---------------------------------------------------------------------------

interface FlavorSummary {
  name: string;
  status: string;
  stepCount: number;
  completedSteps: number;
  currentStep: number | null;
  artifactCount: number;
}

interface StageSummary {
  category: StageCategory;
  status: string;
  executionMode: string | undefined;
  selectedFlavors: string[];
  gaps: Gap[];
  decisionCount: number;
  avgConfidence: number | null;
  artifactCount: number;
  flavors: FlavorSummary[];
  hasSynthesis: boolean;
}

interface RunStatus {
  run: Run;
  stages: StageSummary[];
  totalDecisions: number;
  totalArtifacts: number;
  decisions: Array<DecisionEntry & { latestOutcome: DecisionOutcomeEntry | undefined }>;
}

// ---------------------------------------------------------------------------
// Status aggregation
// ---------------------------------------------------------------------------

function aggregateRunStatus(runsDir: string, runId: string): RunStatus {
  const run = readRun(runsDir, runId);
  const paths = runPaths(runsDir, runId);

  const decisions = JsonlStore.readDecisionsWithOutcomes(
    paths.decisionsJsonl,
    paths.decisionOutcomesJsonl,
    DecisionEntrySchema,
    DecisionOutcomeEntrySchema,
  );

  const runArtifacts = JsonlStore.readAll(paths.artifactIndexJsonl, ArtifactIndexEntrySchema);

  const stages: StageSummary[] = [];

  for (const category of run.stageSequence) {
    let stageState: StageState;
    try {
      stageState = readStageState(runsDir, runId, category);
    } catch {
      // Stage may not have been initialized yet
      stageState = {
        category,
        status: 'pending',
        selectedFlavors: [],
        gaps: [],
        decisions: [],
        approvedGates: [],
      };
    }

    const stageDecisions = decisions.filter((d) => d.stageCategory === category);
    const stageArtifacts = runArtifacts.filter((a) => a.stageCategory === category);

    const avgConfidence =
      stageDecisions.length > 0
        ? stageDecisions.reduce((sum, d) => sum + d.confidence, 0) / stageDecisions.length
        : null;

    // Collect flavor summaries
    const flavors: FlavorSummary[] = [];
    for (const flavorName of stageState.selectedFlavors) {
      const flavorState = readFlavorState(runsDir, runId, category, flavorName, { allowMissing: true });

      const flavorArtifacts = stageArtifacts.filter((a) => a.flavor === flavorName);

      flavors.push({
        name: flavorName,
        status: flavorState?.status ?? 'pending',
        stepCount: flavorState?.steps.length ?? 0,
        completedSteps: flavorState?.steps.filter((s) => s.status === 'completed').length ?? 0,
        currentStep: flavorState?.currentStep ?? null,
        artifactCount: flavorArtifacts.length,
      });
    }

    const hasSynthesis = existsSync(paths.stageSynthesis(category)) ||
      stageState.synthesisArtifact !== undefined;

    stages.push({
      category,
      status: stageState.status,
      executionMode: stageState.executionMode,
      selectedFlavors: stageState.selectedFlavors,
      gaps: stageState.gaps,
      decisionCount: stageDecisions.length,
      avgConfidence,
      artifactCount: stageArtifacts.length,
      flavors,
      hasSynthesis,
    });
  }

  return {
    run,
    stages,
    totalDecisions: decisions.length,
    totalArtifacts: runArtifacts.length,
    decisions,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<string, string> = {
  pending: '○',
  running: '●',
  completed: '✓',
  failed: '✗',
  skipped: '–',
};

function formatRunStatus(status: RunStatus): string {
  const { run, stages } = status;
  const lines: string[] = [];

  const runIcon = STATUS_ICONS[run.status] ?? '?';
  lines.push(`${runIcon} Run: ${run.id}`);
  lines.push(`  Status:   ${run.status}`);
  lines.push(`  Bet:      ${run.betPrompt}`);
  if (run.kataPattern) lines.push(`  Pattern:  ${run.kataPattern}`);
  lines.push(`  Sequence: ${run.stageSequence.join(' → ')}`);
  if (run.currentStage) lines.push(`  Current:  ${run.currentStage}`);
  lines.push(`  Decisions: ${status.totalDecisions}   Artifacts: ${status.totalArtifacts}`);
  lines.push('');

  for (const stage of stages) {
    const icon = STATUS_ICONS[stage.status] ?? '?';
    const modeStr = stage.executionMode ? ` [${stage.executionMode}]` : '';
    lines.push(`${icon} ${stage.category.toUpperCase()}${modeStr}`);

    if (stage.selectedFlavors.length > 0) {
      for (const flavor of stage.flavors) {
        const fIcon = STATUS_ICONS[flavor.status] ?? '?';
        const progress = flavor.stepCount > 0 ? ` (${flavor.completedSteps}/${flavor.stepCount} steps)` : '';
        lines.push(`    ${fIcon} ${flavor.name}${progress} — ${flavor.artifactCount} artifact(s)`);
      }
    }

    if (stage.hasSynthesis) {
      lines.push(`    ✓ synthesis artifact`);
    }

    if (stage.gaps.length > 0) {
      for (const gap of stage.gaps) {
        lines.push(`    ⚠ gap [${gap.severity}]: ${gap.description}`);
      }
    }

    if (stage.decisionCount > 0) {
      const confStr = stage.avgConfidence !== null
        ? ` (avg confidence: ${stage.avgConfidence.toFixed(2)})`
        : '';
      lines.push(`    Decisions: ${stage.decisionCount}${confStr}`);
    }

    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Run list helpers
// ---------------------------------------------------------------------------

/** Scan all run directories and return valid Run objects, optionally filtered by cycleId. */
function listRuns(runsDir: string, cycleId?: string): Run[] {
  if (!existsSync(runsDir)) return [];

  let runDirs: string[];
  try {
    runDirs = readdirSync(runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }

  const runs: Run[] = [];
  for (const dirName of runDirs) {
    const runJsonPath = join(runsDir, dirName, 'run.json');
    if (!existsSync(runJsonPath)) continue;
    try {
      const run = JsonStore.read(runJsonPath, RunSchema);
      if (!cycleId || run.cycleId === cycleId) {
        runs.push(run);
      }
    } catch {
      // Skip invalid/corrupt run files
    }
  }

  // Sort by startedAt descending (most recent first)
  runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return runs;
}

interface RunListEntry {
  id: string;
  shortId: string;
  cycleId: string;
  betId: string;
  betPrompt: string;
  status: string;
  currentStage: StageCategory | null;
  stageSequence: StageCategory[];
  startedAt: string;
  completedAt?: string;
  kataPattern?: string;
  durationMs?: number;
}

function buildRunListEntry(run: Run): RunListEntry {
  const durationMs = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : undefined;
  return {
    id: run.id,
    shortId: run.id.slice(0, 8),
    cycleId: run.cycleId,
    betId: run.betId,
    betPrompt: run.betPrompt,
    status: run.status,
    currentStage: run.currentStage,
    stageSequence: run.stageSequence,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    kataPattern: run.kataPattern,
    durationMs,
  };
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

function formatRunList(entries: RunListEntry[], cycleLabel?: string): string {
  const lines: string[] = [];

  if (cycleLabel) {
    lines.push(`Runs for cycle: ${cycleLabel}`);
  }
  lines.push(`${entries.length} run(s) found`);
  lines.push('');

  for (const entry of entries) {
    const icon = STATUS_ICONS[entry.status] ?? '?';
    lines.push(`${icon} ${entry.shortId}  ${entry.status.padEnd(10)}  ${entry.betPrompt}`);
    lines.push(`    id:       ${entry.id}`);
    lines.push(`    bet:      ${entry.betId}`);
    lines.push(`    sequence: ${entry.stageSequence.join(' → ')}`);
    if (entry.currentStage) lines.push(`    current:  ${entry.currentStage}`);
    if (entry.kataPattern) lines.push(`    pattern:  ${entry.kataPattern}`);
    lines.push(`    started:  ${entry.startedAt}`);
    if (entry.completedAt) lines.push(`    finished: ${entry.completedAt}`);
    if (entry.durationMs !== undefined) {
      lines.push(`    duration: ${formatDuration(entry.durationMs)}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

export function registerRunCommands(parent: Command): void {
  const run = parent
    .command('run')
    .description('Inspect kata run state');

  // kata run list
  run
    .command('list')
    .description('List runs for a cycle')
    .option('--cycle <id>', 'Cycle ID or reference (default: latest cycle)')
    .action(withCommandContext((ctx) => {
      const localOpts = ctx.cmd.opts();
      const runsDir = kataDirPath(ctx.kataDir, 'runs');
      const cyclesDir = kataDirPath(ctx.kataDir, 'cycles');

      // Resolve cycle ID
      let resolvedCycleId: string | undefined;
      let cycleLabel: string | undefined;

      if (localOpts.cycle) {
        // Resolve the provided cycle reference
        const manager = new CycleManager(cyclesDir, JsonStore);
        const cycles = manager.list();
        // Try exact match first, then latest
        const found = cycles.find((c) => c.id === localOpts.cycle)
          ?? cycles.find((c) => c.id.startsWith(localOpts.cycle))
          ?? cycles.find((c) => c.name?.toLowerCase() === (localOpts.cycle as string).toLowerCase());
        if (!found) {
          console.error(`Error: cycle not found: "${localOpts.cycle as string}"`);
          process.exitCode = 1;
          return;
        }
        resolvedCycleId = found.id;
        cycleLabel = found.name ? `${found.name} (${found.id.slice(0, 8)})` : found.id.slice(0, 8);
      } else {
        // Default: latest cycle by createdAt
        const allCycles = JsonStore.list(cyclesDir, CycleSchema);
        if (allCycles.length > 0) {
          const sorted = allCycles.sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          );
          const latest = sorted[0]!;
          resolvedCycleId = latest.id;
          cycleLabel = latest.name ? `${latest.name} (${latest.id.slice(0, 8)})` : latest.id.slice(0, 8);
        }
      }

      const runs = listRuns(runsDir, resolvedCycleId);
      const entries = runs.map(buildRunListEntry);

      if (ctx.globalOpts.json) {
        console.log(JSON.stringify(entries, null, 2));
        return;
      }

      if (entries.length === 0) {
        const label = cycleLabel ? ` for cycle ${cycleLabel}` : '';
        console.log(`No runs found${label}.`);
        return;
      }

      console.log(formatRunList(entries, cycleLabel));
    }));

  // kata run status <run-id>
  run
    .command('status <run-id>')
    .description('Show the status of a run (human-readable or --json)')
    .action(withCommandContext((ctx, runId: string) => {
      const runsDir = kataDirPath(ctx.kataDir, 'runs');

      const status = aggregateRunStatus(runsDir, runId);

      if (ctx.globalOpts.json) {
        // JSON output: include full decision list for agent consumption
        const payload = {
          run: status.run,
          stages: status.stages,
          totalDecisions: status.totalDecisions,
          totalArtifacts: status.totalArtifacts,
          decisions: status.decisions.map((d) => ({
            ...d,
            outcome: d.latestOutcome,
          })),
        };
        console.log(JSON.stringify(payload, null, 2));
      } else {
        console.log(formatRunStatus(status));
      }
    }));
}
