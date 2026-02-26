import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerStageCommands } from './stage.js';
import {
  createRunTree,
  readRun,
  readStageState,
  writeStageState,
} from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Implement feature',
    stageSequence: ['plan', 'build'],
    currentStage: 'plan',
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerStageCommands (category-level)', () => {
  const baseDir = join(tmpdir(), `kata-stage-cat-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const flavorsDir = join(kataDir, 'flavors');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const sampleFlavor = {
    name: 'typescript-tdd',
    description: 'TDD build for TypeScript',
    stageCategory: 'build',
    steps: [{ stepName: 'tdd-scaffold', stepType: 'build' }],
    synthesisArtifact: 'build-output',
  };

  beforeEach(() => {
    mkdirSync(flavorsDir, { recursive: true });
    mkdirSync(join(kataDir, 'rules'), { recursive: true });
    mkdirSync(join(kataDir, 'history'), { recursive: true });
    mkdirSync(join(kataDir, 'runs'), { recursive: true });
    writeFileSync(
      join(flavorsDir, 'build.typescript-tdd.json'),
      JSON.stringify(sampleFlavor, null, 2),
    );
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
    registerStageCommands(program);
    return program;
  }

  describe('stage list', () => {
    it('lists all 4 stage categories', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
      expect(output).toContain('plan');
      expect(output).toContain('build');
      expect(output).toContain('review');
    });

    it('lists stage categories as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(4);
      expect(parsed.map((e: { category: string }) => e.category)).toEqual([
        'research', 'plan', 'build', 'review',
      ]);
    });

    it('shows flavor count for categories with flavors', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      const buildEntry = parsed.find((e: { category: string }) => e.category === 'build');
      expect(buildEntry.flavorCount).toBe(1);
    });

    it('accepts gyo alias', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'gyo', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });
  });

  describe('stage inspect', () => {
    it('shows stage details for a valid category', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Stage: build');
      expect(output).toContain('typescript-tdd');
    });

    it('shows error for invalid category', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'invalid-cat']);

      expect(errorSpy).toHaveBeenCalled();
      const errOutput = errorSpy.mock.calls[0]?.[0] as string;
      expect(errOutput).toContain('Invalid stage category');
    });

    it('shows stage details as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'inspect', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.category).toBe('build');
      expect(parsed.flavors).toContain('typescript-tdd');
    });

    it('shows empty flavors for category with none', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Stage: research');
      expect(output).toContain('(none registered)');
    });

    it('shows rules and decisions sections', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Rules:');
      expect(output).toContain('Decisions:');
    });
  });

  // ---- stage complete ----

  describe('stage complete', () => {
    const runsDir = join(kataDir, 'runs');

    it('marks stage completed and advances to next stage', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'plan',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.stage).toBe('plan');
      expect(output.status).toBe('completed');
      expect(output.nextStage).toBe('build');

      const updatedState = readStageState(runsDir, run.id, 'plan');
      expect(updatedState.status).toBe('completed');

      const updatedRun = readRun(runsDir, run.id);
      expect(updatedRun.currentStage).toBe('build');
      expect(updatedRun.status).toBe('running');
    });

    it('marks run complete when completing last stage', async () => {
      const run = makeRun({ stageSequence: ['plan', 'build'], currentStage: 'build' });
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'build');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'build',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.nextStage).toBeNull();

      const updatedRun = readRun(runsDir, run.id);
      expect(updatedRun.status).toBe('completed');
      expect(updatedRun.completedAt).toBeDefined();
    });

    it('copies synthesis file when --synthesis provided', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      // Write a temp synthesis file
      const synthFile = join(tmpdir(), `synthesis-${randomUUID()}.md`);
      writeFileSync(synthFile, '# Plan synthesis\n\nContent here.', 'utf-8');

      try {
        const program = createProgram();
        await program.parseAsync([
          'node', 'test', '--json', '--cwd', baseDir,
          'stage', 'complete', run.id,
          '--stage', 'plan', '--synthesis', synthFile,
        ]);

        const destPath = join(runsDir, run.id, 'stages', 'plan', 'synthesis.md');
        expect(existsSync(destPath)).toBe(true);
        expect(readFileSync(destPath, 'utf-8')).toContain('Plan synthesis');

        const updatedState = readStageState(runsDir, run.id, 'plan');
        expect(updatedState.synthesisArtifact).toBe('stages/plan/synthesis.md');
      } finally {
        rmSync(synthFile, { force: true });
      }
    });

    it('prints non-JSON completion message', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'plan',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Next stage: build'));
    });

    it('errors on invalid stage category', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'invalid',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid stage category'));
    });

    it('errors when run does not exist', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', randomUUID(), '--stage', 'plan',
      ]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('errors when stage is not in the run stageSequence', async () => {
      const run = makeRun({ stageSequence: ['plan', 'build'], currentStage: 'plan' });
      createRunTree(runsDir, run);

      const program = createProgram();
      // 'research' is a valid category but not in this run's sequence
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'research',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not in the sequence'));
      // Run state must NOT be mutated
      const updatedRun = readRun(runsDir, run.id);
      expect(updatedRun.currentStage).toBe('plan');
      expect(updatedRun.status).toBe('running');
    });

    it('errors when synthesis source file does not exist', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'plan');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', run.id,
        '--stage', 'plan', '--synthesis', '/nonexistent/synthesis.md',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
      // Stage must NOT be marked completed
      const updatedState = readStageState(runsDir, run.id, 'plan');
      expect(updatedState.status).toBe('running');
    });

    it('prints run-complete message in non-JSON mode when completing last stage', async () => {
      const run = makeRun({ stageSequence: ['plan', 'build'], currentStage: 'build' });
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'build');
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'complete', run.id, '--stage', 'build',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('is now complete'));
    });
  });

  // ---- kata stage vocab seed ----

  describe('stage vocab seed', () => {
    const vocabDir = join(kataDir, 'vocabularies');

    it('seeds keywords for a stage category', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'vocab', 'seed', 'research', 'rag', 'embeddings',
      ]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.flat().join('\n');
      expect(output).toContain('research');
      expect(output).toContain('added');
      expect(existsSync(join(vocabDir, 'research.json'))).toBe(true);
      const saved = JSON.parse(readFileSync(join(vocabDir, 'research.json'), 'utf-8'));
      expect(saved.keywords).toContain('rag');
      expect(saved.keywords).toContain('embeddings');
    });

    it('appends to existing vocab without duplicates', async () => {
      const program = createProgram();
      // First seed
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'vocab', 'seed', 'build', 'rust']);
      // Second seed with overlap
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'vocab', 'seed', 'build', 'rust', 'cargo']);

      const saved = JSON.parse(readFileSync(join(vocabDir, 'build.json'), 'utf-8'));
      const rustCount = saved.keywords.filter((k: string) => k === 'rust').length;
      expect(rustCount).toBe(1); // no duplicates
      expect(saved.keywords).toContain('cargo');
    });

    it('outputs JSON when --json flag is set', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'stage', 'vocab', 'seed', 'plan', 'architecture',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.category).toBe('plan');
      expect(parsed.added).toBeGreaterThan(0);
      expect(typeof parsed.total).toBe('number');
    });

    it('errors on unknown category', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'vocab', 'seed', 'not-a-category', 'keyword',
      ]);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('seeds multiple categories from --from-json file', async () => {
      const payload = { research: ['vector-db', 'chunking'], build: ['wasm', 'cargo'] };
      const filePath = join(baseDir, 'vocab-seed.json');
      writeFileSync(filePath, JSON.stringify(payload, null, 2));

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'vocab', 'seed', '--from-json', filePath,
      ]);

      expect(consoleSpy).toHaveBeenCalled();
      const researchVocab = JSON.parse(readFileSync(join(vocabDir, 'research.json'), 'utf-8'));
      const buildVocab = JSON.parse(readFileSync(join(vocabDir, 'build.json'), 'utf-8'));
      expect(researchVocab.keywords).toContain('vector-db');
      expect(buildVocab.keywords).toContain('wasm');
    });

    it('errors when --from-json contains unknown category', async () => {
      const payload = { bogus: ['keyword'] };
      const filePath = join(baseDir, 'bad-vocab.json');
      writeFileSync(filePath, JSON.stringify(payload, null, 2));

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'stage', 'vocab', 'seed', '--from-json', filePath,
      ]);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
