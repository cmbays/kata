import { join } from 'node:path';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerArtifactCommands } from './artifact.js';
import { createRunTree } from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { ArtifactIndexEntrySchema } from '@domain/types/run-state.js';
import type { Run } from '@domain/types/run-state.js';

function tempBase(): string {
  return join(tmpdir(), `kata-artifact-test-${randomUUID()}`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Implement auth',
    stageSequence: ['research', 'plan'],
    currentStage: null,
    status: 'pending',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerArtifactCommands — artifact record', () => {
  let baseDir: string;
  let kataDir: string;
  let runsDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = tempBase();
    kataDir = join(baseDir, '.kata');
    runsDir = join(kataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerArtifactCommands(program);
    return program;
  }

  it('records an artifact and appends to artifact-index.jsonl files', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Create a temp source file
    const srcFile = join(baseDir, 'context.md');
    writeFileSync(srcFile, '# Context\nSome content', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'technical-research',
      '--step', 'gather-context',
      '--file', srcFile,
      '--summary', 'Context gathering output',
    ]);

    // Verify run-level index
    const runIndexPath = join(runsDir, run.id, 'artifact-index.jsonl');
    expect(existsSync(runIndexPath)).toBe(true);
    const entries = JsonlStore.readAll(runIndexPath, ArtifactIndexEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].flavor).toBe('technical-research');
    expect(entries[0].step).toBe('gather-context');
    expect(entries[0].type).toBe('artifact');
    expect(entries[0].summary).toBe('Context gathering output');

    // filePath is relative to run dir; verify the file exists at the absolute path
    const absoluteFilePath = join(runsDir, run.id, entries[0].filePath);
    expect(existsSync(absoluteFilePath)).toBe(true);
  });

  it('records a synthesis artifact at flavor root', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const srcFile = join(baseDir, 'synthesis.md');
    writeFileSync(srcFile, '# Synthesis', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'technical-research',
      '--step', 'synthesis',
      '--file', srcFile,
      '--summary', 'Research synthesis',
      '--type', 'synthesis',
    ]);

    const entries = JsonlStore.readAll(
      join(runsDir, run.id, 'artifact-index.jsonl'),
      ArtifactIndexEntrySchema,
    );
    expect(entries[0].type).toBe('synthesis');
    expect(entries[0].step).toBeNull(); // synthesis has no step
    // Synthesis goes to synthesis.md at flavor root
    expect(entries[0].filePath).toContain('synthesis.md');
  });

  it('records synthesis without --step and always stores fileName as synthesis.md', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Source file has a different name to confirm renaming happens
    const srcFile = join(baseDir, 'research-report.md');
    writeFileSync(srcFile, '# Research Report', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'technical-research',
      // No --step provided — should be fine for synthesis type
      '--file', srcFile,
      '--summary', 'Research synthesis output',
      '--type', 'synthesis',
    ]);

    const entries = JsonlStore.readAll(
      join(runsDir, run.id, 'artifact-index.jsonl'),
      ArtifactIndexEntrySchema,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('synthesis');
    expect(entries[0].step).toBeNull();
    expect(entries[0].fileName).toBe('synthesis.md');
    expect(entries[0].filePath).toContain('synthesis.md');
    // filePath is relative (does not start with /)
    expect(entries[0].filePath.startsWith('/')).toBe(false);
  });

  it('outputs JSON with --json flag', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const srcFile = join(baseDir, 'output.md');
    writeFileSync(srcFile, '# Output', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'tech',
      '--step', 'step1',
      '--file', srcFile,
      '--summary', 'Test output',
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe('artifact');
    expect(parsed.flavor).toBe('tech');
    expect(parsed.id).toBeDefined();
  });

  it('throws on invalid stage category', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const srcFile = join(baseDir, 'output.md');
    writeFileSync(srcFile, '# Output', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'deploy',
      '--flavor', 'tech',
      '--step', 'step1',
      '--file', srcFile,
      '--summary', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid stage category'));
  });

  it('throws when source file is missing', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'tech',
      '--step', 'step1',
      '--file', join(baseDir, 'nonexistent.md'),
      '--summary', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('throws on invalid --type value', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const srcFile = join(baseDir, 'output.md');
    writeFileSync(srcFile, '# Output', 'utf-8');

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'artifact', 'record', run.id,
      '--stage', 'research',
      '--flavor', 'tech',
      '--step', 'step1',
      '--file', srcFile,
      '--summary', 'Test',
      '--type', 'report',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid --type'));
  });
});
