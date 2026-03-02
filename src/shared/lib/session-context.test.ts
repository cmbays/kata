import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectSessionContext } from './session-context.js';
import { CycleSchema } from '@domain/types/cycle.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestDir(): string {
  const dir = join(tmpdir(), `kata-ctx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function initKata(baseDir: string): string {
  const kataDir = join(baseDir, '.kata');
  mkdirSync(kataDir, { recursive: true });
  return kataDir;
}

function createCycleInKata(kataDir: string, state: 'active' | 'planning' | 'complete' = 'active', name = 'Test Cycle'): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const cycle = CycleSchema.parse({
    id,
    name,
    budget: {},
    bets: [],
    state,
    createdAt: now,
    updatedAt: now,
  });
  const cyclesDir = join(kataDir, 'cycles');
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${id}.json`), JSON.stringify(cycle, null, 2));
  return id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectSessionContext', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should detect when kata is not initialized', () => {
    const ctx = detectSessionContext(testDir);

    expect(ctx.kataInitialized).toBe(false);
    expect(ctx.kataDir).toBeNull();
    expect(ctx.activeCycle).toBeNull();
  });

  it('should detect when kata is initialized', () => {
    initKata(testDir);

    const ctx = detectSessionContext(testDir);

    expect(ctx.kataInitialized).toBe(true);
    expect(ctx.kataDir).toBe(join(testDir, '.kata'));
  });

  it('should find .kata/ from a subdirectory', () => {
    initKata(testDir);
    const subDir = join(testDir, 'src', 'components');
    mkdirSync(subDir, { recursive: true });

    const ctx = detectSessionContext(subDir);

    expect(ctx.kataInitialized).toBe(true);
    expect(ctx.kataDir).toBe(join(testDir, '.kata'));
  });

  it('should detect an active cycle', () => {
    const kataDir = initKata(testDir);
    const cycleId = createCycleInKata(kataDir, 'active', 'Cycle 2');

    const ctx = detectSessionContext(testDir);

    expect(ctx.activeCycle).not.toBeNull();
    expect(ctx.activeCycle!.id).toBe(cycleId);
    expect(ctx.activeCycle!.name).toBe('Cycle 2');
  });

  it('should return null when no active cycle', () => {
    const kataDir = initKata(testDir);
    createCycleInKata(kataDir, 'planning');

    const ctx = detectSessionContext(testDir);

    expect(ctx.activeCycle).toBeNull();
  });

  it('should return null when cycles dir is empty', () => {
    const kataDir = initKata(testDir);
    mkdirSync(join(kataDir, 'cycles'), { recursive: true });

    const ctx = detectSessionContext(testDir);

    expect(ctx.activeCycle).toBeNull();
  });

  it('should detect worktree status correctly for non-worktree', () => {
    // A temp directory is not inside a git worktree
    const ctx = detectSessionContext(testDir);

    expect(ctx.inWorktree).toBe(false);
  });

  it('should use process.cwd() when no cwd argument provided', () => {
    // This just verifies it doesn't throw; actual CWD detection
    // depends on the environment
    const ctx = detectSessionContext();

    expect(typeof ctx.kataInitialized).toBe('boolean');
    expect(typeof ctx.inWorktree).toBe('boolean');
  });
});
