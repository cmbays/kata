import type { Pipeline } from '@domain/types/pipeline.js';
import type { PipelineResult } from '@features/pipeline-run/pipeline-runner.js';
import { getLexicon, cap } from '@cli/lexicon.js';

const STATE_ICONS: Record<string, string> = {
  pending: '  ',
  active: '> ',
  complete: '+ ',
  skipped: '- ',
  failed: 'x ',
};

const PIPELINE_STATE_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  complete: 'Complete',
  abandoned: 'Abandoned',
};

/**
 * Format a single pipeline's status with stage breakdown.
 */
export function formatPipelineStatus(pipeline: Pipeline, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);
  const completedCount = pipeline.stages.filter(
    (s) => s.state === 'complete' || s.state === 'skipped',
  ).length;
  const pct = pipeline.stages.length > 0
    ? Math.round((completedCount / pipeline.stages.length) * 100)
    : 0;

  lines.push(`Flow: ${pipeline.name} (${pipeline.id})`);
  lines.push(`Type: ${pipeline.type}`);
  lines.push(`State: ${PIPELINE_STATE_LABELS[pipeline.state] ?? pipeline.state}`);
  lines.push(`Progress: ${completedCount}/${pipeline.stages.length} ${lex.stage}s (${pct}%)`);
  lines.push('');
  lines.push(`${cap(lex.stage)}s:`);

  for (let i = 0; i < pipeline.stages.length; i++) {
    const stage = pipeline.stages[i];
    if (!stage) continue;
    const icon = STATE_ICONS[stage.state] ?? '  ';
    const flavor = stage.stageRef.flavor ? `:${stage.stageRef.flavor}` : '';
    const current = i === pipeline.currentStageIndex && pipeline.state === 'active' ? ' <--' : '';
    lines.push(`  ${icon}${i + 1}. ${stage.stageRef.type}${flavor} [${stage.state}]${current}`);
  }

  if (pipeline.metadata.cycleId) {
    lines.push('');
    lines.push(`${cap(lex.cycle)}: ${pipeline.metadata.cycleId}`);
  }
  if (pipeline.metadata.betId) {
    lines.push(`Bet: ${pipeline.metadata.betId}`);
  }

  return lines.join('\n');
}

/**
 * Format a list of pipelines as a summary table.
 */
export function formatPipelineList(pipelines: Pipeline[]): string {
  if (pipelines.length === 0) {
    return 'No pipelines found.';
  }

  const lines: string[] = [];
  lines.push('Pipelines:');
  lines.push('');

  // Header
  const nameW = 20;
  const typeW = 12;
  const stateW = 12;
  const progressW = 12;

  lines.push(
    `${'Name'.padEnd(nameW)}${'Type'.padEnd(typeW)}${'State'.padEnd(stateW)}${'Progress'.padEnd(progressW)}ID`,
  );
  lines.push('-'.repeat(nameW + typeW + stateW + progressW + 36));

  for (const pipeline of pipelines) {
    const completedCount = pipeline.stages.filter(
      (s) => s.state === 'complete' || s.state === 'skipped',
    ).length;
    const progress = `${completedCount}/${pipeline.stages.length}`;
    const name = pipeline.name.length > nameW - 2
      ? pipeline.name.slice(0, nameW - 3) + '...'
      : pipeline.name;

    lines.push(
      `${name.padEnd(nameW)}${pipeline.type.padEnd(typeW)}${pipeline.state.padEnd(stateW)}${progress.padEnd(progressW)}${pipeline.id}`,
    );
  }

  return lines.join('\n');
}

/**
 * Format a pipeline run result summary.
 */
export function formatPipelineResult(result: PipelineResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(`Pipeline completed successfully!`);
  } else {
    lines.push(`Pipeline execution failed.`);
    if (result.abortedAt !== undefined) {
      lines.push(`Aborted at stage ${result.abortedAt + 1}.`);
    }
  }

  lines.push(`Stages completed: ${result.stagesCompleted}/${result.stagesTotal}`);

  if (result.historyIds.length > 0) {
    lines.push(`History entries: ${result.historyIds.length}`);
  }

  return lines.join('\n');
}

/**
 * Format a pipeline status as JSON.
 */
export function formatPipelineStatusJson(pipeline: Pipeline): string {
  const completedCount = pipeline.stages.filter(
    (s) => s.state === 'complete' || s.state === 'skipped',
  ).length;

  return JSON.stringify(
    {
      id: pipeline.id,
      name: pipeline.name,
      type: pipeline.type,
      state: pipeline.state,
      progress: {
        completed: completedCount,
        total: pipeline.stages.length,
        percent: pipeline.stages.length > 0
          ? Math.round((completedCount / pipeline.stages.length) * 100)
          : 0,
      },
      stages: pipeline.stages.map((s, i) => ({
        index: i,
        type: s.stageRef.type,
        flavor: s.stageRef.flavor,
        state: s.state,
      })),
      metadata: pipeline.metadata,
    },
    null,
    2,
  );
}

/**
 * Format a pipeline list as JSON.
 */
export function formatPipelineListJson(pipelines: Pipeline[]): string {
  return JSON.stringify(
    pipelines.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      state: p.state,
      stageCount: p.stages.length,
      completedStages: p.stages.filter(
        (s) => s.state === 'complete' || s.state === 'skipped',
      ).length,
    })),
    null,
    2,
  );
}

/**
 * Format a pipeline result as JSON.
 */
export function formatPipelineResultJson(result: PipelineResult): string {
  return JSON.stringify(result, null, 2);
}

