import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { Stage } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { StageRule } from '@domain/types/rule.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js';
import type {
  IFlavorExecutor,
  OrchestratorContext,
  FlavorExecutionResult,
} from '@domain/ports/stage-orchestrator.js';
import type { Decision } from '@domain/types/decision.js';
import type { ReflectionResult } from '@domain/types/orchestration.js';
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

function makeRuleRegistry(rules: StageRule[] = []): IStageRuleRegistry {
  return {
    loadRules: vi.fn(() => rules),
    addRule: vi.fn((input) => ({ ...input, id: randomUUID(), createdAt: new Date().toISOString() })),
    removeRule: vi.fn(),
    suggestRule: vi.fn((input) => ({
      ...input,
      id: randomUUID(),
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    })),
    getPendingSuggestions: vi.fn(() => []),
    acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
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

  // Expose protected methods for direct testing
  callReflect(decisions: Decision[], flavorResults: FlavorExecutionResult[]): ReflectionResult {
    return this.reflect(decisions, flavorResults);
  }

  callGenerateRuleSuggestions(
    decisions: Decision[],
    decisionOutcomes: ReflectionResult['decisionOutcomes'],
  ): string[] {
    return this.generateRuleSuggestions(decisions, decisionOutcomes);
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
      expect(deps.decisionRegistry.record).toHaveBeenCalledTimes(5);
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

  // ---------------------------------------------------------------------------
  // Rule wiring (#103)
  // ---------------------------------------------------------------------------

  describe("run() — rule wiring (#103)", () => {
    // BaseStageOrchestrator with empty-keyword vocabulary → base score = 0.5 for all flavors.
    function makeBaseOrch(deps: StageOrchestratorDeps): BaseStageOrchestrator {
      return new BaseStageOrchestrator('build', deps, {
        type: 'build',
        confidenceThreshold: 0.7,
        maxParallelFlavors: 5,
      }, {
        stageCategory: 'build',
        keywords: [],
        boostRules: [],
        synthesisPreference: 'merge-all',
        synthesisAlternatives: ['merge-all', 'first-wins', 'cascade'],
        reasoningTemplate: 'Merging {count} flavor(s).',
      });
    }

    function makeRule(
      name: string,
      condition: string,
      effect: StageRule['effect'],
      magnitude = 0.3,
      confidence = 1.0,
    ): StageRule {
      return {
        id: randomUUID(),
        category: 'build',
        name,
        condition,
        effect,
        magnitude,
        confidence,
        source: 'manual',
        evidence: [],
        createdAt: new Date().toISOString(),
      };
    }

    it('boost rule with condition word in bet title → ruleAdjustments > 0, score increased', async () => {
      const rule = makeRule('typescript-feature', 'typescript context', 'boost', 0.3);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'typescript api work' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBeCloseTo(0.3);
      expect(report.score).toBeGreaterThan(0.5); // base 0.5 + 0.3 boost
    });

    it('penalize rule → score decreased, clamped at 0', async () => {
      // magnitude=1.0 with confidence=1.0 → adj = -1.0; base 0.5 → clamped to 0
      const rule = makeRule('typescript-feature', 'penalize this', 'penalize', 1.0);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'penalize this flavor' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBeLessThan(0);
      expect(report.score).toBeGreaterThanOrEqual(0);
    });

    it('multiple boost rules on same flavor → adjustments stack additively', async () => {
      const rule1 = makeRule('typescript-feature', 'auth context', 'boost', 0.2);
      const rule2 = makeRule('typescript-feature', 'auth feature', 'boost', 0.1);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule1, rule2]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'auth implementation' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBeCloseTo(0.3); // 0.2 + 0.1
    });

    it('exclude rule matching condition → flavor absent from selectedFlavors', async () => {
      const rule = makeRule('typescript-feature', 'exclude typescript', 'exclude');
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'exclude typescript work' } }),
      );
      expect(result.selectedFlavors).not.toContain('typescript-feature');
    });

    it('require rule matching condition → flavor present in selectedFlavors', async () => {
      const rule = makeRule('bug-fix', 'hotfix needed', 'require');
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'hotfix needed urgently' } }),
      );
      expect(result.selectedFlavors).toContain('bug-fix');
    });

    it('exclude wins over require when both match same flavor', async () => {
      const excludeRule = makeRule('typescript-feature', 'conflicting', 'exclude');
      const requireRule = makeRule('typescript-feature', 'conflicting', 'require');
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([excludeRule, requireRule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'conflicting signals here' } }),
      );
      expect(result.selectedFlavors).not.toContain('typescript-feature');
    });

    it('condition word in stageCategory → rule fires', async () => {
      // stageCategory = 'build', condition = 'build pipeline' → 'build' matches category
      const rule = makeRule('typescript-feature', 'build pipeline', 'boost', 0.4);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(makeStage(), makeContext());
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBeCloseTo(0.4);
    });

    it('condition word in artifact name → rule fires', async () => {
      const rule = makeRule('typescript-feature', 'research-summary artifact', 'boost', 0.25);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ availableArtifacts: ['research-summary'] }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBeCloseTo(0.25);
    });

    it('condition with only stop words → rule does not fire', async () => {
      // 'is', 'the', 'for' are stop words; all words length ≤ 2 ('is') or in STOP_WORDS
      const rule = makeRule('typescript-feature', 'is the for', 'boost', 0.5);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'some work here' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.ruleAdjustments).toBe(0);
    });

    it('no ruleRegistry → no crash and ruleAdjustments is 0 for all reports', async () => {
      const deps = makeDeps(); // no ruleRegistry
      const orch = makeBaseOrch(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.matchReports).toBeDefined();
      for (const report of result.matchReports!) {
        expect(report.ruleAdjustments).toBe(0);
      }
    });

    it('fired rule name annotated in MatchReport reasoning', async () => {
      const rule = makeRule('typescript-feature', 'annotate test', 'boost', 0.1);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([rule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'annotate test case' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      expect(report.reasoning).toContain('Rule fired for "typescript-feature"');
    });

    it('mixed boost and penalize rules on same flavor → net ruleAdjustments = boost_mag - penalize_mag', async () => {
      const boostRule = makeRule('typescript-feature', 'typescript context', 'boost', 0.3);
      const penalizeRule = makeRule('typescript-feature', 'typescript feature', 'penalize', 0.1);
      const deps = makeDeps({ ruleRegistry: makeRuleRegistry([boostRule, penalizeRule]) });
      const orch = makeBaseOrch(deps);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'typescript context feature work' } }),
      );
      const report = result.matchReports!.find((r) => r.flavorName === 'typescript-feature')!;
      // boost: +0.3 × 1.0 = +0.3; penalize: -0.1 × 1.0 = -0.1; net = +0.2
      expect(report.ruleAdjustments).toBeCloseTo(0.2);
    });
  });

  // ---------------------------------------------------------------------------
  // Gap analysis (#104)
  // ---------------------------------------------------------------------------

  describe("run() — gap analysis (#104)", () => {
    function makeVocabOrch(deps: StageOrchestratorDeps, keywords: string[]): BaseStageOrchestrator {
      return new BaseStageOrchestrator('build', deps, {
        type: 'build',
        confidenceThreshold: 0.7,
        maxParallelFlavors: 5,
      }, {
        stageCategory: 'build',
        keywords,
        boostRules: [],
        synthesisPreference: 'merge-all',
        synthesisAlternatives: ['merge-all', 'first-wins', 'cascade'],
        reasoningTemplate: 'Merging {count} flavor(s).',
      });
    }

    it('no vocabulary → result.gaps is undefined or empty', async () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps); // TestOrchestrator with no vocabulary
      const result = await orch.run(makeStage(), makeContext());
      expect(result.gaps ?? []).toHaveLength(0);
    });

    it('all vocab keywords covered by selected flavor description → empty gaps', async () => {
      // Use a flavor with description containing keywords as separate words
      const flavors = [
        { ...makeFlavor('ts-impl'), description: 'typescript feature implementation' },
        makeFlavor('bug-fix'),
      ];
      const deps = makeDeps({ flavors });
      const orch = makeVocabOrch(deps, ['typescript', 'feature']);
      const result = await orch.run(
        makeStage({ availableFlavors: ['ts-impl', 'bug-fix'] }),
        makeContext({ bet: { title: 'typescript feature work' } }),
      );
      expect(result.gaps).toHaveLength(0);
    });

    it('vocab keyword in bet context but not covered by selected flavor → 1 GapReport', async () => {
      // 'authentication' is in bet title; neither 'typescript-feature' nor 'bug-fix' covers it
      const deps = makeDeps();
      const orch = makeVocabOrch(deps, ['authentication']);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'authentication system' } }),
      );
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps![0]!.description).toContain('authentication');
    });

    it('keyword severity: first-third → high, middle-third → medium, last-third → low', async () => {
      // 3 keywords: ceil(3/3)=1, ceil(6/3)=2 → index 0=high, 1=medium, 2=low
      const deps = makeDeps({ flavors: [makeFlavor('x-flavor')] });
      const orch = makeVocabOrch(deps, ['aaa', 'bbb', 'ccc']);
      const result = await orch.run(
        makeStage({ availableFlavors: ['x-flavor'] }),
        makeContext({ bet: { title: 'aaa bbb ccc' } }),
      );
      const bySeverity = Object.fromEntries(
        result.gaps!.map((g) => [g.description.match(/"(.+?)"/)?.[1] ?? '', g.severity]),
      );
      expect(bySeverity['aaa']).toBe('high');
      expect(bySeverity['bbb']).toBe('medium');
      expect(bySeverity['ccc']).toBe('low');
    });

    it('unselected flavor name contains keyword → appears in gap.suggestedFlavors', async () => {
      const flavors = [
        makeFlavor('typescript-feature'),
        makeFlavor('bug-fix'),
        makeFlavor('authentication-handler'), // unselected; name contains 'authentication'
      ];
      const deps = makeDeps({ flavors });
      const orch = makeVocabOrch(deps, ['authentication']);
      const result = await orch.run(
        makeStage({ availableFlavors: ['typescript-feature', 'bug-fix', 'authentication-handler'] }),
        makeContext({ bet: { title: 'authentication system' } }),
      );
      const gap = result.gaps?.find((g) => g.description.includes('authentication'));
      expect(gap?.suggestedFlavors).toContain('authentication-handler');
    });

    it('keyword in vocabulary but NOT in bet context → no gap created', async () => {
      const deps = makeDeps();
      const orch = makeVocabOrch(deps, ['authentication']);
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'general feature work' } }),
      );
      expect(result.gaps).toHaveLength(0);
    });

    it('gap-assessment decision recorded via decisionRegistry.record()', async () => {
      const deps = makeDeps();
      const orch = makeVocabOrch(deps, ['authentication']);
      await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'authentication system' } }),
      );
      const recordCalls = vi.mocked(deps.decisionRegistry.record).mock.calls;
      const gapCall = recordCalls.find(([input]) => input.decisionType === 'gap-assessment');
      expect(gapCall).toBeDefined();
    });

    it('gap-assessment record() throws → non-fatal: run() still resolves with computed gaps', async () => {
      const deps = makeDeps();
      const orch = makeVocabOrch(deps, ['authentication']);
      let callCount = 0;
      vi.mocked(deps.decisionRegistry.record).mockImplementation((input) => {
        if (input.decisionType === 'gap-assessment') throw new Error('persist failed');
        return { ...input, id: `test-id-${++callCount}` };
      });
      const result = await orch.run(
        makeStage(),
        makeContext({ bet: { title: 'authentication system' } }),
      );
      expect(result).toBeDefined();
      expect(result.gaps).toHaveLength(1); // gap still computed despite record failure
    });
  });

  // ---------------------------------------------------------------------------
  // Reflect suggestions (#49 MVP)
  // ---------------------------------------------------------------------------

  describe("run() — reflect suggestions (#49 MVP)", () => {
    it('good outcome + ruleRegistry → ruleSuggestions has 1 UUID, suggestRule called with effect boost', async () => {
      const ruleReg = makeRuleRegistry();
      const deps = makeDeps({ ruleRegistry: ruleReg });
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection!.ruleSuggestions).toHaveLength(1);
      expect(vi.mocked(ruleReg.suggestRule)).toHaveBeenCalledOnce();
      const [[call]] = vi.mocked(ruleReg.suggestRule).mock.calls;
      expect(call.suggestedRule.effect).toBe('boost');
    });

    it('no ruleRegistry → empty ruleSuggestions, no crash', async () => {
      const deps = makeDeps(); // no ruleRegistry
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection!.ruleSuggestions).toHaveLength(0);
    });

    it('suggestedRule.condition includes bet title text', async () => {
      const ruleReg = makeRuleRegistry();
      const deps = makeDeps({ ruleRegistry: ruleReg });
      const orch = makeOrchestrator(deps);
      await orch.run(makeStage(), makeContext({ bet: { title: 'auth system redesign' } }));
      const [[call]] = vi.mocked(ruleReg.suggestRule).mock.calls;
      expect(call.suggestedRule.condition).toContain('auth system redesign');
    });

    it('reflection.ruleSuggestions[0] is the UUID returned by suggestRule()', async () => {
      const fixedId = '00000000-0000-4000-8000-000000000099';
      const ruleReg = makeRuleRegistry();
      vi.mocked(ruleReg.suggestRule).mockImplementationOnce((input) => ({
        ...input,
        id: fixedId,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      }));
      const deps = makeDeps({ ruleRegistry: ruleReg });
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection!.ruleSuggestions[0]).toBe(fixedId);
    });

    it('suggestRule() throws → non-fatal: empty suggestions, no crash', async () => {
      const ruleReg = makeRuleRegistry();
      vi.mocked(ruleReg.suggestRule).mockImplementation(() => {
        throw new Error('persist failed');
      });
      const deps = makeDeps({ ruleRegistry: ruleReg });
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection!.ruleSuggestions).toHaveLength(0);
    });

    it("'poor' artifact quality → generateRuleSuggestions produces a 'penalize' suggestion", () => {
      const ruleReg = makeRuleRegistry();
      const deps = makeDeps({ ruleRegistry: ruleReg });
      const orch = makeOrchestrator(deps);
      const decision = {
        id: 'test-decision-id',
        stageCategory: 'build',
        decisionType: 'flavor-selection',
        context: { bet: { title: 'auth system' } },
        options: ['typescript-feature'],
        selection: 'typescript-feature',
        reasoning: 'test',
        confidence: 0.9,
        decidedAt: new Date().toISOString(),
      } as unknown as Decision;
      const decisionOutcomes: ReflectionResult['decisionOutcomes'] = [
        { decisionId: 'test-decision-id', outcome: { artifactQuality: 'poor', reworkRequired: true } },
      ];
      orch.callGenerateRuleSuggestions([decision], decisionOutcomes);
      expect(vi.mocked(ruleReg.suggestRule)).toHaveBeenCalledOnce();
      const [[call]] = vi.mocked(ruleReg.suggestRule).mock.calls;
      expect(call.suggestedRule.effect).toBe('penalize');
    });

    it("'partial' overallQuality when a flavorResult synthesisArtifact.value is null", () => {
      const deps = makeDeps();
      const orch = makeOrchestrator(deps);
      const decisions = [
        {
          id: 'test-id',
          stageCategory: 'build',
          decisionType: 'synthesis-approach',
          context: {},
          options: ['merge-all'],
          selection: 'merge-all',
          reasoning: 'test',
          confidence: 0.9,
          decidedAt: new Date().toISOString(),
        } as unknown as Decision,
      ];
      const flavorResults: FlavorExecutionResult[] = [
        {
          flavorName: 'test-flavor',
          artifacts: {},
          synthesisArtifact: { name: 'test-output', value: null as unknown as NonNullable<unknown> },
        },
      ];
      const reflection = orch.callReflect(decisions, flavorResults);
      expect(reflection.overallQuality).toBe('partial');
      expect(reflection.decisionOutcomes[0]?.outcome.reworkRequired).toBe(true);
      expect(reflection.decisionOutcomes[0]?.outcome.gateResult).toBeUndefined();
    });

    it('updateOutcome() throws → non-fatal: reflect still returns result with empty decisionOutcomes', async () => {
      const deps = makeDeps();
      vi.mocked(deps.decisionRegistry.updateOutcome).mockImplementation(() => {
        throw new Error('db write failed');
      });
      const orch = makeOrchestrator(deps);
      const result = await orch.run(makeStage(), makeContext());
      expect(result.reflection).toBeDefined();
      expect(result.reflection!.decisionOutcomes).toHaveLength(0);
      expect(result.reflection!.overallQuality).toBe('good');
    });
  });
});
