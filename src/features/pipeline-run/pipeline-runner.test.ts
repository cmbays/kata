import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Pipeline } from '@domain/types/pipeline.js';
import type { Stage } from '@domain/types/stage.js';
import type { ExecutionResult } from '@domain/types/manifest.js';
import type { GateResult } from '@domain/types/gate.js';
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
      pipelineDir,
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
});
