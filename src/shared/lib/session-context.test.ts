import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { detectSessionContext, detectLaunchMode } from './session-context.js';
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

  it('should include launchMode in session context', () => {
    const ctx = detectSessionContext(testDir);

    expect(['interactive', 'agent', 'ci']).toContain(ctx.launchMode);
  });
});

describe('detectLaunchMode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Restore to a clean state before each test
    process.env = { ...originalEnv };
    delete process.env['KATA_RUN_ID'];
    delete process.env['CI'];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return "interactive" when no relevant env vars are set', () => {
    expect(detectLaunchMode()).toBe('interactive');
  });

  it('should return "agent" when KATA_RUN_ID is set', () => {
    process.env['KATA_RUN_ID'] = 'some-run-id';
    expect(detectLaunchMode()).toBe('agent');
  });

  it('should return "ci" when CI=true', () => {
    process.env['CI'] = 'true';
    expect(detectLaunchMode()).toBe('ci');
  });

  it('should return "ci" when CI=1', () => {
    process.env['CI'] = '1';
    expect(detectLaunchMode()).toBe('ci');
  });

  it('should prefer "agent" over "ci" when both KATA_RUN_ID and CI are set', () => {
    process.env['KATA_RUN_ID'] = 'some-run-id';
    process.env['CI'] = 'true';
    expect(detectLaunchMode()).toBe('agent');
  });

  it('should return "interactive" when CI is set to a non-truthy value', () => {
    process.env['CI'] = 'false';
    expect(detectLaunchMode()).toBe('interactive');
  });
});
