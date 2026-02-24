import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerStageCommands } from './stage.js';

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
});
