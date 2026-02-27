import { randomUUID } from 'node:crypto';
import type { Pipeline } from '@domain/types/pipeline.js';
import type { PipelineResult } from '@features/pipeline-run/pipeline-runner.js';
import {
  formatPipelineStatus,
  formatPipelineList,
  formatPipelineResult,
  formatPipelineStatusJson,
  formatPipelineListJson,
  formatPipelineResultJson,
} from './pipeline-formatter.js';

function makePipeline(overrides?: Partial<Pipeline>): Pipeline {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    name: 'test-pipeline',
    type: 'vertical',
    stages: [
      { stageRef: { type: 'research' }, state: 'complete', artifacts: [] },
      { stageRef: { type: 'shape' }, state: 'active', artifacts: [] },
      { stageRef: { type: 'build' }, state: 'pending', artifacts: [] },
    ],
    state: 'active',
    currentStageIndex: 1,
    metadata: { issueRefs: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('formatPipelineStatus', () => {
  it('should display pipeline name and ID', () => {
    const pipeline = makePipeline({ name: 'my-feature' });
    const output = formatPipelineStatus(pipeline);

    expect(output).toContain('my-feature');
    expect(output).toContain(pipeline.id);
  });

  it('should display pipeline type and state', () => {
    const pipeline = makePipeline({ type: 'vertical', state: 'active' });
    const output = formatPipelineStatus(pipeline);

    expect(output).toContain('vertical');
    expect(output).toContain('Active');
  });

  it('should display stage progress (plain)', () => {
    const pipeline = makePipeline();
    const output = formatPipelineStatus(pipeline, true);

    expect(output).toContain('1/3 stages (33%)');
  });

  it('uses thematic stage label by default', () => {
    const pipeline = makePipeline();
    const output = formatPipelineStatus(pipeline);

    expect(output).toContain('1/3 gyo (33%)');
  });

  it('should list stages with state indicators', () => {
    const pipeline = makePipeline();
    const output = formatPipelineStatus(pipeline);

    expect(output).toContain('+ 1. research [complete]');
    expect(output).toContain('> 2. shape [active]');
    expect(output).toContain('  3. build [pending]');
  });

  it('should display cycle and bet metadata when present (plain)', () => {
    const cycleId = randomUUID();
    const betId = randomUUID();
    const pipeline = makePipeline({
      metadata: { issueRefs: [], cycleId, betId },
    });
    const output = formatPipelineStatus(pipeline, true);

    expect(output).toContain(`Cycle: ${cycleId}`);
    expect(output).toContain(`Bet: ${betId}`);
  });

  it('uses thematic cycle label by default', () => {
    const cycleId = randomUUID();
    const pipeline = makePipeline({
      metadata: { issueRefs: [], cycleId },
    });
    const output = formatPipelineStatus(pipeline);
    expect(output).toContain(`Keiko: ${cycleId}`);
  });

  it('should handle flavored stages', () => {
    const pipeline = makePipeline({
      stages: [
        { stageRef: { type: 'build', flavor: 'frontend' }, state: 'pending', artifacts: [] },
      ],
    });
    const output = formatPipelineStatus(pipeline);

    expect(output).toContain('build:frontend');
  });
});

describe('formatPipelineList', () => {
  it('should display "No pipelines found" when empty', () => {
    const output = formatPipelineList([]);
    expect(output).toBe('No pipelines found.');
  });

  it('should display a summary for each pipeline', () => {
    const p1 = makePipeline({ name: 'pipeline-a', type: 'vertical' });
    const p2 = makePipeline({ name: 'pipeline-b', type: 'bug-fix' });
    const output = formatPipelineList([p1, p2]);

    expect(output).toContain('pipeline-a');
    expect(output).toContain('pipeline-b');
    expect(output).toContain('vertical');
    expect(output).toContain('bug-fix');
  });

  it('should truncate long names', () => {
    const pipeline = makePipeline({ name: 'a-very-long-pipeline-name-here' });
    const output = formatPipelineList([pipeline]);

    expect(output).toContain('...');
  });
});

describe('formatPipelineResult', () => {
  it('should report success', () => {
    const result: PipelineResult = {
      pipelineId: randomUUID(),
      success: true,
      stagesCompleted: 3,
      stagesTotal: 3,
      historyIds: [randomUUID(), randomUUID(), randomUUID()],
    };
    const output = formatPipelineResult(result);

    expect(output).toContain('completed successfully');
    expect(output).toContain('3/3');
    expect(output).toContain('History entries: 3');
  });

  it('should report failure with abort location', () => {
    const result: PipelineResult = {
      pipelineId: randomUUID(),
      success: false,
      stagesCompleted: 1,
      stagesTotal: 3,
      historyIds: [randomUUID()],
      abortedAt: 1,
    };
    const output = formatPipelineResult(result);

    expect(output).toContain('failed');
    expect(output).toContain('Aborted at stage 2');
    expect(output).toContain('1/3');
  });
});

describe('JSON formatters', () => {
  it('formatPipelineStatusJson should return valid JSON', () => {
    const pipeline = makePipeline();
    const json = formatPipelineStatusJson(pipeline);
    const parsed = JSON.parse(json);

    expect(parsed.id).toBe(pipeline.id);
    expect(parsed.name).toBe(pipeline.name);
    expect(parsed.progress.completed).toBe(1);
    expect(parsed.progress.total).toBe(3);
    expect(parsed.stages).toHaveLength(3);
  });

  it('formatPipelineListJson should return valid JSON array', () => {
    const pipelines = [makePipeline(), makePipeline()];
    const json = formatPipelineListJson(pipelines);
    const parsed = JSON.parse(json);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('stageCount');
  });

  it('formatPipelineResultJson should return valid JSON', () => {
    const result: PipelineResult = {
      pipelineId: randomUUID(),
      success: true,
      stagesCompleted: 2,
      stagesTotal: 2,
      historyIds: [randomUUID()],
    };
    const json = formatPipelineResultJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.pipelineId).toBe(result.pipelineId);
    expect(parsed.success).toBe(true);
  });
});
