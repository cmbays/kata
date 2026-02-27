import type { Step } from '@domain/types/step.js';
import { formatStepTable, formatStepDetail, formatStepJson } from './step-formatter.js';

const makeStep = (overrides: Partial<Step> = {}): Step => ({
  type: 'research',
  artifacts: [],
  learningHooks: [],
  config: {},
  ...overrides,
});

describe('formatStepTable', () => {
  it('returns "No steps found." for empty list', () => {
    expect(formatStepTable([])).toBe('No steps found.');
  });

  it('formats a single step row', () => {
    const steps = [makeStep({ type: 'build', artifacts: [{ name: 'code', required: true }] })];
    const result = formatStepTable(steps, true);
    expect(result).toContain('Step');
    expect(result).toContain('build');
    expect(result).toContain('code');
  });

  it('shows thematic column header by default', () => {
    const steps = [makeStep({ type: 'build' })];
    const result = formatStepTable(steps);
    expect(result).toContain('Waza');
  });

  it('shows flavor when present', () => {
    const steps = [makeStep({ type: 'build', flavor: 'fast' })];
    const result = formatStepTable(steps, true);
    expect(result).toContain('fast');
  });

  it('shows "-" for missing flavor', () => {
    const steps = [makeStep()];
    const lines = formatStepTable(steps, true).split('\n');
    const dataRow = lines[2]; // header, separator, data
    expect(dataRow).toContain('-');
  });

  it('summarizes required gates with req suffix (plain)', () => {
    const steps = [
      makeStep({
        entryGate: { type: 'entry', conditions: [{ type: 'predecessor-complete' }], required: true },
        exitGate: { type: 'exit', conditions: [{ type: 'artifact-exists', artifactName: 'x' }], required: true },
      }),
    ];
    const result = formatStepTable(steps, true);
    expect(result).toContain('entry gate(1,req)');
    expect(result).toContain('exit gate(1,req)');
  });

  it('summarizes gates with thematic labels by default', () => {
    const steps = [
      makeStep({
        entryGate: { type: 'entry', conditions: [{ type: 'predecessor-complete' }], required: true },
        exitGate: { type: 'exit', conditions: [{ type: 'artifact-exists', artifactName: 'x' }], required: false },
      }),
    ];
    const result = formatStepTable(steps);
    expect(result).toContain('iri-mon(1,req)');
    expect(result).toContain('de-mon(1,opt)');
  });

  it('summarizes optional gates with opt suffix', () => {
    const steps = [
      makeStep({
        entryGate: { type: 'entry', conditions: [{ type: 'human-approved' }], required: false },
        exitGate: { type: 'exit', conditions: [{ type: 'artifact-exists', artifactName: 'y' }, { type: 'human-approved' }], required: false },
      }),
    ];
    const result = formatStepTable(steps, true);
    expect(result).toContain('entry gate(1,opt)');
    expect(result).toContain('exit gate(2,opt)');
  });
});

describe('formatStepDetail', () => {
  it('shows type and description', () => {
    const result = formatStepDetail(makeStep({ description: 'Do research' }), true);
    expect(result).toContain('Step: research');
    expect(result).toContain('Do research');
  });

  it('uses thematic label by default', () => {
    const result = formatStepDetail(makeStep());
    expect(result).toContain('Waza: research');
  });

  it('shows flavor in parentheses', () => {
    const result = formatStepDetail(makeStep({ flavor: 'deep' }), true);
    expect(result).toContain('Step: research (deep)');
  });

  it('shows entry and exit gates (plain)', () => {
    const step = makeStep({
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
    const result = formatStepDetail(step, true);
    expect(result).toContain('Entry Gate');
    expect(result).toContain('[predecessor-complete]');
    expect(result).toContain('Exit Gate');
    expect(result).toContain('Summary must exist');
  });

  it('shows thematic gate labels by default', () => {
    const step = makeStep({
      entryGate: { type: 'entry', conditions: [{ type: 'predecessor-complete' }], required: true },
      exitGate: { type: 'exit', conditions: [{ type: 'artifact-exists', artifactName: 'out' }], required: true },
    });
    const result = formatStepDetail(step);
    expect(result).toContain('Iri-Mon');
    expect(result).toContain('De-Mon');
  });

  it('shows artifacts', () => {
    const step = makeStep({
      artifacts: [
        { name: 'report', description: 'A report', required: true, extension: '.md' },
        { name: 'data', required: false },
      ],
    });
    const result = formatStepDetail(step);
    expect(result).toContain('Artifacts');
    expect(result).toContain('report');
    expect(result).toContain('required');
    expect(result).toContain('[.md]');
    expect(result).toContain('data');
    expect(result).toContain('optional');
    expect(result).toContain('A report');
  });

  it('shows prompt template', () => {
    const result = formatStepDetail(makeStep({ promptTemplate: '../prompts/research.md' }));
    expect(result).toContain('../prompts/research.md');
  });

  it('shows learning hooks', () => {
    const result = formatStepDetail(makeStep({ learningHooks: ['quality', 'insights'] }));
    expect(result).toContain('quality, insights');
  });

  it('shows resources section when present', () => {
    const step = makeStep({
      resources: {
        tools: [{ name: 'tsc', purpose: 'Type checking', command: 'npx tsc --noEmit' }],
        agents: [{ name: 'everything-claude-code:build-error-resolver', when: 'when build fails' }],
        skills: [{ name: 'pr-review-toolkit:code-reviewer' }],
      },
    });
    const result = formatStepDetail(step);
    expect(result).toContain('Resources');
    expect(result).toContain('tsc: Type checking');
    expect(result).toContain('npx tsc --noEmit');
    expect(result).toContain('everything-claude-code:build-error-resolver');
    expect(result).toContain('when build fails');
    expect(result).toContain('pr-review-toolkit:code-reviewer');
  });

  it('omits resources section when absent', () => {
    const result = formatStepDetail(makeStep({ resources: undefined }));
    expect(result).not.toContain('Resources:');
  });

  it('omits resources section when all arrays are empty', () => {
    const result = formatStepDetail(makeStep({
      resources: { tools: [], agents: [], skills: [] },
    }));
    expect(result).not.toContain('Resources:');
  });
});

describe('formatStepJson', () => {
  it('returns valid JSON', () => {
    const steps = [makeStep()];
    const result = formatStepJson(steps);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('research');
  });

  it('returns "[]" for empty list', () => {
    expect(formatStepJson([])).toBe('[]');
  });
});
