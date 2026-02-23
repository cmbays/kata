import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deleteStep } from './step-deleter.js';
import { StepNotFoundError } from '@shared/lib/errors.js';

describe('deleteStep', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'kata-step-delete-test-'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('deletes an existing step and returns it', () => {
    const stepDef = { type: 'cleanup', description: 'Cleanup step', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'cleanup.json'), JSON.stringify(stepDef, null, 2));

    const { deleted } = deleteStep({ stagesDir: baseDir, type: 'cleanup' });

    expect(deleted.type).toBe('cleanup');
    expect(deleted.description).toBe('Cleanup step');
    expect(existsSync(join(baseDir, 'cleanup.json'))).toBe(false);
  });

  it('throws StepNotFoundError for a missing step', () => {
    expect(() => deleteStep({ stagesDir: baseDir, type: 'nonexistent' })).toThrow(StepNotFoundError);
  });

  it('deletes a flavored step with dot-notation filename', () => {
    const stepDef = { type: 'build', flavor: 'go', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'build.go.json'), JSON.stringify(stepDef, null, 2));

    const { deleted } = deleteStep({ stagesDir: baseDir, type: 'build', flavor: 'go' });

    expect(deleted.type).toBe('build');
    expect(deleted.flavor).toBe('go');
    expect(existsSync(join(baseDir, 'build.go.json'))).toBe(false);
  });

  it('does not delete sibling flavors when deleting one flavor', () => {
    const base = { type: 'build', artifacts: [], learningHooks: [], config: {} };
    const go = { type: 'build', flavor: 'go', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'build.json'), JSON.stringify(base, null, 2));
    writeFileSync(join(baseDir, 'build.go.json'), JSON.stringify(go, null, 2));

    deleteStep({ stagesDir: baseDir, type: 'build', flavor: 'go' });

    expect(existsSync(join(baseDir, 'build.json'))).toBe(true);
    expect(existsSync(join(baseDir, 'build.go.json'))).toBe(false);
  });
});
