import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerStageCommands } from './stage.js';

// Mock @inquirer/prompts to avoid interactive prompts in tests.
// Individual tests override these as needed.
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn().mockResolvedValue(''),
  confirm: vi.fn().mockResolvedValue(false),
  select: vi.fn().mockResolvedValue('artifact-exists'),
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

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
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

    it('returns empty message when --flavor type has no stages', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'list', '--flavor', 'nonexistent']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No stages found');
    });
  });

  // ---- stage inspect ----

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
    it('overwrites existing stage and outputs success message', async () => {
      const { input, confirm } = await import('@inquirer/prompts');
      // Sequence: description → keep artifacts? (no, default false) → add artifact? (no) →
      // add entry gate cond? (no) → add exit gate cond? (no) → learning hooks → want prompt? (no)
      vi.mocked(input)
        .mockResolvedValueOnce('Updated research step') // description
        .mockResolvedValueOnce('')                       // learning hooks (empty)
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)  // keep existing artifact (summary)
        .mockResolvedValueOnce(false) // add artifact?
        .mockResolvedValueOnce(false) // add entry gate cond?
        .mockResolvedValueOnce(false) // add exit gate cond?
        .mockResolvedValueOnce(false) // want prompt template?

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('updated successfully');
      expect(output).toContain('research');
    });

    it('outputs updated stage as JSON with --json flag', async () => {
      const { input, confirm } = await import('@inquirer/prompts');
      vi.mocked(input)
        .mockResolvedValueOnce('JSON description') // description
        .mockResolvedValueOnce('')                  // learning hooks
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)  // keep existing artifact
        .mockResolvedValueOnce(false) // add artifact?
        .mockResolvedValueOnce(false) // add entry gate?
        .mockResolvedValueOnce(false) // add exit gate?
        .mockResolvedValueOnce(false) // want prompt?

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('research');
      expect(parsed[0].description).toBe('JSON description');
    });

    it('edits a flavored stage with --flavor', async () => {
      const { input, confirm } = await import('@inquirer/prompts');
      vi.mocked(input)
        .mockResolvedValueOnce('Updated TS build') // description
        .mockResolvedValueOnce('')                   // learning hooks
      vi.mocked(confirm)
        .mockResolvedValueOnce(false) // add artifact?
        .mockResolvedValueOnce(false) // add entry gate?
        .mockResolvedValueOnce(false) // add exit gate?
        .mockResolvedValueOnce(false) // want prompt?

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'stage', 'edit', 'build', '--flavor', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('build');
      expect(parsed[0].flavor).toBe('typescript');
      expect(parsed[0].description).toBe('Updated TS build');
    });

    it('shows error when editing a non-existent stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('persists changes to disk', async () => {
      const { input, confirm } = await import('@inquirer/prompts');
      vi.mocked(input)
        .mockResolvedValueOnce('Persisted change') // description
        .mockResolvedValueOnce('')                   // learning hooks
      vi.mocked(confirm)
        .mockResolvedValueOnce(true)  // keep existing artifact
        .mockResolvedValueOnce(false) // add artifact?
        .mockResolvedValueOnce(false) // add entry gate?
        .mockResolvedValueOnce(false) // add exit gate?
        .mockResolvedValueOnce(false) // want prompt?

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'stage', 'edit', 'research']);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'research.json'), 'utf-8'));
      expect(raw.description).toBe('Persisted change');
    });
  });
});
