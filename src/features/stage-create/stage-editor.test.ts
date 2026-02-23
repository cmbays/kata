import { join } from 'node:path';
import { mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStage } from './stage-creator.js';
import { editStage } from './stage-editor.js';
import { StageSchema } from '@domain/types/stage.js';

describe('editStage', () => {
  const baseDir = join(tmpdir(), `kata-stage-edit-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
    // Seed a stage to edit
    createStage({ stagesDir: baseDir, input: { type: 'validate', description: 'original' } });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('overwrites description and returns previous', () => {
    const { stage, previous } = editStage({
      stagesDir: baseDir,
      type: 'validate',
      input: { type: 'validate', description: 'updated' },
    });

    expect(stage.description).toBe('updated');
    expect(previous.description).toBe('original');
  });

  it('persists the updated stage to disk', () => {
    editStage({
      stagesDir: baseDir,
      type: 'validate',
      input: { type: 'validate', description: 'on-disk' },
    });

    const raw = JSON.parse(readFileSync(join(baseDir, 'validate.json'), 'utf-8'));
    const parsed = StageSchema.parse(raw);
    expect(parsed.description).toBe('on-disk');
  });

  it('works with a flavored stage', () => {
    // Seed a flavored stage
    createStage({ stagesDir: baseDir, input: { type: 'build', flavor: 'go' } });

    const { stage, previous } = editStage({
      stagesDir: baseDir,
      type: 'build',
      flavor: 'go',
      input: { type: 'build', flavor: 'go', description: 'Go build step' },
    });

    expect(stage.flavor).toBe('go');
    expect(stage.description).toBe('Go build step');
    expect(previous.description).toBeUndefined();
  });

  it('throws StageNotFoundError when stage does not exist', () => {
    expect(() =>
      editStage({ stagesDir: baseDir, type: 'nonexistent', input: { type: 'nonexistent' } }),
    ).toThrow();
  });

  it('throws ZodError when input is invalid', () => {
    expect(() =>
      editStage({ stagesDir: baseDir, type: 'validate', input: { type: '' } }),
    ).toThrow();
  });

  it('can add artifacts and gates on edit', () => {
    const { stage } = editStage({
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

    expect(stage.artifacts).toHaveLength(1);
    expect(stage.artifacts[0]?.name).toBe('report');
    expect(stage.entryGate?.conditions).toHaveLength(1);
  });
});
