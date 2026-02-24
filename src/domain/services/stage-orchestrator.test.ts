import { describe, it, expect, vi } from 'vitest';
import type { Stage } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type {
  IFlavorExecutor,
  OrchestratorContext,
  FlavorExecutionResult,
} from '@domain/ports/stage-orchestrator.js';
import { FlavorNotFoundError, OrchestratorError } from '@shared/lib/errors.js';
import {
  BaseStageOrchestrator,
  type StageOrchestratorDeps,
} from './stage-orchestrator.js';
import { createStageOrchestrator } from './orchestrators/index.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFlavor(name: string, stageCategory: Flavor['stageCategory'] = 'build'): Flavor {
  return {
    name,
    stageCategory,
    steps: [{ stepName: 'main', stepType: 'build' }],
    synthesisArtifact: `${name}-output`,
  };
}

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    category: 'build',
    orchestrator: {
      type: 'build',
      confidenceThreshold: 0.7,
      maxParallelFlavors: 5,
    },
    availableFlavors: ['typescript-feature', 'bug-fix'],
    ...overrides,
  };
}

function makeContext(overrides: Partial<OrchestratorContext> = {}): OrchestratorContext {
  return {
    availableArtifacts: [],
    ...overrides,
  };
}

function makeFlavorResult(flavorName: string): FlavorExecutionResult {
  return {
    flavorName,
    artifacts: { [`${flavorName}-artifact`]: { data: 'value' } },
    synthesisArtifact: { name: `${flavorName}-output`, value: { summary: `${flavorName} complete` } },
  };
}

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function makeFlavorRegistry(flavors: Flavor[]): IFlavorRegistry {
  return {
    register: vi.fn(),
    get: vi.fn((stageCategory, name) => {
      const found = flavors.find((f) => f.stageCategory === stageCategory && f.name === name);
      if (!found) throw new FlavorNotFoundError(stageCategory, name);
      return found;
    }),
    list: vi.fn((stageCategory) =>
      stageCategory ? flavors.filter((f) => f.stageCategory === stageCategory) : flavors,
    ),
    delete: vi.fn(),
    loadBuiltins: vi.fn(),
    validate: vi.fn(() => ({ valid: true })),
  };
}

function makeDecisionRegistry(): IDecisionRegistry {
  let decisionCount = 0;
  return {
    record: vi.fn((input) => ({
      ...input,
      id: `00000000-0000-4000-8000-${String(++decisionCount).padStart(12, '0')}`,
    })),
    get: vi.fn(),
    list: vi.fn(() => []),
    updateOutcome: vi.fn(),
    getStats: vi.fn(() => ({
      count: 0,
      avgConfidence: 0,
      countByType: {},
      outcomeDistribution: { good: 0, partial: 0, poor: 0, noOutcome: 0 },
    })),
  };
}

function makeExecutor(
  resultOverride?: (flavor: Flavor) => FlavorExecutionResult,
): IFlavorExecutor {
  return {
    execute: vi.fn((flavor: Flavor) =>
      Promise.resolve(resultOverride ? resultOverride(flavor) : makeFlavorResult(flavor.name)),
    ),
  };
}

// ---------------------------------------------------------------------------
// Concrete subclass for testing abstract methods
// ---------------------------------------------------------------------------

class TestOrchestrator extends BaseStageOrchestrator {
  protected scoreFlavorForContext(flavor: Flavor, context: OrchestratorContext): number {
    // Simple: score by name length (deterministic for testing)
    const betTitle = String(context.bet?.title ?? '');
    return flavor.name.length + (betTitle.includes(flavor.name) ? 0.5 : 0);
  }

  protected getSynthesisStrategy(results: FlavorExecutionResult[]) {
    return {
      approach: 'merge-all',
      alternatives: ['merge-all', 'first-wins', 'cascade'] as [string, ...string[]],
      reasoning: `Merging ${results.length} flavor output(s).`,
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(
  overrides: Partial<StageOrchestratorDeps> & { flavors?: Flavor[] } = {},
): StageOrchestratorDeps {
  const { flavors = [makeFlavor('typescript-feature'), makeFlavor('bug-fix')], ...rest } = overrides;
  return {
    flavorRegistry: makeFlavorRegistry(flavors),
    decisionRegistry: makeDecisionRegistry(),
    executor: makeExecutor(),
    ...rest,
  };
}

function makeOrchestrator(deps: StageOrchestratorDeps): TestOrchestrator {
  return new TestOrchestrator('build', deps, {
    type: 'build',
    confidenceThreshold: 0.7,
    maxParallelFlavors: 5,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BaseStageOrchestrator', () => {
  describe('run() — happy path', () => {
    it('returns OrchestratorResult with stageCategory matching constructor arg', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.stageCategory).toBe('build');
    });

    it('includes 4 decisions (capability-analysis, flavor-selection, execution-mode, synthesis-approach)', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.decisions).toHaveLength(4);
      const types = result.decisions.map((d) => d.decisionType);
      expect(types).toContain('capability-analysis');
      expect(types).toContain('flavor-selection');
      expect(types).toContain('execution-mode');
      expect(types).toContain('synthesis-approach');
    });

    it('records all decisions via decisionRegistry.record()', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      expect(deps.decisionRegistry.record).toHaveBeenCalledTimes(4);
    });

    it('returns capabilityProfile from analyze phase', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.capabilityProfile).toBeDefined();
      expect(result.capabilityProfile!.stageCategory).toBe('build');
    });

    it('returns matchReports from match phase', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.matchReports).toBeDefined();
      expect(result.matchReports!.length).toBeGreaterThan(0);
    });

    it('returns reflection from reflect phase', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection).toBeDefined();
      expect(result.reflection!.overallQuality).toBe('good');
      expect(result.reflection!.decisionOutcomes).toHaveLength(4);
    });

    it('calls decisionRegistry.updateOutcome() for each decision in reflect phase', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      expect(deps.decisionRegistry.updateOutcome).toHaveBeenCalledTimes(4);
    });

    it('returns selectedFlavors containing the top-scored flavor', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      // 'typescript-feature' has length 18; 'bug-fix' has length 7 → 'typescript-feature' wins
      expect(result.selectedFlavors).toContain('typescript-feature');
    });

    it('executes selected flavors via executor.execute()', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      expect(deps.executor.execute).toHaveBeenCalled();
    });

    it('produces a stageArtifact with name = "{category}-synthesis"', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.stageArtifact.name).toBe('build-synthesis');
    });

    it('stageArtifact value contains per-flavor synthesis artifacts keyed by flavor name', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      const selectedFlavor = result.selectedFlavors[0]!;
      const value = result.stageArtifact.value as Record<string, unknown>;
      expect(Object.keys(value)).toContain(selectedFlavor);
    });

    it('executionMode is "sequential" for a single selected flavor', async () => {
      // Only one flavor available
      const deps = makeDeps({ flavors: [makeFlavor('typescript-feature')] });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({ availableFlavors: ['typescript-feature'] });
      const result = await orch.run(stage, makeContext());
      expect(result.executionMode).toBe('sequential');
    });

    it('executionMode is "parallel" for 2 selected flavors when count ≤ maxParallelFlavors', async () => {
      const flavors = [
        makeFlavor('typescript-feature'),
        makeFlavor('pinned-extra'),
      ];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps); // maxParallelFlavors=5
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['pinned-extra'],
      });
      const result = await orch.run(stage, makeContext());
      // 2 flavors, maxParallel=5 → parallel
      expect(result.executionMode).toBe('parallel');
    });

    it('flavorResults has one entry per selected flavor', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.flavorResults).toHaveLength(result.selectedFlavors.length);
    });
  });

  describe('run() — flavor selection', () => {
    it('always includes pinnedFlavors in selectedFlavors', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('always-run')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature', 'always-run'],
        pinnedFlavors: ['always-run'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).toContain('always-run');
    });

    it('never includes excludedFlavors in selectedFlavors', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('excluded-flavor')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature', 'excluded-flavor'],
        excludedFlavors: ['excluded-flavor'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).not.toContain('excluded-flavor');
    });

    it('throws OrchestratorError when all flavors are excluded (no pinned)', async () => {
      const flavors = [makeFlavor('typescript-feature')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        excludedFlavors: ['typescript-feature'],
      });
      await expect(orch.run(stage, makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('includes pinnedFlavors not listed in availableFlavors', async () => {
      // 'extra-pinned' is not in availableFlavors but is in pinnedFlavors
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('extra-pinned')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['extra-pinned'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).toContain('extra-pinned');
    });

    it('excludedFlavors wins over pinnedFlavors (conflict resolution)', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('conflicted')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature', 'conflicted'],
        pinnedFlavors: ['conflicted'],
        excludedFlavors: ['conflicted'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).not.toContain('conflicted');
    });

    it('succeeds when all availableFlavors are excluded but pinnedFlavors provides a fallback', async () => {
      const flavors = [makeFlavor('excluded-flavor'), makeFlavor('pinned-only')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['excluded-flavor'],
        excludedFlavors: ['excluded-flavor'],
        pinnedFlavors: ['pinned-only'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).toContain('pinned-only');
    });

    it('throws OrchestratorError when no flavors are available', async () => {
      const deps = makeDeps({ flavors: [] });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({ availableFlavors: ['nonexistent'] });
      await expect(orch.run(stage, makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('skips unresolvable flavors with a warning (does not throw)', async () => {
      // Only 'typescript-feature' exists in registry; 'missing-flavor' does not
      const flavors = [makeFlavor('typescript-feature')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({ availableFlavors: ['typescript-feature', 'missing-flavor'] });
      const result = await orch.run(stage, makeContext());
      expect(result.selectedFlavors).not.toContain('missing-flavor');
      expect(result.selectedFlavors).toContain('typescript-feature');
    });

    it('sets flavor-selection confidence to 0 when all candidates are pinned (no scoring)', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('bug-fix')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      // All availableFlavors are also pinned → nonPinned is empty, topScore=0
      const stage = makeStage({
        availableFlavors: ['typescript-feature', 'bug-fix'],
        pinnedFlavors: ['typescript-feature', 'bug-fix'],
      });
      await orch.run(stage, makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const selectionCall = recordCalls.find(([input]) => input.decisionType === 'flavor-selection')!;
      expect(selectionCall[0].confidence).toBe(0);
    });

    it('deduplicates when a pinnedFlavor is also in availableFlavors', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('bug-fix')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature', 'bug-fix'],
        pinnedFlavors: ['typescript-feature'],
      });
      const result = await orch.run(stage, makeContext());
      const count = result.selectedFlavors.filter((n) => n === 'typescript-feature').length;
      expect(count).toBe(1);
    });

    it('flavor-selection Decision options contain candidate flavor names', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const selectionCall = recordCalls.find(
        ([input]) => input.decisionType === 'flavor-selection',
      );
      expect(selectionCall).toBeDefined();
      const options = selectionCall![0].options;
      expect(options).toContain('typescript-feature');
    });

    it('flavor-selection Decision selection is one of its options', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const selectionCall = recordCalls.find(
        ([input]) => input.decisionType === 'flavor-selection',
      )!;
      const { options, selection } = selectionCall[0];
      expect(options).toContain(selection);
    });

    it('flavor-selection Decision confidence is in [0, 1]', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const selectionCall = recordCalls.find(
        ([input]) => input.decisionType === 'flavor-selection',
      )!;
      const confidence = selectionCall[0].confidence;
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('run() — execution mode', () => {
    it('records execution-mode Decision with selection "sequential" or "parallel"', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const modeCall = recordCalls.find(([input]) => input.decisionType === 'execution-mode')!;
      expect(['sequential', 'parallel']).toContain(modeCall[0].selection);
    });

    it('uses "parallel" when 2 flavors selected and count ≤ maxParallelFlavors', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('pinned-extra')];
      const deps = makeDeps({ flavors });
      const orch = makeOrchestrator(deps); // maxParallelFlavors=5
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['pinned-extra'],
        orchestrator: { type: 'build', confidenceThreshold: 0.7, maxParallelFlavors: 5 },
      });
      const result = await orch.run(stage, makeContext());
      // 2 flavors ≤ maxParallelFlavors=5 → parallel
      expect(result.executionMode).toBe('parallel');
    });

    it('uses "sequential" when only 1 flavor selected', async () => {
      const deps = makeDeps({ flavors: [makeFlavor('typescript-feature')] });
      const stage = makeStage({ availableFlavors: ['typescript-feature'] });
      const orch = makeOrchestrator(deps);
      const result = await orch.run(stage, makeContext());
      expect(result.executionMode).toBe('sequential');
    });

    it('uses "sequential" when flavor count exceeds maxParallelFlavors', async () => {
      const flavorNames = ['a', 'b', 'c'];
      const flavors = flavorNames.map((n) => makeFlavor(n));
      const deps = makeDeps({ flavors });
      const orchDeps = { ...deps };
      const orch = new TestOrchestrator('build', orchDeps, {
        type: 'build',
        confidenceThreshold: 0.7,
        maxParallelFlavors: 1, // only 1 at a time
      });
      const stage = makeStage({
        availableFlavors: ['a'],
        pinnedFlavors: ['b', 'c'],
      });
      const result = await orch.run(stage, makeContext());
      expect(result.executionMode).toBe('sequential');
    });

    it('initiates all flavor executions before awaiting any result in parallel mode', async () => {
      // Verify concurrency: both execute() calls must be issued before any promise resolves
      const resolvers: Array<() => void> = [];
      const executor: IFlavorExecutor = {
        execute: vi.fn((flavor: Flavor) =>
          new Promise<FlavorExecutionResult>((resolve) => {
            resolvers.push(() => resolve(makeFlavorResult(flavor.name)));
          }),
        ),
      };
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('pinned-extra')];
      const deps = makeDeps({ flavors, executor });
      const orch = makeOrchestrator(deps); // maxParallelFlavors=5
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['pinned-extra'],
      });
      const runPromise = orch.run(stage, makeContext());
      // Both execute() calls must have been dispatched before any resolved
      expect(executor.execute).toHaveBeenCalledTimes(2);
      // Now allow them to resolve
      resolvers.forEach((r) => r());
      await runPromise;
    });

    it('propagates sequential executor rejection without wrapping', async () => {
      const executorError = new OrchestratorError('executor failed intentionally');
      const executor: IFlavorExecutor = {
        execute: vi.fn().mockRejectedValue(executorError),
      };
      const deps = makeDeps({ executor });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).rejects.toBe(executorError);
    });
  });

  describe('run() — synthesis', () => {
    it('throws OrchestratorError when a flavor returns null synthesis artifact value', async () => {
      const executor: IFlavorExecutor = {
        execute: vi.fn(() =>
          Promise.resolve({
            flavorName: 'typescript-feature',
            artifacts: {},
            synthesisArtifact: { name: 'typescript-feature-output', value: null },
          }),
        ),
      };
      const deps = makeDeps({ executor });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('throws OrchestratorError when a flavor returns undefined synthesis artifact value', async () => {
      const executor: IFlavorExecutor = {
        execute: vi.fn(() =>
          Promise.resolve({
            flavorName: 'typescript-feature',
            artifacts: {},
            synthesisArtifact: { name: 'typescript-feature-output', value: undefined },
          }),
        ),
      };
      const deps = makeDeps({ executor });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('throws OrchestratorError when getSynthesisStrategy approach is not in alternatives', async () => {
      class BrokenOrchestrator extends BaseStageOrchestrator {
        protected scoreFlavorForContext() { return 0.5; }
        protected getSynthesisStrategy() {
          return {
            approach: 'nonexistent-approach',
            alternatives: ['merge-all', 'first-wins'] as [string, ...string[]],
            reasoning: 'bad impl',
          };
        }
      }
      const deps = makeDeps();
      const orch = new BrokenOrchestrator('build', deps, {
        type: 'build', confidenceThreshold: 0.7, maxParallelFlavors: 5,
      });
      await expect(orch.run(makeStage(), makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('records synthesis-approach Decision with selection in options', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const synthCall = recordCalls.find(([input]) => input.decisionType === 'synthesis-approach')!;
      expect(synthCall[0].options).toContain(synthCall[0].selection);
    });

    it('synthesis Decision stageCategory matches orchestrator category', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext());
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      for (const [input] of recordCalls) {
        expect(input.stageCategory).toBe('build');
      }
    });
  });

  describe('run() — error handling', () => {
    it('re-throws non-FlavorNotFoundError from registry as OrchestratorError', async () => {
      const registry = makeFlavorRegistry([]);
      vi.mocked(registry.get).mockImplementationOnce(() => {
        throw new Error('Disk I/O failure: ENOENT');
      });
      const deps = makeDeps({ flavorRegistry: registry });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({ availableFlavors: ['typescript-feature'] });
      await expect(orch.run(stage, makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('re-throws non-FlavorNotFoundError from pinned flavor registry as OrchestratorError', async () => {
      const flavors = [makeFlavor('typescript-feature')];
      const registry = makeFlavorRegistry(flavors);
      vi.mocked(registry.get).mockImplementation((cat, name) => {
        if (name === 'pinned-broken') throw new Error('Disk I/O failure');
        const found = flavors.find((f) => f.stageCategory === cat && f.name === name);
        if (!found) throw new FlavorNotFoundError(cat, name);
        return found;
      });
      const deps = makeDeps({ flavorRegistry: registry });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['pinned-broken'],
      });
      await expect(orch.run(stage, makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('collects all parallel failures and reports them together', async () => {
      const flavors = [makeFlavor('typescript-feature'), makeFlavor('pinned-extra')];
      const executor: IFlavorExecutor = {
        execute: vi.fn(() => Promise.reject(new Error('executor failure'))),
      };
      const deps = makeDeps({ flavors, executor });
      const orch = makeOrchestrator(deps);
      const stage = makeStage({
        availableFlavors: ['typescript-feature'],
        pinnedFlavors: ['pinned-extra'],
      });
      await expect(orch.run(stage, makeContext())).rejects.toThrow(OrchestratorError);
    });

    it('accepts 0 as a valid synthesis artifact value', async () => {
      const executor: IFlavorExecutor = {
        execute: vi.fn(() =>
          Promise.resolve({
            flavorName: 'typescript-feature',
            artifacts: {},
            synthesisArtifact: { name: 'typescript-feature-output', value: 0 },
          }),
        ),
      };
      const deps = makeDeps({ executor });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).resolves.toBeDefined();
    });

    it('accepts false as a valid synthesis artifact value', async () => {
      const executor: IFlavorExecutor = {
        execute: vi.fn(() =>
          Promise.resolve({
            flavorName: 'typescript-feature',
            artifacts: {},
            synthesisArtifact: { name: 'typescript-feature-output', value: false },
          }),
        ),
      };
      const deps = makeDeps({ executor });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).resolves.toBeDefined();
    });

    it('wraps decisionRegistry.record() failures as OrchestratorError', async () => {
      const decisionRegistry = makeDecisionRegistry();
      vi.mocked(decisionRegistry.record).mockImplementation(() => {
        throw new Error('registry write failure');
      });
      const deps = makeDeps({ decisionRegistry });
      const orch = makeOrchestrator(deps);
      await expect(orch.run(makeStage(), makeContext())).rejects.toThrow(OrchestratorError);
    });
  });

  describe('run() — context propagation', () => {
    it('passes bet context into flavor-selection Decision context', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const context = makeContext({ bet: { id: 'bet-001', title: 'Add search feature' } });
      await orch.run(makeStage(), context);
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const selectionCall = recordCalls.find(
        ([input]) => input.decisionType === 'flavor-selection',
      )!;
      expect(selectionCall[0].context).toMatchObject({ bet: context.bet });
    });

    it('passes context to executor.execute()', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const context = makeContext({ bet: { title: 'TypeScript feature' } });
      await orch.run(makeStage(), context);
      expect(deps.executor.execute).toHaveBeenCalledWith(expect.anything(), context);
    });
  });
});

// ---------------------------------------------------------------------------
// createStageOrchestrator factory tests
// ---------------------------------------------------------------------------

describe('createStageOrchestrator factory', () => {
  const categories = ['research', 'plan', 'build', 'review'] as const;

  for (const category of categories) {
    it(`creates a ${category} orchestrator that implements IStageOrchestrator`, () => {
      const deps = makeDeps({
        flavors: [makeFlavor(`${category}-standard`, category)],
      });
      const orch = createStageOrchestrator(category, deps, {
        type: category,
        confidenceThreshold: 0.7,
        maxParallelFlavors: 5,
      });
      expect(typeof orch.run).toBe('function');
    });

    it(`${category} orchestrator run() succeeds end-to-end`, async () => {
      const deps = makeDeps({
        flavors: [makeFlavor(`${category}-standard`, category)],
      });
      const orch = createStageOrchestrator(category, deps, {
        type: category,
        confidenceThreshold: 0.7,
        maxParallelFlavors: 5,
      });
      const stage: Stage = {
        category,
        orchestrator: { type: category, confidenceThreshold: 0.7, maxParallelFlavors: 5 },
        availableFlavors: [`${category}-standard`],
      };
      const result = await orch.run(stage, makeContext());
      expect(result.stageCategory).toBe(category);
      expect(result.decisions).toHaveLength(4);
      expect(result.stageArtifact.name).toBe(`${category}-synthesis`);
    });
  }

  it('throws OrchestratorError for unknown stage category', () => {
    const deps = makeDeps();
    expect(() =>
      createStageOrchestrator(
        'unknown' as never,
        deps,
        { type: 'build', confidenceThreshold: 0.7, maxParallelFlavors: 5 },
      ),
    ).toThrow(OrchestratorError);
  });

  it('review orchestrator records synthesis-approach Decision with selection "cascade"', async () => {
    const deps = makeDeps({
      flavors: [makeFlavor('review-standard', 'review')],
    });
    const orch = createStageOrchestrator('review', deps, {
      type: 'review',
      confidenceThreshold: 0.7,
      maxParallelFlavors: 5,
    });
    const stage: Stage = {
      category: 'review',
      orchestrator: { type: 'review', confidenceThreshold: 0.7, maxParallelFlavors: 5 },
      availableFlavors: ['review-standard'],
    };
    await orch.run(stage, makeContext());
    const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
    const synthCall = recordCalls.find(([input]) => input.decisionType === 'synthesis-approach')!;
    expect(synthCall[0].selection).toBe('cascade');
  });

  it('plan orchestrator boosts score when research artifacts are available', async () => {
    const flavors = [
      makeFlavor('plan-with-research', 'plan'),
      makeFlavor('plain-plan', 'plan'),
    ];
    const deps = makeDeps({ flavors });
    const orch = createStageOrchestrator('plan', deps, {
      type: 'plan',
      confidenceThreshold: 0.7,
      maxParallelFlavors: 5,
    });
    const stage: Stage = {
      category: 'plan',
      orchestrator: { type: 'plan', confidenceThreshold: 0.7, maxParallelFlavors: 5 },
      availableFlavors: ['plan-with-research', 'plain-plan'],
    };
    // With research artifact, plan orchestrator should record a confidence > 0
    const contextWithResearch = makeContext({ availableArtifacts: ['research-summary'] });
    await orch.run(stage, contextWithResearch);
    const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
    const selectionCall = recordCalls.find(([input]) => input.decisionType === 'flavor-selection')!;
    expect(selectionCall[0].confidence).toBeGreaterThan(0);
  });
});
