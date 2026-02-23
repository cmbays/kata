import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerStageCommands } from './stage.js';

// Mock @inquirer/prompts to avoid interactive prompts in tests.
// Individual tests override these as needed.
vi.mock('@inquirer/prompts', () => ({
  Separator: class Separator { separator = true; },
  input: vi.fn().mockResolvedValue(''),
  confirm: vi.fn().mockResolvedValue(false),
  select: vi.fn().mockResolvedValue('save'),
  checkbox: vi.fn().mockResolvedValue([]),
  editor: vi.fn().mockResolvedValue(''),
}));

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
    vi.clearAllMocks();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerStageCommands(program);
    return program;
  }

  // ---- stage list ----

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

    it('filters by stage type when --flavor is passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--flavor', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build');
      expect(output).not.toContain('research');
    });

    it('accepts --ryu as silent alias for --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--ryu', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build');
    });

    it('returns all stages when --flavor not passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.some((s: { type: string }) => s.type === 'research')).toBe(true);
      expect(parsed.some((s: { type: string }) => s.type === 'build')).toBe(true);
    });

    it('returns empty message when --flavor type has no stages', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--flavor', 'nonexistent']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No stages found');
    });
  });

  // ---- stage inspect ----

  describe('stage inspect', () => {
    it('shows stage detail when type is provided', async () => {
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

    it('uses --ryu as alias for --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect', 'build', '--ryu', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build (typescript)');
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

    it('launches wizard when type is omitted', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce(sampleStage as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'inspect']);

      expect(select).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });
  });

  // ---- stage create --from-file ----

  describe('stage create --from-file', () => {
    it('creates a stage from a valid JSON file', async () => {
      const stageDef = { type: 'from-file-stage', description: 'Loaded from file' };
      const filePath = join(baseDir, 'stage-def.json');
      writeFileSync(filePath, JSON.stringify(stageDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'create', '--from-file', filePath]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('from-file-stage');
      expect(existsSync(join(stagesDir, 'from-file-stage.json'))).toBe(true);
    });

    it('outputs JSON when --json flag is set', async () => {
      const stageDef = { type: 'json-file-stage' };
      const filePath = join(baseDir, 'stage-json.json');
      writeFileSync(filePath, JSON.stringify(stageDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'create', '--from-file', filePath]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('json-file-stage');
    });

    it('shows error when file contains invalid stage definition', async () => {
      const filePath = join(baseDir, 'bad-stage.json');
      writeFileSync(filePath, JSON.stringify({ type: '' }, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'create', '--from-file', filePath]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows error when file path does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'create', '--from-file', '/nonexistent/path.json']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('creates a flavored stage from file', async () => {
      const stageDef = { type: 'build', flavor: 'wasm', description: 'WASM build' };
      const filePath = join(baseDir, 'wasm-stage.json');
      writeFileSync(filePath, JSON.stringify(stageDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'create', '--from-file', filePath]);

      expect(existsSync(join(stagesDir, 'build.wasm.json'))).toBe(true);
    });
  });

  // ---- stage edit ----

  describe('stage edit', () => {
    it('opens field-menu and saves when "Save and exit" selected with no changes', async () => {
      const { select } = await import('@inquirer/prompts');
      // select is called twice: once for field menu → 'save'
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('updated successfully');
      expect(output).toContain('research');
    });

    it('cancels edit when "Cancel" is selected', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('cancel' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('cancelled');
    });

    it('edits description field then saves', async () => {
      const { select, input } = await import('@inquirer/prompts');
      vi.mocked(select)
        .mockResolvedValueOnce('description' as never)
        .mockResolvedValueOnce('save' as never);
      vi.mocked(input).mockResolvedValueOnce('Updated description');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].description).toBe('Updated description');
    });

    it('outputs updated stage as JSON', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('research');
    });

    it('edits a flavored stage with --flavor', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'edit', 'build', '--flavor', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('build');
      expect(parsed[0].flavor).toBe('typescript');
    });

    it('shows error when editing a non-existent stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('persists changes to disk', async () => {
      const { select, input } = await import('@inquirer/prompts');
      vi.mocked(select)
        .mockResolvedValueOnce('description' as never)
        .mockResolvedValueOnce('save' as never);
      vi.mocked(input).mockResolvedValueOnce('Persisted change');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'research.json'), 'utf-8'));
      expect(raw.description).toBe('Persisted change');
    });

    it('launches wizard when type is omitted', async () => {
      const { select } = await import('@inquirer/prompts');
      // First call: stage selection wizard returns research
      vi.mocked(select)
        .mockResolvedValueOnce(sampleStage as never)
        // Second call: field menu → save
        .mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('updated successfully');
    });

    it('prints "Editing stage:" to console.log (not console.error)', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('cancel' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const logMessages = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(logMessages).toContain('Editing stage: research');
      // Ensure it was NOT sent to console.error
      const errMessages = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errMessages).not.toContain('Editing stage');
    });
  });

  // ---- stage delete ----

  describe('stage delete', () => {
    it('deletes a stage with --force (no confirmation)', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'delete', 'research', '--force']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('deleted');
    });

    it('prompts for confirmation and deletes when confirmed', async () => {
      const { confirm } = await import('@inquirer/prompts');
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'delete', 'research']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
    });

    it('cancels when confirmation is denied', async () => {
      const { confirm } = await import('@inquirer/prompts');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'delete', 'research']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(true);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Cancelled');
    });

    it('shows error when stage does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'delete', 'nonexistent', '--force']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('deletes a flavored stage with --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'delete', 'build', '--flavor', 'typescript', '--force']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'build.json'))).toBe(true);
    });

    it('accepts wasure as alias for delete', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'wasure', 'research', '--force']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
    });
  });

  // ---- stage rename ----

  describe('stage rename', () => {
    it('renames a base stage type', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'rename', 'research', 'analysis']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'analysis.json'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'analysis.json'), 'utf-8'));
      expect(raw.type).toBe('analysis');
    });

    it('renames a flavored stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'rename', 'build', 'compile', '--flavor', 'typescript']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'compile.typescript.json'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'compile.typescript.json'), 'utf-8'));
      expect(raw.type).toBe('compile');
      expect(raw.flavor).toBe('typescript');
    });

    it('renames both type and flavor with --new-flavor', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'stage', 'rename', 'build', 'compile',
        '--flavor', 'typescript', '--new-flavor', 'ts',
      ]);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'compile.ts.json'))).toBe(true);
    });

    it('does not affect sibling stages during rename', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'rename', 'research', 'analysis']);

      // build and build.typescript should be untouched
      expect(existsSync(join(stagesDir, 'build.json'))).toBe(true);
      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(true);
    });

    it('shows error when source stage does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'rename', 'nonexistent', 'something']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('renames prompt template file when stage has one', async () => {
      // Setup: write a stage with a promptTemplate, and the .md file
      const stageWithPrompt = {
        type: 'design',
        description: 'Design step',
        artifacts: [],
        learningHooks: [],
        config: {},
        promptTemplate: '../prompts/design.md',
      };
      const promptsDir = join(kataDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(stagesDir, 'design.json'), JSON.stringify(stageWithPrompt, null, 2));
      writeFileSync(join(promptsDir, 'design.md'), '# Design prompt', 'utf-8');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'rename', 'design', 'blueprint']);

      expect(existsSync(join(promptsDir, 'design.md'))).toBe(false);
      expect(existsSync(join(promptsDir, 'blueprint.md'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'blueprint.json'), 'utf-8'));
      expect(raw.promptTemplate).toBe('../prompts/blueprint.md');
    });
  });
});
