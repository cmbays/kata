import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Pipeline } from '@domain/types/pipeline.js';
import type { Stage } from '@domain/types/stage.js';
import type { ExecutionResult } from '@domain/types/manifest.js';
import type { Learning } from '@domain/types/learning.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { PipelineSchema } from '@domain/types/pipeline.js';
import { PipelineRunner, type PipelineRunnerDeps } from './pipeline-runner.js';

describe('PipelineRunner', () => {
  let basePath: string;
  let pipelineDir: string;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'kata-pipeline-runner-'));
    pipelineDir = join(basePath, 'pipelines');
    JsonStore.ensureDir(pipelineDir);
  });

  afterEach(() => {
    rmSync(basePath, { recursive: true, force: true });
  });

  /**
   * Create a simple stage definition for testing.
   */
  function makeStage(type: string, overrides?: Partial<Stage>): Stage {
    return {
      type,
      artifacts: [],
      learningHooks: [],
      config: {},
      ...overrides,
    };
  }

  /**
   * Create a test pipeline with the given stage types.
   */
  function makePipeline(stageTypes: string[], overrides?: Partial<Pipeline>): Pipeline {
    const now = new Date().toISOString();
    return {
      id: randomUUID(),
      name: 'test-pipeline',
      type: 'vertical',
      stages: stageTypes.map((type) => ({
        stageRef: { type },
        state: 'pending' as const,
        artifacts: [],
      })),
      state: 'draft',
      currentStageIndex: 0,
      metadata: { issueRefs: [] },
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  /**
   * Create a mock execution result.
   */
  function makeExecResult(overrides?: Partial<ExecutionResult>): ExecutionResult {
    return {
      success: true,
      artifacts: [],
      completedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  /**
   * Create mock dependencies with sensible defaults.
   */
  function makeDeps(overrides?: Partial<PipelineRunnerDeps>): PipelineRunnerDeps {
    const stageMap = new Map<string, Stage>();

    const mockStageRegistry = {
      get: vi.fn((type: string, _flavor?: string) => {
        const stage = stageMap.get(type);
        if (!stage) throw new Error(`Stage not found: ${type}`);
        return stage;
      }),
      register: vi.fn(),
      list: vi.fn(() => []),
      loadBuiltins: vi.fn(),
      loadCustom: vi.fn(),
    };

    const mockKnowledgeStore = {
      loadForStage: vi.fn((): Learning[] => []),
      loadForSubscriptions: vi.fn((): Learning[] => []),
      loadForAgent: vi.fn((): Learning[] => []),
      capture: vi.fn(),
      get: vi.fn(),
      query: vi.fn(() => []),
      update: vi.fn(),
      stats: vi.fn(),
      subscriptions: {} as never,
    };

    const execResult = makeExecResult();
    const mockAdapter = {
      name: 'mock',
      execute: vi.fn(async () => execResult),
    };

    const mockAdapterResolver = {
      resolve: vi.fn(() => mockAdapter),
    };

    const mockResultCapturer = {
      capture: vi.fn((opts: { pipelineId: string; stageIndex: number }) => ({
        id: randomUUID(),
        pipelineId: opts.pipelineId,
        stageType: 'test',
        stageIndex: opts.stageIndex,
        adapter: 'mock',
        artifactNames: [],
        learningIds: [],
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      })),
      getForPipeline: vi.fn(() => []),
      listAll: vi.fn(() => []),
    };

    const mockTokenTracker = {
      recordUsage: vi.fn(),
      getUsage: vi.fn(),
      getTotalUsage: vi.fn(() => 0),
      checkBudget: vi.fn(() => []),
    };

    const mockManifestBuilder = {
      build: vi.fn((stage: Stage, context: unknown) => ({
        stageType: stage.type,
        stageFlavor: stage.flavor,
        prompt: `Execute ${stage.type}`,
        context,
        artifacts: stage.artifacts,
        learnings: [],
      })),
      resolveRefs: vi.fn((template: string) => template),
      attachGates: vi.fn((stage: Stage) => ({
        entryGate: stage.entryGate,
        exitGate: stage.exitGate,
      })),
      injectLearnings: vi.fn(() => ''),
    };

    return {
      stageRegistry: mockStageRegistry as unknown as PipelineRunnerDeps['stageRegistry'],
      knowledgeStore: mockKnowledgeStore as unknown as PipelineRunnerDeps['knowledgeStore'],
      adapterResolver: mockAdapterResolver as unknown as PipelineRunnerDeps['adapterResolver'],
      resultCapturer: mockResultCapturer as unknown as PipelineRunnerDeps['resultCapturer'],
      tokenTracker: mockTokenTracker as unknown as PipelineRunnerDeps['tokenTracker'],
      manifestBuilder: mockManifestBuilder as unknown as typeof import('@domain/services/manifest-builder.js').ManifestBuilder,
      persistPipeline: (p: Pipeline) =>
        JsonStore.write(join(pipelineDir, `${p.id}.json`), p, PipelineSchema),
      ...overrides,
    };
  }

  /**
   * Helper to register stages in the mock registry.
   */
  function registerStages(deps: PipelineRunnerDeps, stages: Stage[]): void {
    const registry = deps.stageRegistry as unknown as { get: ReturnType<typeof vi.fn> };
    registry.get.mockImplementation((type: string) => {
      const found = stages.find((s) => s.type === type);
      if (!found) throw new Error(`Stage not found: ${type}`);
      return found;
    });
  }

  describe('happy path', () => {
    it('should complete a pipeline with a single stage', async () => {
      const deps = makeDeps();
      const stage = makeStage('research');
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(1);
      expect(result.stagesTotal).toBe(1);
      expect(result.historyIds).toHaveLength(1);
      expect(result.abortedAt).toBeUndefined();
    });

    it('should complete a pipeline with multiple stages', async () => {
      const deps = makeDeps();
      registerStages(deps, [
        makeStage('research'),
        makeStage('shape'),
        makeStage('build'),
      ]);
      const pipeline = makePipeline(['research', 'shape', 'build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(3);
      expect(result.stagesTotal).toBe(3);
      expect(result.historyIds).toHaveLength(3);
    });

    it('should execute adapter for each stage', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      const adapter = deps.adapterResolver.resolve();
      expect(adapter.execute).toHaveBeenCalledTimes(2);
    });

    it('should build manifest for each stage', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.manifestBuilder.build).toHaveBeenCalledTimes(2);
    });

    it('should capture results for each stage', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.resultCapturer.capture).toHaveBeenCalledTimes(2);
    });
  });

  describe('pipeline state tracking', () => {
    it('should set pipeline state to active when starting', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      expect(pipeline.state).toBe('draft');

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      // After run, pipeline should be 'complete'
      const persisted = JsonStore.read(
        join(pipelineDir, `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(persisted.state).toBe('complete');
    });

    it('should mark each stage as complete', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      const persisted = JsonStore.read(
        join(pipelineDir, `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(persisted.stages[0]?.state).toBe('complete');
      expect(persisted.stages[1]?.state).toBe('complete');
    });

    it('should set startedAt and completedAt on stages', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      const persisted = JsonStore.read(
        join(pipelineDir, `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(persisted.stages[0]?.startedAt).toBeDefined();
      expect(persisted.stages[0]?.completedAt).toBeDefined();
    });

    it('should persist pipeline to disk after each stage', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      const filePath = join(pipelineDir, `${pipeline.id}.json`);
      expect(JsonStore.exists(filePath)).toBe(true);
    });
  });

  describe('gate evaluation', () => {
    it('should abort pipeline when entry gate fails (no promptFn)', async () => {
      const deps = makeDeps();
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'predecessor-complete', predecessorType: 'research' },
          ],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      // Pipeline has no completed stages, so predecessor-complete will fail
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(false);
      expect(result.stagesCompleted).toBe(0);
      expect(result.abortedAt).toBe(0);
    });

    it('should skip stage when promptFn returns skip', async () => {
      const deps = makeDeps({
        promptFn: {
          gateOverride: vi.fn(async () => 'skip' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'predecessor-complete', predecessorType: 'research' },
          ],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // The stage was skipped, not aborted
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(0); // skip doesn't count as completed
      expect(result.abortedAt).toBeUndefined();

      const persisted = JsonStore.read(
        join(pipelineDir, `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(persisted.stages[0]?.state).toBe('skipped');
      expect(persisted.state).toBe('complete');
    });

    it('should abort pipeline when promptFn returns abort', async () => {
      const deps = makeDeps({
        promptFn: {
          gateOverride: vi.fn(async () => 'abort' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'artifact-exists', artifactName: 'missing' },
          ],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(false);
      expect(result.abortedAt).toBe(0);

      const persisted = JsonStore.read(
        join(pipelineDir, `${pipeline.id}.json`),
        PipelineSchema,
      );
      expect(persisted.state).toBe('abandoned');
      expect(persisted.stages[0]?.state).toBe('failed');
    });

    it('should pass entry gate when conditions are satisfied', async () => {
      const deps = makeDeps();
      const research = makeStage('research');
      const build = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'predecessor-complete', predecessorType: 'research' },
          ],
          required: true,
        },
      });
      registerStages(deps, [research, build]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // research completes first, then build entry gate passes
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(2);
    });

    it('should pass non-required gates even when conditions fail', async () => {
      const deps = makeDeps();
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'artifact-exists', artifactName: 'missing' },
          ],
          required: false, // non-required gate
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(1);
    });

    it('should handle exit gate failure with abort', async () => {
      const deps = makeDeps();
      const stage = makeStage('research', {
        exitGate: {
          type: 'exit',
          conditions: [
            { type: 'artifact-exists', artifactName: 'missing-output' },
          ],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // Default behavior aborts on exit gate failure
      expect(result.success).toBe(false);
      expect(result.abortedAt).toBe(0);
    });

    it('should handle exit gate failure with skip', async () => {
      const deps = makeDeps({
        promptFn: {
          gateOverride: vi.fn(async () => 'skip' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('research', {
        exitGate: {
          type: 'exit',
          conditions: [
            { type: 'artifact-exists', artifactName: 'missing-output' },
          ],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // Skip on exit gate means we captured the result but then skipped marking it complete
      expect(result.success).toBe(true);
      expect(result.historyIds).toHaveLength(1); // result was still captured
    });
  });

  describe('token tracking', () => {
    it('should record token usage when result includes it', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);

      // Mock adapter to return token usage
      const mockAdapter = deps.adapterResolver.resolve();
      (mockAdapter.execute as ReturnType<typeof vi.fn>).mockResolvedValue({
        success: true,
        artifacts: [],
        completedAt: new Date().toISOString(),
        tokenUsage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          total: 1500,
        },
      } satisfies ExecutionResult);

      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.tokenTracker.recordUsage).toHaveBeenCalledWith(
        expect.stringContaining(pipeline.id),
        expect.objectContaining({ total: 1500 }),
      );
    });

    it('should not record token usage when result has none', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.tokenTracker.recordUsage).not.toHaveBeenCalled();
    });
  });

  describe('knowledge integration', () => {
    it('should load learnings for each stage', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.knowledgeStore.loadForStage).toHaveBeenCalledWith('research');
      expect(deps.knowledgeStore.loadForStage).toHaveBeenCalledWith('build');
    });

    it('should load subscribed learnings', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.knowledgeStore.loadForSubscriptions).toHaveBeenCalledWith('default');
    });

    it('should capture learning when promptFn provides content', async () => {
      const deps = makeDeps({
        promptFn: {
          gateOverride: vi.fn(async () => 'abort' as const),
          captureLearning: vi.fn(async () => 'Learned something useful'),
        },
      });
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.knowledgeStore.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: 'stage',
          category: 'research',
          content: 'Learned something useful',
          stageType: 'research',
        }),
      );
    });

    it('should not capture learning when promptFn returns null', async () => {
      const deps = makeDeps({
        promptFn: {
          gateOverride: vi.fn(async () => 'abort' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.knowledgeStore.capture).not.toHaveBeenCalled();
    });
  });

  describe('cycle/bet metadata', () => {
    it('should pass cycle and bet IDs to result capturer', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);

      const cycleId = randomUUID();
      const betId = randomUUID();
      const pipeline = makePipeline(['research'], {
        metadata: { issueRefs: [], cycleId, betId },
      });

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.resultCapturer.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          cycleId,
          betId,
        }),
      );
    });
  });

  describe('artifact tracking across stages', () => {
    it('should include artifacts from completed stages in gate context', async () => {
      const deps = makeDeps();

      // Adapter returns artifacts for the first stage
      const mockAdapter = deps.adapterResolver.resolve();
      let callCount = 0;
      (mockAdapter.execute as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            success: true,
            artifacts: [{ name: 'pitch-doc', path: '/tmp/pitch.md' }],
            completedAt: new Date().toISOString(),
          };
        }
        return makeExecResult();
      });

      const research = makeStage('research');
      const build = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'artifact-exists', artifactName: 'pitch-doc' },
          ],
          required: true,
        },
      });
      registerStages(deps, [research, build]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(2);
    });
  });

  describe('pipeline result', () => {
    it('should return correct pipeline ID', async () => {
      const deps = makeDeps();
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.pipelineId).toBe(pipeline.id);
    });

    it('should report partial completion on abort', async () => {
      const deps = makeDeps();
      const research = makeStage('research');
      const build = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'human-approved' },
          ],
          required: true,
        },
      });
      registerStages(deps, [research, build]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(false);
      expect(result.stagesCompleted).toBe(1);
      expect(result.stagesTotal).toBe(2);
      expect(result.abortedAt).toBe(1);
    });
  });

  describe('lifecycle hooks', () => {
    it('should fire onStageStart before entry gate and onStageComplete after stage', async () => {
      const onStageStart = vi.fn(async () => {});
      const onStageComplete = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onStageStart, onStageComplete } });
      registerStages(deps, [makeStage('research'), makeStage('build')]);
      const pipeline = makePipeline(['research', 'build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(onStageStart).toHaveBeenCalledTimes(2);
      expect(onStageStart).toHaveBeenNthCalledWith(1, 'research', 0);
      expect(onStageStart).toHaveBeenNthCalledWith(2, 'build', 1);

      expect(onStageComplete).toHaveBeenCalledTimes(2);
      expect(onStageComplete).toHaveBeenNthCalledWith(1, 'research', 0);
      expect(onStageComplete).toHaveBeenNthCalledWith(2, 'build', 1);
    });

    it('should fire onStageFail when stage throws', async () => {
      const onStageFail = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onStageFail } });
      const stage = makeStage('research');
      registerStages(deps, [stage]);

      // Make the adapter throw
      const mockAdapter = deps.adapterResolver.resolve();
      (mockAdapter.execute as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('adapter exploded'));

      const pipeline = makePipeline(['research']);
      const runner = new PipelineRunner(deps);

      await expect(runner.run(pipeline)).rejects.toThrow('adapter exploded');
      expect(onStageFail).toHaveBeenCalledTimes(1);
      expect(onStageFail).toHaveBeenCalledWith('research', 0, expect.any(Error));
    });

    it('should fire onGateResult for entry gate', async () => {
      const onGateResult = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onGateResult } });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'schema-valid' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(onGateResult).toHaveBeenCalledTimes(1);
      const [gate, result, action] = onGateResult.mock.calls[0] as [unknown, unknown, string];
      expect(action).toBe('proceed');
      expect((result as { passed: boolean }).passed).toBe(true);
      expect((gate as { type: string }).type).toBe('entry');
    });

    it('should fire onGateResult for both entry and exit gates', async () => {
      const onGateResult = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onGateResult } });
      const stage = makeStage('research', {
        entryGate: { type: 'entry', conditions: [{ type: 'schema-valid' }], required: true },
        exitGate: { type: 'exit', conditions: [{ type: 'schema-valid' }], required: true },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(onGateResult).toHaveBeenCalledTimes(2);
      const gateTypes = onGateResult.mock.calls.map((c) => (c[0] as { type: string }).type);
      expect(gateTypes).toContain('entry');
      expect(gateTypes).toContain('exit');
    });

    it('should fire onGateResult with abort action when gate fails', async () => {
      const onGateResult = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onGateResult } });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(onGateResult).toHaveBeenCalledTimes(1);
      const [, , action] = onGateResult.mock.calls[0] as [unknown, unknown, string];
      expect(action).toBe('abort');
    });

    it('should not abort pipeline when a hook throws', async () => {
      const onStageStart = vi.fn(async () => { throw new Error('hook exploded'); });
      const onStageComplete = vi.fn(async () => { throw new Error('hook exploded'); });
      const deps = makeDeps({ hooks: { onStageStart, onStageComplete } });
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // Pipeline should still complete despite hooks throwing
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(1);
    });

    it('should not fire hooks when none are provided', async () => {
      const deps = makeDeps({ hooks: undefined });
      registerStages(deps, [makeStage('research')]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
    });

    it('should fire onGateResult with skip action when promptFn skips', async () => {
      const onGateResult = vi.fn(async () => {});
      const deps = makeDeps({
        hooks: { onGateResult },
        promptFn: {
          gateOverride: vi.fn(async () => 'skip' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(onGateResult).toHaveBeenCalledTimes(1);
      const [, , action] = onGateResult.mock.calls[0] as [unknown, unknown, string];
      expect(action).toBe('skip');
    });

    it('should exhaust retries and abort when gateOverride always returns retry', async () => {
      const gateOverride = vi.fn(async () => 'retry' as const);
      const deps = makeDeps({
        promptFn: {
          gateOverride,
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // attempt 0 + 3 retries = 4 total gateOverride calls
      expect(gateOverride).toHaveBeenCalledTimes(4);
      expect(result.success).toBe(false);
      expect(result.abortedAt).toBe(0);
    });

    it('should fire onGateResult with abort when retries are exhausted', async () => {
      const onGateResult = vi.fn(async () => {});
      const deps = makeDeps({
        hooks: { onGateResult },
        promptFn: {
          gateOverride: vi.fn(async () => 'retry' as const),
          captureLearning: vi.fn(async () => null),
        },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      const abortCalls = onGateResult.mock.calls.filter((c) => c[2] === 'abort');
      expect(abortCalls.length).toBeGreaterThan(0);
    });

    it('should fire onStageStart before gate evaluation even if gate then aborts', async () => {
      const onStageStart = vi.fn(async () => {});
      const onStageFail = vi.fn(async () => {});
      const deps = makeDeps({ hooks: { onStageStart, onStageFail } });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      // onStageStart fires before gate evaluation
      expect(onStageStart).toHaveBeenCalledTimes(1);
      expect(onStageStart).toHaveBeenCalledWith('build', 0);
      // Gate abort is not a stage exception — onStageFail must NOT fire
      expect(onStageFail).not.toHaveBeenCalled();
    });

    it('should propagate original error even when onStageFail hook itself throws', async () => {
      const onStageFail = vi.fn(async () => {
        throw new Error('hook itself exploded');
      });
      const deps = makeDeps({ hooks: { onStageFail } });
      const stage = makeStage('research');
      registerStages(deps, [stage]);

      const mockAdapter = deps.adapterResolver.resolve();
      (mockAdapter.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('original error'),
      );

      const pipeline = makePipeline(['research']);
      const runner = new PipelineRunner(deps);

      await expect(runner.run(pipeline)).rejects.toThrow('original error');
      expect(onStageFail).toHaveBeenCalledTimes(1);
    });
  });

  describe('yolo mode', () => {
    it('should bypass all gate checks when yolo is true', async () => {
      const deps = makeDeps({ yolo: true });
      // Gate requires artifact that doesn't exist — would normally abort
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing-artifact' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      // Gate bypassed, stage completes
      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(1);
    });

    it('should not call gateOverride promptFn when yolo is true', async () => {
      const gateOverride = vi.fn(async () => 'abort' as const);
      const deps = makeDeps({
        yolo: true,
        promptFn: { gateOverride, captureLearning: vi.fn(async () => null) },
      });
      const stage = makeStage('build', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'missing' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['build']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(gateOverride).not.toHaveBeenCalled();
    });
  });

  describe('prompt template resolution', () => {
    it('should resolve prompt template ref when stagesDir and refResolver are provided', async () => {
      const mockRefResolver = {
        resolveRef: vi.fn(() => '# Resolved prompt content'),
      };
      const deps = makeDeps({
        stagesDir: '/fake/stages',
        refResolver: mockRefResolver,
      });
      const stage = makeStage('research', { promptTemplate: '../prompts/research.md' });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.manifestBuilder.resolveRefs).toHaveBeenCalledWith(
        '../prompts/research.md',
        '/fake/stages',
        mockRefResolver,
      );
    });

    it('should skip resolution when stagesDir is not provided', async () => {
      const deps = makeDeps({ stagesDir: undefined });
      const stage = makeStage('research', { promptTemplate: '../prompts/research.md' });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await runner.run(pipeline);

      expect(deps.manifestBuilder.resolveRefs).not.toHaveBeenCalled();
    });

    it('should continue with path-as-is when resolution fails with RefResolutionError', async () => {
      const { RefResolutionError } = await import('@infra/config/ref-resolver.js');
      const deps = makeDeps({ stagesDir: '/fake/stages' });
      // Make manifestBuilder.resolveRefs throw RefResolutionError (the only error that falls back silently)
      vi.spyOn(deps.manifestBuilder, 'resolveRefs').mockImplementation(() => {
        throw new RefResolutionError('../prompts/missing.md', 'File not found');
      });
      const stage = makeStage('research', { promptTemplate: '../prompts/missing.md' });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      // Should not throw — falls back to path as-is for RefResolutionError
      const result = await runner.run(pipeline);
      expect(result.success).toBe(true);
    });

    it('should re-throw non-RefResolutionError errors from resolution', async () => {
      const mockRefResolver = { resolveRef: vi.fn() };
      const deps = makeDeps({ stagesDir: '/fake/stages', refResolver: mockRefResolver });
      vi.spyOn(deps.manifestBuilder, 'resolveRefs').mockImplementation(() => {
        throw new TypeError('Unexpected internal error');
      });
      const stage = makeStage('research', { promptTemplate: '../prompts/missing.md' });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['research']);

      const runner = new PipelineRunner(deps);
      await expect(runner.run(pipeline)).rejects.toThrow(TypeError);
    });
  });

  describe('human-approved gate', () => {
    it('should pass human-approved gate when humanApprovedAt is set on stage state', async () => {
      const deps = makeDeps();
      const stage = makeStage('shape', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'human-approved' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);

      const pipeline = makePipeline(['shape']);
      // Pre-set humanApprovedAt on the stage
      pipeline.stages[0]!.humanApprovedAt = new Date().toISOString();

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(true);
      expect(result.stagesCompleted).toBe(1);
    });

    it('should fail human-approved gate when humanApprovedAt is absent', async () => {
      const deps = makeDeps();
      const stage = makeStage('shape', {
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'human-approved' }],
          required: true,
        },
      });
      registerStages(deps, [stage]);
      const pipeline = makePipeline(['shape']);
      // humanApprovedAt is undefined — gate should fail and abort

      const runner = new PipelineRunner(deps);
      const result = await runner.run(pipeline);

      expect(result.success).toBe(false);
      expect(result.abortedAt).toBe(0);
    });
  });
});
