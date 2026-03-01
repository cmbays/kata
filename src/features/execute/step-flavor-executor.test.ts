import { vi } from 'vitest';
import type { Flavor } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';
import type { OrchestratorContext } from '@domain/ports/stage-orchestrator.js';
import type { IExecutionAdapter } from '@domain/ports/execution-adapter.js';
import type { KataConfig } from '@domain/types/config.js';
import type { ExecutionResult } from '@domain/types/manifest.js';
import { StepFlavorExecutor, type StepFlavorExecutorDeps } from './step-flavor-executor.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeStep(type: string): Step {
  return {
    type,
    artifacts: [
      { name: `${type}-output`, description: 'Output', required: true },
    ],
    promptTemplate: `Execute ${type}`,
    learningHooks: [],
    config: {},
  };
}

function makeFlavor(overrides: Partial<Flavor> = {}): Flavor {
  return {
    name: 'standard-build',
    stageCategory: 'build',
    steps: [
      { stepName: 'implement', stepType: 'implementation' },
      { stepName: 'test', stepType: 'test-execution' },
    ],
    synthesisArtifact: 'build-output',
    ...overrides,
  };
}

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    availableArtifacts: [],
    ...overrides,
  };
}

function makeExecutionResult(success = true): ExecutionResult {
  return {
    success,
    artifacts: [{ name: 'build-output' }],
    completedAt: new Date().toISOString(),
  };
}

function makeMockAdapter(result?: ExecutionResult): IExecutionAdapter {
  return {
    name: 'mock',
    execute: vi.fn().mockResolvedValue(result ?? makeExecutionResult()),
  };
}

function makeDeps(overrides: Partial<StepFlavorExecutorDeps> = {}): StepFlavorExecutorDeps {
  const steps = new Map<string, Step>([
    ['implementation', makeStep('implementation')],
    ['test-execution', makeStep('test-execution')],
  ]);

  return {
    stepRegistry: {
      get: vi.fn((type: string) => {
        const step = steps.get(type);
        if (!step) throw new Error(`Step not found: ${type}`);
        return step;
      }),
    },
    adapterResolver: {
      resolve: vi.fn().mockReturnValue(makeMockAdapter()),
    },
    config: {
      methodology: 'shape-up',
      execution: { adapter: 'manual', config: {} },
      customStagePaths: [],
      project: {},
    } as KataConfig,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StepFlavorExecutor', () => {
  describe('execute() — happy path', () => {
    it('returns FlavorExecutionResult with correct flavorName', async () => {
      const deps = makeDeps();
      const executor = new StepFlavorExecutor(deps);
      const result = await executor.execute(makeFlavor(), makeContext());
      expect(result.flavorName).toBe('standard-build');
    });

    it('looks up each step by stepType from the StepRegistry', async () => {
      const deps = makeDeps();
      const executor = new StepFlavorExecutor(deps);
      await executor.execute(makeFlavor(), makeContext());
      expect(deps.stepRegistry.get).toHaveBeenCalledWith('implementation');
      expect(deps.stepRegistry.get).toHaveBeenCalledWith('test-execution');
    });

    it('executes each step via the adapter', async () => {
      const adapter = makeMockAdapter();
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await executor.execute(makeFlavor(), makeContext());
      // Two steps = two adapter.execute() calls
      expect(adapter.execute).toHaveBeenCalledTimes(2);
    });

    it('collects artifacts from all steps', async () => {
      const deps = makeDeps();
      const executor = new StepFlavorExecutor(deps);
      const result = await executor.execute(makeFlavor(), makeContext());
      expect(result.artifacts).toBeDefined();
      expect(typeof result.artifacts).toBe('object');
    });

    it('returns synthesisArtifact with name matching flavor.synthesisArtifact', async () => {
      const deps = makeDeps();
      const executor = new StepFlavorExecutor(deps);
      const result = await executor.execute(makeFlavor(), makeContext());
      expect(result.synthesisArtifact.name).toBe('build-output');
    });

    it('synthesisArtifact.value is not null or undefined', async () => {
      const deps = makeDeps();
      const executor = new StepFlavorExecutor(deps);
      const result = await executor.execute(makeFlavor(), makeContext());
      expect(result.synthesisArtifact.value).not.toBeNull();
      expect(result.synthesisArtifact.value).not.toBeUndefined();
    });

    it('executes steps sequentially in order', async () => {
      const callOrder: string[] = [];
      const adapter: IExecutionAdapter = {
        name: 'mock',
        execute: vi.fn((manifest) => {
          callOrder.push(manifest.stageType);
          return Promise.resolve(makeExecutionResult());
        }),
      };
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await executor.execute(makeFlavor(), makeContext());
      expect(callOrder).toEqual(['implementation', 'test-execution']);
    });
  });

  describe('execute() — single step flavor', () => {
    it('works with a single-step flavor', async () => {
      const deps = makeDeps();
      const flavor = makeFlavor({
        name: 'simple',
        steps: [{ stepName: 'impl', stepType: 'implementation' }],
        synthesisArtifact: 'build-output',
      });
      const executor = new StepFlavorExecutor(deps);
      const result = await executor.execute(flavor, makeContext());
      expect(result.flavorName).toBe('simple');
      expect(result.synthesisArtifact.name).toBe('build-output');
    });
  });

  describe('execute() — error handling', () => {
    it('throws when StepRegistry cannot find a step', async () => {
      const deps = makeDeps();
      vi.mocked(deps.stepRegistry.get).mockImplementation((type: string) => {
        throw new Error(`Step not found: ${type}`);
      });
      const executor = new StepFlavorExecutor(deps);
      await expect(executor.execute(makeFlavor(), makeContext())).rejects.toThrow('Step not found');
    });

    it('throws when adapter execution fails', async () => {
      const adapter: IExecutionAdapter = {
        name: 'failing',
        execute: vi.fn().mockRejectedValue(new Error('Adapter failed')),
      };
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await expect(executor.execute(makeFlavor(), makeContext())).rejects.toThrow('Adapter failed');
    });

    it('throws when adapter returns success=false', async () => {
      const adapter = makeMockAdapter(makeExecutionResult(false));
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await expect(executor.execute(makeFlavor(), makeContext())).rejects.toThrow();
    });
  });

  describe('execute() — context propagation', () => {
    it('builds manifests with step type and prompt', async () => {
      const adapter = makeMockAdapter();
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await executor.execute(makeFlavor(), makeContext());
      const firstCall = vi.mocked(adapter.execute).mock.calls[0]![0];
      expect(firstCall.stageType).toBe('implementation');
      expect(firstCall.prompt).toContain('implementation');
    });

    it('passes learnings from context to manifest', async () => {
      const adapter = makeMockAdapter();
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      const context = makeContext({ learnings: ['Use TDD', 'Prefer small commits'] });
      await executor.execute(makeFlavor(), context);
      const firstCall = vi.mocked(adapter.execute).mock.calls[0]![0];
      expect(firstCall.prompt).toContain('Learnings');
    });

    it('includes activeKatakaId in manifest metadata when set', async () => {
      const adapter = makeMockAdapter();
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      const katakaId = '00000000-0000-4000-a000-000000000001';
      const context = makeContext({ activeKatakaId: katakaId });
      await executor.execute(makeFlavor(), context);
      const firstCall = vi.mocked(adapter.execute).mock.calls[0]![0];
      expect(firstCall.context.metadata.katakaId).toBe(katakaId);
    });

    it('omits katakaId from manifest metadata when not set', async () => {
      const adapter = makeMockAdapter();
      const deps = makeDeps({
        adapterResolver: { resolve: vi.fn().mockReturnValue(adapter) },
      });
      const executor = new StepFlavorExecutor(deps);
      await executor.execute(makeFlavor(), makeContext());
      const firstCall = vi.mocked(adapter.execute).mock.calls[0]![0];
      expect(firstCall.context.metadata.katakaId).toBeUndefined();
    });
  });
});
