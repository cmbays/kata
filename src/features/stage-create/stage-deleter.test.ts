import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { deleteStage } from './stage-deleter.js';

describe('deleteStage', () => {
  const baseDir = join(tmpdir(), `kata-stage-delete-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(baseDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('deletes an existing stage and returns it', () => {
    const stageDef = { type: 'cleanup', description: 'Cleanup step', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'cleanup.json'), JSON.stringify(stageDef, null, 2));

    const { deleted } = deleteStage({ stagesDir: baseDir, type: 'cleanup' });

    expect(deleted.type).toBe('cleanup');
    expect(deleted.description).toBe('Cleanup step');
    expect(existsSync(join(baseDir, 'cleanup.json'))).toBe(false);
  });

  it('throws StageNotFoundError for a missing stage', () => {
    expect(() => deleteStage({ stagesDir: baseDir, type: 'nonexistent' })).toThrow('Stage not found');
  });

  it('deletes a flavored stage with dot-notation filename', () => {
    const stageDef = { type: 'build', flavor: 'go', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'build.go.json'), JSON.stringify(stageDef, null, 2));

    const { deleted } = deleteStage({ stagesDir: baseDir, type: 'build', flavor: 'go' });

    expect(deleted.type).toBe('build');
    expect(deleted.flavor).toBe('go');
    expect(existsSync(join(baseDir, 'build.go.json'))).toBe(false);
  });

  it('does not delete sibling flavors when deleting one flavor', () => {
    const base = { type: 'build', artifacts: [], learningHooks: [], config: {} };
    const go = { type: 'build', flavor: 'go', artifacts: [], learningHooks: [], config: {} };
    writeFileSync(join(baseDir, 'build.json'), JSON.stringify(base, null, 2));
    writeFileSync(join(baseDir, 'build.go.json'), JSON.stringify(go, null, 2));

    deleteStage({ stagesDir: baseDir, type: 'build', flavor: 'go' });

    expect(existsSync(join(baseDir, 'build.json'))).toBe(true);
    expect(existsSync(join(baseDir, 'build.go.json'))).toBe(false);
  });
});
