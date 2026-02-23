import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerStageCommands } from './stage.js';

describe('registerStageCommands', () => {
  const baseDir = join(tmpdir(), `kata-stage-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const stagesDir = join(kataDir, 'stages');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const sampleStage = {
    type: 'research',
    description: 'Research step',
    artifacts: [{ name: 'summary', required: true, extension: '.md' }],
    learningHooks: ['research-quality'],
    config: {},
  };

  const buildStage = {
    type: 'build',
    description: 'Build step',
    artifacts: [],
    learningHooks: [],
    config: {},
  };

  const buildTypescriptStage = {
    type: 'build',
    flavor: 'typescript',
    description: 'TypeScript build',
    artifacts: [],
    learningHooks: [],
    config: {},
  };

  beforeEach(() => {
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(stagesDir, 'research.json'), JSON.stringify(sampleStage, null, 2));
    writeFileSync(join(stagesDir, 'build.json'), JSON.stringify(buildStage, null, 2));
    writeFileSync(join(stagesDir, 'build.typescript.json'), JSON.stringify(buildTypescriptStage, null, 2));
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerStageCommands(program);
    return program;
  }

  describe('stage list', () => {
    it('lists stages as table', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });

    it('lists stages as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.some((s: { type: string }) => s.type === 'research')).toBe(true);
    });

    it('shows error when .kata/ does not exist', async () => {
      const noKataDir = join(tmpdir(), `kata-no-kata-${Date.now()}`);
      mkdirSync(noKataDir, { recursive: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', noKataDir, 'stage', 'list']);

      expect(errorSpy).toHaveBeenCalled();
      rmSync(noKataDir, { recursive: true, force: true });
    });

    it('filters by stage type when --type is passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--type', 'build']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      // Should contain build and build.typescript but not research
      expect(output).toContain('build');
      expect(output).not.toContain('research');
    });

    it('returns all stages when --flavor not passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.some((s: { type: string }) => s.type === 'research')).toBe(true);
      expect(parsed.some((s: { type: string }) => s.type === 'build')).toBe(true);
    });

    it('returns empty message when --type has no matching stages', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--type', 'nonexistent']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No stages found');
    });
  });

  describe('stage inspect', () => {
    it('shows stage detail', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Stage: research');
      expect(output).toContain('Research step');
    });

    it('shows flavored stage detail with --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'build', '--flavor', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Stage: build (typescript)');
    });

    it('shows stage as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'inspect', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('research');
    });

    it('shows error for unknown stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
