import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { PipelineSchema, PipelineTemplateSchema, type Pipeline } from '@domain/types/pipeline.js';
import { StepSchema, type Step } from '@domain/types/step.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { registerPipelineCommands } from './pipeline.js';

describe('registerPipelineCommands', () => {
  let kataDir: string;
  let parentDir: string;
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parentDir = mkdtempSync(join(tmpdir(), 'kata-cli-pipeline-'));
    kataDir = join(parentDir, '.kata');

    // Create required directories
    JsonStore.ensureDir(join(kataDir, 'pipelines'));
    JsonStore.ensureDir(join(kataDir, 'stages'));
    JsonStore.ensureDir(join(kataDir, 'templates'));
    JsonStore.ensureDir(join(kataDir, 'knowledge', 'learnings'));
    JsonStore.ensureDir(join(kataDir, 'tracking'));
    JsonStore.ensureDir(join(kataDir, 'history'));

    // Create program with global options; suppress exit on errors
    program = new Command();
    program
      .name('kata')
      .option('--json', 'Output in JSON format')
      .option('--verbose', 'Verbose output')
      .option('--cwd <path>', 'Working directory')
      .exitOverride(); // Prevent process.exit in tests

    registerPipelineCommands(program);

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    rmSync(parentDir, { recursive: true, force: true });
  });

  function registerStage(stage: Step): void {
    const filename = stage.flavor ? `${stage.type}.${stage.flavor}.json` : `${stage.type}.json`;
    JsonStore.write(join(kataDir, 'stages', filename), stage, StepSchema);
  }

  function createPipeline(overrides?: Partial<Pipeline>): Pipeline {
    const now = new Date().toISOString();
    const pipeline: Pipeline = PipelineSchema.parse({
      id: randomUUID(),
      name: 'test-pipeline',
      type: 'vertical',
      stages: [
        { stageRef: { type: 'research' }, state: 'complete', artifacts: [] },
        { stageRef: { type: 'build' }, state: 'pending', artifacts: [] },
      ],
      state: 'active',
      currentStageIndex: 1,
      metadata: { issueRefs: [] },
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
    JsonStore.write(
      join(kataDir, 'pipelines', `${pipeline.id}.json`),
      pipeline,
      PipelineSchema,
    );
    return pipeline;
  }

  describe('pipeline status', () => {
    it('should list all pipelines when no ID given', async () => {
      createPipeline({ name: 'pipeline-a' });
      createPipeline({ name: 'pipeline-b' });

      await program.parseAsync(
        ['pipeline', 'status', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('pipeline-a');
      expect(output).toContain('pipeline-b');
    });

    it('should show single pipeline when ID given', async () => {
      const pipeline = createPipeline({ name: 'my-pipeline' });

      await program.parseAsync(
        ['pipeline', 'status', pipeline.id, '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('my-pipeline');
      expect(output).toContain(pipeline.id);
    });

    it('should output JSON when --json flag is set', async () => {
      const pipeline = createPipeline({ name: 'json-test' });

      await program.parseAsync(
        ['--json', 'pipeline', 'status', pipeline.id, '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.id).toBe(pipeline.id);
      expect(parsed.name).toBe('json-test');
    });

    it('should error for non-existent pipeline ID', async () => {
      await program.parseAsync(
        ['pipeline', 'status', 'nonexistent-id', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline not found'),
      );
    });

    it('should show empty list when no pipelines exist', async () => {
      await program.parseAsync(
        ['pipeline', 'status', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('No pipelines found');
    });
  });

  describe('pipeline prep', () => {
    it('should create a pipeline from stage names', async () => {
      registerStage({ type: 'research', artifacts: [], learningHooks: [], config: {} });
      registerStage({ type: 'build', artifacts: [], learningHooks: [], config: {} });

      await program.parseAsync(
        ['pipeline', 'prep', 'my-flow', 'research', 'build', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('my-flow');
      expect(output).toContain('2 stages');
    });

    it('should output JSON when --json flag is set', async () => {
      registerStage({ type: 'research', artifacts: [], learningHooks: [], config: {} });

      await program.parseAsync(
        ['--json', 'pipeline', 'prep', 'json-flow', 'research', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.name).toBe('json-flow');
    });

    it('should error when a stage does not exist', async () => {
      await program.parseAsync(
        ['pipeline', 'prep', 'broken-flow', 'nonexistent-stage', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('should handle flavored stage references', async () => {
      registerStage({ type: 'build', flavor: 'frontend', artifacts: [], learningHooks: [], config: {} });

      await program.parseAsync(
        ['pipeline', 'prep', 'flavored-flow', 'build:frontend', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('flavored-flow');
    });
  });

  describe('pipeline start', () => {
    it('should error when no template found for type', async () => {
      await program.parseAsync(
        ['pipeline', 'start', 'vertical', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errMsg = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(errMsg).toContain('No template found');
    });

    it('should error for invalid pipeline type', async () => {
      await program.parseAsync(
        ['pipeline', 'start', 'invalid-type', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleErrorSpy).toHaveBeenCalled();
      const errMsg = consoleErrorSpy.mock.calls[0]?.[0] as string;
      expect(errMsg).toContain('No template found');
    });

    it('should start pipeline from a template', async () => {
      // Register a stage
      registerStage({ type: 'research', artifacts: [], learningHooks: [], config: {} });

      // Create a template
      const template = {
        name: 'vertical-template',
        type: 'vertical' as const,
        stages: [{ type: 'research' }],
      };
      JsonStore.write(
        join(kataDir, 'templates', 'vertical.json'),
        template,
        PipelineTemplateSchema,
      );

      await program.parseAsync(
        ['pipeline', 'start', 'vertical', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('completed successfully');
    });
  });

  describe('pipeline approve', () => {
    it('should set humanApprovedAt on the current stage and persist', async () => {
      const pipeline = createPipeline({
        stages: [
          { stageRef: { type: 'shape' }, state: 'active' as const, artifacts: [] },
          { stageRef: { type: 'build' }, state: 'pending' as const, artifacts: [] },
        ],
        currentStageIndex: 0,
      });

      await program.parseAsync(
        ['pipeline', 'approve', pipeline.id, '--cwd', parentDir],
        { from: 'user' },
      );

      const updated = JsonStore.read(
        join(kataDir, 'pipelines', `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(updated.stages[0]?.humanApprovedAt).toBeDefined();
      expect(typeof updated.stages[0]?.humanApprovedAt).toBe('string');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('approved'),
      );
    });

    it('should error for non-existent pipeline ID', async () => {
      await program.parseAsync(
        ['pipeline', 'approve', 'nonexistent-id', '--cwd', parentDir],
        { from: 'user' },
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Pipeline not found'),
      );
    });
  });
});
