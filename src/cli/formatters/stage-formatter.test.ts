import type { Stage } from '@domain/types/stage.js';
import { formatStageTable, formatStageDetail, formatStageJson } from './stage-formatter.js';

const makeStage = (overrides: Partial<Stage> = {}): Stage => ({
  type: 'research',
  artifacts: [],
  learningHooks: [],
  config: {},
  ...overrides,
});

describe('formatStageTable', () => {
  it('returns "No forms found." for empty list', () => {
    expect(formatStageTable([])).toBe('No forms found.');
  });

  it('formats a single stage row', () => {
    const stages = [makeStage({ type: 'build', artifacts: [{ name: 'code', required: true }] })];
    const result = formatStageTable(stages);
    expect(result).toContain('Type');
    expect(result).toContain('build');
    expect(result).toContain('code');
  });

  it('shows flavor when present', () => {
    const stages = [makeStage({ type: 'build', flavor: 'fast' })];
    const result = formatStageTable(stages);
    expect(result).toContain('fast');
  });

  it('shows "-" for missing flavor', () => {
    const stages = [makeStage()];
    const lines = formatStageTable(stages).split('\n');
    const dataRow = lines[2]; // header, separator, data
    expect(dataRow).toContain('-');
  });

  it('summarizes gates', () => {
    const stages = [
      makeStage({
        entryGate: { type: 'entry', conditions: [{ type: 'predecessor-complete' }], required: true },
        exitGate: { type: 'exit', conditions: [{ type: 'artifact-exists', artifactName: 'x' }], required: true },
      }),
    ];
    const result = formatStageTable(stages);
    expect(result).toContain('entry(1)');
    expect(result).toContain('exit(1)');
  });
});

describe('formatStageDetail', () => {
  it('shows type and description', () => {
    const result = formatStageDetail(makeStage({ description: 'Do research' }));
    expect(result).toContain('Form: research');
    expect(result).toContain('Description: Do research');
  });

  it('shows flavor in parentheses', () => {
    const result = formatStageDetail(makeStage({ flavor: 'deep' }));
    expect(result).toContain('Form: research (deep)');
  });

  it('shows entry and exit gates', () => {
    const stage = makeStage({
      entryGate: {
        type: 'entry',
        conditions: [{ type: 'predecessor-complete', predecessorType: 'shape' }],
        required: true,
      },
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'summary', description: 'Summary must exist' }],
        required: true,
      },
    });
    const result = formatStageDetail(stage);
    expect(result).toContain('Entry Gate:');
    expect(result).toContain('[predecessor-complete]');
    expect(result).toContain('Exit Gate:');
    expect(result).toContain('Summary must exist');
  });

  it('shows artifacts', () => {
    const stage = makeStage({
      artifacts: [
        { name: 'report', description: 'A report', required: true, extension: '.md' },
        { name: 'data', required: false },
      ],
    });
    const result = formatStageDetail(stage);
    expect(result).toContain('Artifacts:');
    expect(result).toContain('report (required) [.md]');
    expect(result).toContain('data (optional)');
    expect(result).toContain('A report');
  });

  it('shows prompt template', () => {
    const result = formatStageDetail(makeStage({ promptTemplate: '../prompts/research.md' }));
    expect(result).toContain('Prompt Template: ../prompts/research.md');
  });

  it('shows learning hooks', () => {
    const result = formatStageDetail(makeStage({ learningHooks: ['quality', 'insights'] }));
    expect(result).toContain('Learning Hooks: quality, insights');
  });
});

describe('formatStageJson', () => {
  it('returns valid JSON', () => {
    const stages = [makeStage()];
    const result = formatStageJson(stages);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('research');
  });

  it('returns "[]" for empty list', () => {
    expect(formatStageJson([])).toBe('[]');
  });
});
