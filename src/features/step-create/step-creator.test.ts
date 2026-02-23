import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStep } from './step-creator.js';
import { StepSchema } from '@domain/types/step.js';

describe('createStep', () => {
  const baseDir = join(tmpdir(), `kata-step-create-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes a minimal step to disk', () => {
    const { step } = createStep({
      stagesDir: baseDir,
      input: { type: 'my-custom' },
    });

    expect(step.type).toBe('my-custom');
    expect(step.artifacts).toEqual([]);
    expect(step.learningHooks).toEqual([]);

    const filePath = join(baseDir, 'my-custom.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const parsed = StepSchema.parse(raw);
    expect(parsed.type).toBe('my-custom');
  });

  it('writes a flavored step with dot-notation filename', () => {
    createStep({
      stagesDir: baseDir,
      input: { type: 'build', flavor: 'rust' },
    });

    // StepRegistry uses "type.flavor.json" dot-notation (from feat/wave5-flavors)
    const filePath = join(baseDir, 'build.rust.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(raw.type).toBe('build');
    expect(raw.flavor).toBe('rust');
  });

  it('persists full step with gates and artifacts', () => {
    const { step } = createStep({
      stagesDir: baseDir,
      input: {
        type: 'validate',
        description: 'Validate the output',
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'spec' }],
          required: true,
        },
        exitGate: {
          type: 'exit',
          conditions: [{ type: 'human-approved', description: 'Validated by reviewer' }],
          required: true,
        },
        artifacts: [
          { name: 'validation-report', required: true, extension: '.md' },
        ],
        learningHooks: ['quality-check'],
      },
    });

    expect(step.entryGate?.conditions).toHaveLength(1);
    expect(step.exitGate?.conditions[0]?.type).toBe('human-approved');
    expect(step.artifacts[0]?.name).toBe('validation-report');
    expect(step.learningHooks).toEqual(['quality-check']);

    const filePath = join(baseDir, 'validate.json');
    expect(existsSync(filePath)).toBe(true);
  });

  it('throws when type is empty', () => {
    expect(() =>
      createStep({ stagesDir: baseDir, input: { type: '' } }),
    ).toThrow(/too_small|Too small/i);
  });

  it('throws when input is missing type', () => {
    expect(() =>
      createStep({ stagesDir: baseDir, input: { flavor: 'x' } }),
    ).toThrow(/invalid_type|Invalid input/i);
  });

  it('overwrites an existing step with the same type', () => {
    createStep({ stagesDir: baseDir, input: { type: 'demo', description: 'first' } });
    createStep({ stagesDir: baseDir, input: { type: 'demo', description: 'second' } });

    const raw = JSON.parse(readFileSync(join(baseDir, 'demo.json'), 'utf-8'));
    expect(raw.description).toBe('second');
  });
});
