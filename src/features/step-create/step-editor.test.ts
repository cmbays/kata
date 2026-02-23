import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStep } from './step-creator.js';
import { editStep } from './step-editor.js';
import { StepSchema } from '@domain/types/step.js';

describe('editStep', () => {
  const baseDir = join(tmpdir(), `kata-step-edit-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
    // Seed a step to edit
    createStep({ stagesDir: baseDir, input: { type: 'validate', description: 'original' } });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('overwrites description and returns previous', () => {
    const { step, previous } = editStep({
      stagesDir: baseDir,
      type: 'validate',
      input: { type: 'validate', description: 'updated' },
    });

    expect(step.description).toBe('updated');
    expect(previous.description).toBe('original');
  });

  it('persists the updated step to disk', () => {
    editStep({
      stagesDir: baseDir,
      type: 'validate',
      input: { type: 'validate', description: 'on-disk' },
    });

    const raw = JSON.parse(readFileSync(join(baseDir, 'validate.json'), 'utf-8'));
    const parsed = StepSchema.parse(raw);
    expect(parsed.description).toBe('on-disk');
  });

  it('works with a flavored step', () => {
    // Seed a flavored step
    createStep({ stagesDir: baseDir, input: { type: 'build', flavor: 'go' } });

    const { step, previous } = editStep({
      stagesDir: baseDir,
      type: 'build',
      flavor: 'go',
      input: { type: 'build', flavor: 'go', description: 'Go build step' },
    });

    expect(step.flavor).toBe('go');
    expect(step.description).toBe('Go build step');
    expect(previous.description).toBeUndefined();
  });

  it('throws StepNotFoundError when step does not exist', () => {
    expect(() =>
      editStep({ stagesDir: baseDir, type: 'nonexistent', input: { type: 'nonexistent' } }),
    ).toThrow();
  });

  it('throws ZodError when input is invalid', () => {
    expect(() =>
      editStep({ stagesDir: baseDir, type: 'validate', input: { type: '' } }),
    ).toThrow();
  });

  it('can add artifacts and gates on edit', () => {
    const { step } = editStep({
      stagesDir: baseDir,
      type: 'validate',
      input: {
        type: 'validate',
        description: 'with artifacts',
        artifacts: [{ name: 'report', required: true, extension: '.md' }],
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'spec' }],
          required: true,
        },
      },
    });

    expect(step.artifacts).toHaveLength(1);
    expect(step.artifacts[0]?.name).toBe('report');
    expect(step.entryGate?.conditions).toHaveLength(1);
  });
});
