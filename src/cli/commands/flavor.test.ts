import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerFlavorCommands } from './flavor.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn().mockResolvedValue(''),
  confirm: vi.fn().mockResolvedValue(false),
  select: vi.fn().mockResolvedValue('build'),
  checkbox: vi.fn().mockResolvedValue([]),
}));

describe('registerFlavorCommands', () => {
  const baseDir = join(tmpdir(), `kata-flavor-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const flavorsDir = join(kataDir, 'flavors');
  const stagesDir = join(kataDir, 'stages');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  const sampleFlavor = {
    name: 'typescript-tdd',
    description: 'TDD build for TypeScript',
    stageCategory: 'build',
    steps: [{ stepName: 'tdd-scaffold', stepType: 'build' }],
    synthesisArtifact: 'build-output',
  };

  const reviewFlavor = {
    name: 'security-audit',
    description: 'Security-focused review',
    stageCategory: 'review',
    steps: [{ stepName: 'audit-scan', stepType: 'review' }],
    synthesisArtifact: 'security-report',
  };

  beforeEach(() => {
    mkdirSync(flavorsDir, { recursive: true });
    mkdirSync(stagesDir, { recursive: true });
    writeFileSync(join(flavorsDir, 'build.typescript-tdd.json'), JSON.stringify(sampleFlavor, null, 2));
    writeFileSync(join(flavorsDir, 'review.security-audit.json'), JSON.stringify(reviewFlavor, null, 2));
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
    registerFlavorCommands(program);
    return program;
  }

  // ---- flavor list ----

  describe('flavor list', () => {
    it('lists all flavors', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('typescript-tdd');
      expect(output).toContain('security-audit');
    });

    it('filters by --stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'list', '--stage', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('typescript-tdd');
      expect(output).not.toContain('security-audit');
    });

    it('lists as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'flavor', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.length).toBe(2);
    });

    it('shows error for invalid --stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'list', '--stage', 'invalid']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows empty message when no flavors', async () => {
      rmSync(flavorsDir, { recursive: true, force: true });
      mkdirSync(flavorsDir, { recursive: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'list']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No flavors found');
    });

    it('accepts ryu alias', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'ryu', 'list']);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('typescript-tdd');
    });
  });

  // ---- flavor inspect ----

  describe('flavor inspect', () => {
    it('shows flavor detail with --stage', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'inspect', 'typescript-tdd', '--stage', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Flavor: typescript-tdd');
      expect(output).toContain('Stage: build');
      expect(output).toContain('tdd-scaffold');
    });

    it('finds flavor without --stage by searching all categories', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'inspect', 'security-audit']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Flavor: security-audit');
      expect(output).toContain('Stage: review');
    });

    it('shows flavor as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'flavor', 'inspect', 'typescript-tdd', '--stage', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].name).toBe('typescript-tdd');
    });

    it('shows error for unknown flavor', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'inspect', 'nonexistent']);

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  // ---- flavor create --from-file ----

  describe('flavor create --from-file', () => {
    it('creates a flavor from a JSON file', async () => {
      const flavorDef = {
        name: 'new-flavor',
        stageCategory: 'plan',
        steps: [{ stepName: 'outline', stepType: 'plan' }],
        synthesisArtifact: 'plan-doc',
      };
      const filePath = join(baseDir, 'flavor-def.json');
      writeFileSync(filePath, JSON.stringify(flavorDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'create', '--from-file', filePath]);

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('new-flavor');
      expect(existsSync(join(flavorsDir, 'plan.new-flavor.json'))).toBe(true);
    });

    it('outputs JSON when --json flag is set', async () => {
      const flavorDef = {
        name: 'json-flavor',
        stageCategory: 'research',
        steps: [{ stepName: 'gather', stepType: 'research' }],
        synthesisArtifact: 'research-doc',
      };
      const filePath = join(baseDir, 'json-flavor.json');
      writeFileSync(filePath, JSON.stringify(flavorDef, null, 2));

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'flavor', 'create', '--from-file', filePath]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed[0].name).toBe('json-flavor');
    });
  });

  // ---- flavor delete ----

  describe('flavor delete', () => {
    it('deletes with --force', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'delete', 'typescript-tdd', '--stage', 'build', '--force']);

      expect(existsSync(join(flavorsDir, 'build.typescript-tdd.json'))).toBe(false);
      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('deleted');
    });

    it('shows error when --stage is missing', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'delete', 'typescript-tdd', '--force']);

      expect(errorSpy).toHaveBeenCalled();
      const errOutput = errorSpy.mock.calls[0]?.[0] as string;
      expect(errOutput).toContain('--stage');
    });

    it('cancels when confirmation is denied', async () => {
      const { confirm } = await import('@inquirer/prompts');
      vi.mocked(confirm).mockResolvedValueOnce(false);

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'delete', 'typescript-tdd', '--stage', 'build']);

      expect(existsSync(join(flavorsDir, 'build.typescript-tdd.json'))).toBe(true);
    });
  });

  // ---- flavor validate ----

  describe('flavor validate', () => {
    it('validates a flavor structurally', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'validate', 'typescript-tdd', '--stage', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('valid');
    });

    it('shows error when --stage is missing', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'flavor', 'validate', 'typescript-tdd']);

      expect(errorSpy).toHaveBeenCalled();
    });

    it('shows validation result as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'flavor', 'validate', 'typescript-tdd', '--stage', 'build']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('valid');
    });
  });
});
