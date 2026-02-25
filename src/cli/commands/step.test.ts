import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerStepCommands } from './step.js';
import {
  createRunTree,
  writeStageState,
  readStageState,
  readFlavorState,
  writeFlavorState,
} from '@infra/persistence/run-store.js';
import type { Run } from '@domain/types/run-state.js';

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

describe('registerStepCommands', () => {
  const baseDir = join(tmpdir(), `kata-step-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const stagesDir = join(kataDir, 'stages');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const sampleStep = {
    type: 'research',
    description: 'Research step',
    artifacts: [{ name: 'summary', required: true, extension: '.md' }],
    learningHooks: ['research-quality'],
    config: {},
  };

  const buildStep = {
    type: 'build',
    description: 'Build step',
    artifacts: [],
    learningHooks: [],
    config: {},
  };

  const buildTypescriptStep = {
    type: 'build',
    flavor: 'typescript',
    description: 'TypeScript build',
    artifacts: [],
    learningHooks: [],
    config: {},
  };

  beforeEach(() => {
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(stagesDir, 'research.json'), JSON.stringify(sampleStep, null, 2));
    writeFileSync(join(stagesDir, 'build.json'), JSON.stringify(buildStep, null, 2));
    writeFileSync(join(stagesDir, 'build.typescript.json'), JSON.stringify(buildTypescriptStep, null, 2));
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
    registerStepCommands(program);
    return program;
  }

  // ---- step list ----

  describe('step list', () => {
    it('lists steps as table', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });

    it('lists steps as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed.some((s: { type: string }) => s.type === 'research')).toBe(true);
    });

    it('shows error when .kata/ does not exist', async () => {
      const noKataDir = join(tmpdir(), `kata-no-kata-${Date.now()}`);
      mkdirSync(noKataDir, { recursive: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', noKataDir, 'step', 'list']);

      expect(errorSpy).toHaveBeenCalled();
      rmSync(noKataDir, { recursive: true, force: true });
    });

    it('filters by step type when --type is passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'list', '--type', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build');
      expect(output).not.toContain('research');
    });

    it('accepts --ryu as silent alias for --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'list', '--ryu', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build');
    });

    it('returns all steps when --flavor not passed', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.some((s: { type: string }) => s.type === 'research')).toBe(true);
      expect(parsed.some((s: { type: string }) => s.type === 'build')).toBe(true);
    });

    it('returns empty message when --type has no matching steps', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'list', '--type', 'nonexistent']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No steps found');
    });

    it('accepts waza alias', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'waza', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });
  });

  // ---- step inspect ----

  describe('step inspect', () => {
    it('shows step detail when type is provided', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'inspect', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Step: research');
      expect(output).toContain('Research step');
    });

    it('shows flavored step detail with --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'inspect', 'build', '--flavor', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Step: build (typescript)');
    });

    it('uses --ryu as alias for --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'inspect', 'build', '--ryu', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('build (typescript)');
    });

    it('shows step as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'inspect', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('research');
    });

    it('shows error for unknown step', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'inspect', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('launches wizard when type is omitted', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce(sampleStep as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'inspect']);

      expect(select).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('research');
    });
  });

  // ---- step create --from-file ----

  describe('step create --from-file', () => {
    it('creates a step from a valid JSON file', async () => {
      const stepDef = { type: 'from-file-step', description: 'Loaded from file' };
      const filePath = join(baseDir, 'step-def.json');
      writeFileSync(filePath, JSON.stringify(stepDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'create', '--from-file', filePath]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('from-file-step');
      expect(existsSync(join(stagesDir, 'from-file-step.json'))).toBe(true);
    });

    it('outputs JSON when --json flag is set', async () => {
      const stepDef = { type: 'json-file-step' };
      const filePath = join(baseDir, 'step-json.json');
      writeFileSync(filePath, JSON.stringify(stepDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'create', '--from-file', filePath]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('json-file-step');
    });

    it('shows error when file contains invalid step definition', async () => {
      const filePath = join(baseDir, 'bad-step.json');
      writeFileSync(filePath, JSON.stringify({ type: '' }, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'create', '--from-file', filePath]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows error when file path does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'create', '--from-file', '/nonexistent/path.json']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('creates a flavored step from file', async () => {
      const stepDef = { type: 'build', flavor: 'wasm', description: 'WASM build' };
      const filePath = join(baseDir, 'wasm-step.json');
      writeFileSync(filePath, JSON.stringify(stepDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'create', '--from-file', filePath]);

      expect(existsSync(join(stagesDir, 'build.wasm.json'))).toBe(true);
    });
  });

  // ---- step edit ----

  describe('step edit', () => {
    it('opens field-menu and saves when "Save and exit" selected with no changes', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit', 'research']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('updated successfully');
      expect(output).toContain('research');
    });

    it('cancels edit when "Cancel" is selected', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('cancel' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit', 'research']);

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
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'edit', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].description).toBe('Updated description');
    });

    it('outputs updated step as JSON', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'edit', 'research']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('research');
    });

    it('edits a flavored step with --flavor', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'edit', 'build', '--flavor', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].type).toBe('build');
      expect(parsed[0].flavor).toBe('typescript');
    });

    it('accepts --ryu as alias for --flavor on edit', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'edit', 'build', '--ryu', 'typescript']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].flavor).toBe('typescript');
    });

    it('shows error when editing a non-existent step', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('persists changes to disk', async () => {
      const { select, input } = await import('@inquirer/prompts');
      vi.mocked(select)
        .mockResolvedValueOnce('description' as never)
        .mockResolvedValueOnce('save' as never);
      vi.mocked(input).mockResolvedValueOnce('Persisted change');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit', 'research']);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'research.json'), 'utf-8'));
      expect(raw.description).toBe('Persisted change');
    });

    it('launches wizard when type is omitted', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select)
        .mockResolvedValueOnce(sampleStep as never)
        .mockResolvedValueOnce('save' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit']);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('updated successfully');
    });

    it('prints "Editing step:" to console.log (not console.error)', async () => {
      const { select } = await import('@inquirer/prompts');
      vi.mocked(select).mockResolvedValueOnce('cancel' as never);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'edit', 'research']);

      const logMessages = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(logMessages).toContain('Editing step: research');
      const errMessages = errorSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(errMessages).not.toContain('Editing step');
    });
  });

  // ---- step delete ----

  describe('step delete', () => {
    it('deletes a step with --force (no confirmation)', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'research', '--force']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('deleted');
    });

    it('prompts for confirmation and deletes when confirmed', async () => {
      const { confirm } = await import('@inquirer/prompts');
      vi.mocked(confirm).mockResolvedValueOnce(true);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'research']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
    });

    it('cancels when confirmation is denied', async () => {
      const { confirm } = await import('@inquirer/prompts');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'research']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(true);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('Cancelled');
    });

    it('shows error when step does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'nonexistent', '--force']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('deletes a flavored step with --flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'build', '--flavor', 'typescript', '--force']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'build.json'))).toBe(true);
    });

    it('accepts wasure as alias for delete', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'wasure', 'research', '--force']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
    });

    it('accepts --ryu as alias for --flavor on delete', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'delete', 'build', '--ryu', 'typescript', '--force']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'build.json'))).toBe(true);
    });

    it('accepts wasure with --ryu alias', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'wasure', 'build', '--ryu', 'typescript', '--force']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
    });
  });

  // ---- step rename ----

  describe('step rename', () => {
    it('renames a base step type', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'research', 'analysis']);

      expect(existsSync(join(stagesDir, 'research.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'analysis.json'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'analysis.json'), 'utf-8'));
      expect(raw.type).toBe('analysis');
    });

    it('renames a flavored step', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'build', 'compile', '--flavor', 'typescript']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'compile.typescript.json'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'compile.typescript.json'), 'utf-8'));
      expect(raw.type).toBe('compile');
      expect(raw.flavor).toBe('typescript');
    });

    it('renames both type and flavor with --new-flavor', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'step', 'rename', 'build', 'compile',
        '--flavor', 'typescript', '--new-flavor', 'ts',
      ]);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'compile.ts.json'))).toBe(true);
    });

    it('does not affect sibling steps during rename', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'research', 'analysis']);

      expect(existsSync(join(stagesDir, 'build.json'))).toBe(true);
      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(true);
    });

    it('accepts --ryu as alias for --flavor on rename', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'build', 'compile', '--ryu', 'typescript']);

      expect(existsSync(join(stagesDir, 'build.typescript.json'))).toBe(false);
      expect(existsSync(join(stagesDir, 'compile.typescript.json'))).toBe(true);
    });

    it('accepts --new-ryu as alias for --new-flavor on rename', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'step', 'rename', 'build', 'compile',
        '--flavor', 'typescript', '--new-ryu', 'ts',
      ]);

      expect(existsSync(join(stagesDir, 'compile.ts.json'))).toBe(true);
    });

    it('shows error when renaming to a type that already exists', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'build', 'research']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows error when source step does not exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'nonexistent', 'something']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('renames prompt template file when step has one', async () => {
      const stepWithPrompt = {
        type: 'design',
        description: 'Design step',
        artifacts: [],
        learningHooks: [],
        config: {},
        promptTemplate: '../prompts/design.md',
      };
      const promptsDir = join(kataDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(stagesDir, 'design.json'), JSON.stringify(stepWithPrompt, null, 2));
      writeFileSync(join(promptsDir, 'design.md'), '# Design prompt', 'utf-8');

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'step', 'rename', 'design', 'blueprint']);

      expect(existsSync(join(promptsDir, 'design.md'))).toBe(false);
      expect(existsSync(join(promptsDir, 'blueprint.md'))).toBe(true);

      const raw = JSON.parse(readFileSync(join(stagesDir, 'blueprint.json'), 'utf-8'));
      expect(raw.promptTemplate).toBe('../prompts/blueprint.md');
    });
  });

  // ---- step next ----

  describe('step next', () => {
    const runsDir = join(kataDir, 'runs');

    function makeRun(overrides: Partial<Run> = {}): Run {
      return {
        id: randomUUID(),
        cycleId: randomUUID(),
        betId: randomUUID(),
        betPrompt: 'Implement auth',
        stageSequence: ['research', 'plan'],
        currentStage: null,
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    beforeEach(() => {
      mkdirSync(runsDir, { recursive: true });
    });

    it('returns complete status for a completed run', async () => {
      const run = makeRun({ status: 'completed' });
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('complete');
    });

    it('returns failed status for a failed run', async () => {
      const run = makeRun({ status: 'failed', completedAt: '2026-01-02T00:00:00.000Z' });
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('failed');
    });

    it('returns waiting status when no flavors selected', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('waiting');
      expect(output.message).toContain('No flavors selected');
    });

    it('returns waiting with gate info when pendingGate exists', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'research');
      stageState.pendingGate = {
        gateId: 'gate-001',
        gateType: 'human-approved',
        requiredBy: 'stage',
      };
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('waiting');
      expect(output.gate.gateId).toBe('gate-001');
    });

    it('errors when run is not found', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir, 'step', 'next', randomUUID(),
      ]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns step info when flavor is selected and step exists', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const stageState = readStageState(runsDir, run.id, 'research');
      stageState.selectedFlavors = ['research'];
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.runId).toBe(run.id);
      expect(output.stage).toBe('research');
      expect(output.flavor).toBe('research');
      expect(output.step).toBeDefined();
      expect(output.betPrompt).toBe('Implement auth');
    });

    it('uses currentStage from run when set (not defaulting to first stage)', async () => {
      const run = makeRun({ currentStage: 'plan' });
      createRunTree(runsDir, run);

      // Set up flavors on the 'plan' stage (not 'research')
      const planState = readStageState(runsDir, run.id, 'plan');
      planState.selectedFlavors = ['research'];
      planState.status = 'running';
      writeStageState(runsDir, run.id, planState);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.stage).toBe('plan');
    });

    it('includes priorStageSyntheses for completed previous stages', async () => {
      // Run with research completed and plan as current stage
      const run = makeRun({ currentStage: 'plan' });
      createRunTree(runsDir, run);

      // Mark research as completed
      const researchState = readStageState(runsDir, run.id, 'research');
      researchState.status = 'completed';
      writeStageState(runsDir, run.id, researchState);

      // Set up plan stage with a flavor
      const planState = readStageState(runsDir, run.id, 'plan');
      planState.selectedFlavors = ['research'];
      planState.status = 'running';
      writeStageState(runsDir, run.id, planState);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.stage).toBe('plan');
      expect(output.priorStageSyntheses).toHaveLength(1);
      expect(output.priorStageSyntheses[0].stage).toBe('research');
    });

    it('loads prompt from .kata/prompts/ when step has a promptTemplate', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      // Write a step definition with a promptTemplate using the relative convention
      const stepDef = {
        type: 'research',
        description: 'Fallback description',
        artifacts: [],
        learningHooks: [],
        config: {},
        promptTemplate: '../prompts/research.md',
      };
      writeFileSync(join(stagesDir, 'research.json'), JSON.stringify(stepDef, null, 2));

      // Write the prompt file at .kata/prompts/research.md
      const promptsDir = join(kataDir, 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, 'research.md'), '# Research prompt for {{betPrompt}}', 'utf-8');

      const stageState = readStageState(runsDir, run.id, 'research');
      stageState.selectedFlavors = ['research'];
      stageState.status = 'running';
      writeStageState(runsDir, run.id, stageState);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'step', 'next', run.id]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      // Prompt should be the file content with betPrompt interpolated, not the fallback description
      expect(output.prompt).toContain('Research prompt for');
      expect(output.prompt).toContain(run.betPrompt);
      expect(output.prompt).not.toBe('Fallback description');
    });
  });

  // ---- step complete ----

  describe('step complete', () => {
    let runsDir: string;

    function makeRun(overrides: Partial<Run> = {}): Run {
      return {
        id: randomUUID(),
        cycleId: randomUUID(),
        betId: randomUUID(),
        betPrompt: 'Do work',
        stageSequence: ['plan', 'build'],
        currentStage: 'plan',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      };
    }

    beforeEach(() => {
      runsDir = join(kataDir, 'runs');
      mkdirSync(runsDir, { recursive: true });
    });

    it('marks a new step as completed and writes FlavorState', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'plan', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.stage).toBe('plan');
      expect(output.flavor).toBe('shaping');
      expect(output.step).toBe('shaping');
      expect(output.status).toBe('completed');

      const flavorState = readFlavorState(runsDir, run.id, 'plan', 'shaping');
      expect(flavorState?.status).toBe('completed');
      expect(flavorState?.steps[0]?.type).toBe('shaping');
      expect(flavorState?.steps[0]?.status).toBe('completed');
    });

    it('marks step completed in non-JSON mode', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'plan', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('marked as completed')
      );
    });

    it('is idempotent when step already completed (non-JSON warns, does not re-write)', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      // Write an already-completed flavor state
      writeFlavorState(runsDir, run.id, 'plan', {
        name: 'shaping',
        stageCategory: 'plan',
        status: 'completed',
        steps: [{ type: 'shaping', status: 'completed', artifacts: [], startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' }],
        currentStep: null,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'plan', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('already completed'));
      warnSpy.mockRestore();

      // State unchanged — no extra writes happened
      const flavorState = readFlavorState(runsDir, run.id, 'plan', 'shaping');
      expect(flavorState?.status).toBe('completed');
      expect(consoleSpy).not.toHaveBeenCalled();
    });

    it('returns completed JSON without warning when step already completed in --json mode', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      writeFlavorState(runsDir, run.id, 'plan', {
        name: 'shaping',
        stageCategory: 'plan',
        status: 'completed',
        steps: [{ type: 'shaping', status: 'completed', artifacts: [], startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' }],
        currentStep: null,
      });

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'plan', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      // JSON output with completed status, no warnings
      const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
      expect(output.status).toBe('completed');
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('errors when run does not exist', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'step', 'complete', randomUUID(),
        '--stage', 'plan', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('keeps flavor status running when other steps remain pending', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      // Pre-populate two steps: one pending, one we'll complete
      writeFlavorState(runsDir, run.id, 'plan', {
        name: 'api-design',
        stageCategory: 'plan',
        status: 'running',
        steps: [
          { type: 'shaping', status: 'pending', artifacts: [] },
          { type: 'impl-planning', status: 'pending', artifacts: [] },
        ],
        currentStep: 0,
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'plan', '--flavor', 'api-design', '--step', 'shaping',
      ]);

      const flavorState = readFlavorState(runsDir, run.id, 'plan', 'api-design');
      expect(flavorState?.status).toBe('running');
      expect(flavorState?.steps.find((s) => s.type === 'shaping')?.status).toBe('completed');
      expect(flavorState?.steps.find((s) => s.type === 'impl-planning')?.status).toBe('pending');
    });

    it('errors on invalid stage category', async () => {
      const run = makeRun();
      createRunTree(runsDir, run);

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'step', 'complete', run.id,
        '--stage', 'invalid', '--flavor', 'shaping', '--step', 'shaping',
      ]);

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid stage category'));
    });
  });
});
