import { existsSync } from 'node:fs';
import type { Command } from 'commander';
import { withCommandContext, kataDirPath } from '@cli/utils.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
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
  type Gap,
  type StageState,
  type Run,
  type DecisionEntry,
  type DecisionOutcomeEntry,
} from '@domain/types/run-state.js';
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
// Command registration
// ---------------------------------------------------------------------------

export function registerRunCommands(parent: Command): void {
  const run = parent
    .command('run')
    .description('Inspect kata run state');

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
