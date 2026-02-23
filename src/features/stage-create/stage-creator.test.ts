import { join } from 'node:path';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createStage } from './stage-creator.js';
import { StageSchema } from '@domain/types/stage.js';

describe('createStage', () => {
  const baseDir = join(tmpdir(), `kata-stage-create-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('writes a minimal stage to disk', () => {
    const { stage } = createStage({
      stagesDir: baseDir,
      input: { type: 'my-custom' },
    });

    expect(stage.type).toBe('my-custom');
    expect(stage.artifacts).toEqual([]);
    expect(stage.learningHooks).toEqual([]);

    const filePath = join(baseDir, 'my-custom.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const parsed = StageSchema.parse(raw);
    expect(parsed.type).toBe('my-custom');
  });

  it('writes a flavored stage with dot-notation filename', () => {
    createStage({
      stagesDir: baseDir,
      input: { type: 'build', flavor: 'rust' },
    });

    // StageRegistry uses "type.flavor.json" dot-notation (from feat/wave5-flavors)
    const filePath = join(baseDir, 'build.rust.json');
    expect(existsSync(filePath)).toBe(true);

    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    expect(raw.type).toBe('build');
    expect(raw.flavor).toBe('rust');
  });

  it('persists full stage with gates and artifacts', () => {
    const { stage } = createStage({
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

    expect(stage.entryGate?.conditions).toHaveLength(1);
    expect(stage.exitGate?.conditions[0]?.type).toBe('human-approved');
    expect(stage.artifacts[0]?.name).toBe('validation-report');
    expect(stage.learningHooks).toEqual(['quality-check']);

    const filePath = join(baseDir, 'validate.json');
    expect(existsSync(filePath)).toBe(true);
  });

  it('throws when type is empty', () => {
    expect(() =>
      createStage({ stagesDir: baseDir, input: { type: '' } }),
    ).toThrow();
  });

  it('throws when input is missing type', () => {
    expect(() =>
      createStage({ stagesDir: baseDir, input: { flavor: 'x' } }),
    ).toThrow();
  });

  it('overwrites an existing stage with the same type', () => {
    createStage({ stagesDir: baseDir, input: { type: 'demo', description: 'first' } });
    createStage({ stagesDir: baseDir, input: { type: 'demo', description: 'second' } });

    const raw = JSON.parse(readFileSync(join(baseDir, 'demo.json'), 'utf-8'));
    expect(raw.description).toBe('second');
  });
});
