import { join } from 'node:path';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import type { StageCategory } from '@domain/types/stage.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type {
  IFlavorExecutor,
  FlavorExecutionResult,
} from '@domain/ports/stage-orchestrator.js';
import { FlavorNotFoundError, OrchestratorError } from '@shared/lib/errors.js';
import { UsageAnalytics } from '@infra/tracking/usage-analytics.js';
import { MetaOrchestrator } from '@domain/services/meta-orchestrator.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { KiaiRunner, type KiaiRunnerDeps } from './kiai-runner.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeFlavor(name: string, stageCategory: StageCategory = 'build'): Flavor {
  return {
    name,
    stageCategory,
    steps: [{ stepName: 'main', stepType: 'implementation' }],
    synthesisArtifact: `${name}-output`,
  };
}

function makeFlavorResult(flavorName: string): FlavorExecutionResult {
  return {
    flavorName,
    artifacts: { output: 'done' },
    synthesisArtifact: { name: `${flavorName}-output`, value: { result: 'success' } },
  };
}

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
    validate: vi.fn(() => ({ valid: true, errors: [] })),
  };
}

function makeDecisionRegistry(): IDecisionRegistry {
  let count = 0;
  return {
    record: vi.fn((input) => ({
      ...input,
      id: `00000000-0000-4000-8000-${String(++count).padStart(12, '0')}`,
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

function makeExecutor(results?: (flavor: Flavor) => FlavorExecutionResult): IFlavorExecutor {
  return {
    execute: vi.fn((flavor: Flavor) =>
      Promise.resolve(results ? results(flavor) : makeFlavorResult(flavor.name)),
    ),
  };
}

function makeDeps(overrides: Partial<KiaiRunnerDeps> = {}): KiaiRunnerDeps {
  const flavors = [
    makeFlavor('standard-build', 'build'),
    makeFlavor('tdd-build', 'build'),
    makeFlavor('code-quality', 'review'),
  ];

  return {
    flavorRegistry: makeFlavorRegistry(flavors),
    decisionRegistry: makeDecisionRegistry(),
    executor: makeExecutor(),
    kataDir: join(tmpdir(), `kata-kiai-test-${Date.now()}`),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KiaiRunner', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = join(tmpdir(), `kata-kiai-test-${Date.now()}`);
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(join(baseDir, 'artifacts'), { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  describe('runStage() — happy path', () => {
    it('returns OrchestratorResult with correct stageCategory', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');
      expect(result.stageCategory).toBe('build');
    });

    it('selects flavors from FlavorRegistry for the given category', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      expect(deps.flavorRegistry.list).toHaveBeenCalledWith('build');
    });

    it('returns selectedFlavors containing at least one flavor', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');
      expect(result.selectedFlavors.length).toBeGreaterThan(0);
    });

    it('returns exactly 4 decisions (capability-analysis, flavor-selection, execution-mode, synthesis-approach)', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');
      expect(result.decisions).toHaveLength(4);
    });

    it('produces a stageArtifact', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');
      expect(result.stageArtifact).toBeDefined();
      expect(result.stageArtifact.name).toBe('build-synthesis');
    });

    it('persists stageArtifact to artifacts dir', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir);
      expect(files.some((f) => f.startsWith('build-') && f.endsWith('.json'))).toBe(true);
    });
  });

  describe('runStage() — options', () => {
    it('passes bet to orchestrator context', async () => {
      const executor = makeExecutor();
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build', { bet: { title: 'Add search' } });
      expect(executor.execute).toHaveBeenCalled();
    });

    it('applies pinned flavors from options', async () => {
      const flavors = [
        makeFlavor('standard-build', 'build'),
        makeFlavor('pinned-one', 'build'),
      ];
      const deps = makeDeps({
        kataDir: baseDir,
        flavorRegistry: makeFlavorRegistry(flavors),
      });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build', { pin: ['pinned-one'] });
      expect(result.selectedFlavors).toContain('pinned-one');
    });

    it('dryRun runs orchestrator but does not persist artifacts', async () => {
      const executor = makeExecutor();
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build', { dryRun: true });
      expect(result).toBeDefined();
      expect(result.stageCategory).toBe('build');
      // Orchestrator still runs, but no artifact files should be written
      const { readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const files = readdirSync(join(baseDir, 'artifacts')).filter((f) => f.endsWith('.json'));
      expect(files).toHaveLength(0);
    });

    it('accepts optional ruleRegistry without crashing', async () => {
      const mockRuleRegistry = {
        loadRules: vi.fn(() => []),
        addRule: vi.fn(),
        removeRule: vi.fn(),
        suggestRule: vi.fn(() => ({
          id: '00000000-0000-4000-8000-000000000001',
          suggestedRule: { category: 'build', name: 'test', condition: 'always', effect: 'boost', magnitude: 0.3, confidence: 0.7, source: 'auto-detected', evidence: [] },
          triggerDecisionIds: [],
          observationCount: 1,
          reasoning: 'test',
          status: 'pending',
          createdAt: new Date().toISOString(),
        })),
        getPendingSuggestions: vi.fn(() => []),
        acceptSuggestion: vi.fn(),
        rejectSuggestion: vi.fn(),
      };

      const deps = makeDeps({ kataDir: baseDir, ruleRegistry: mockRuleRegistry });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');

      expect(result.stageCategory).toBe('build');
    });

    it('runPipeline passes ruleRegistry to MetaOrchestrator', async () => {
      const flavors = [
        makeFlavor('standard-build', 'build'),
        makeFlavor('code-quality', 'review'),
      ];
      const mockRuleRegistry = {
        loadRules: vi.fn(() => []),
        addRule: vi.fn(),
        removeRule: vi.fn(),
        suggestRule: vi.fn(),
        getPendingSuggestions: vi.fn(() => []),
        acceptSuggestion: vi.fn(),
        rejectSuggestion: vi.fn(),
      };

      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        ruleRegistry: mockRuleRegistry,
      };
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['build']);

      expect(result.stageResults).toHaveLength(1);
      // loadRules is called by the orchestrator when ruleRegistry is wired in
      expect(mockRuleRegistry.loadRules).toHaveBeenCalledWith('build');
    });
  });

  describe('runStage() — yolo option', () => {
    it('runStage with yolo: true completes successfully', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build', { yolo: true });
      expect(result.stageCategory).toBe('build');
    });

    it('runStage with yolo: false uses default threshold (smoke test)', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build', { yolo: false });
      expect(result.stageCategory).toBe('build');
    });
  });

  describe('runStage() — different categories', () => {
    const categories: StageCategory[] = ['research', 'plan', 'build', 'review'];

    for (const category of categories) {
      it(`executes ${category} category`, async () => {
        const flavors = [makeFlavor(`${category}-standard`, category)];
        const deps = makeDeps({
          kataDir: baseDir,
          flavorRegistry: makeFlavorRegistry(flavors),
        });
        const runner = new KiaiRunner(deps);
        const result = await runner.runStage(category);
        expect(result.stageCategory).toBe(category);
      });
    }
  });

  describe('listRecentArtifacts()', () => {
    it('returns empty array when no artifacts exist', () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      expect(runner.listRecentArtifacts()).toEqual([]);
    });

    it('returns artifact entries after a stage run', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const artifacts = runner.listRecentArtifacts();
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0]).toHaveProperty('name');
      expect(artifacts[0]).toHaveProperty('timestamp');
    });
  });

  describe('runPipeline() — happy path', () => {
    function makePipelineDeps(overrides: Partial<KiaiRunnerDeps> = {}): KiaiRunnerDeps {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('plan-standard', 'plan'),
        makeFlavor('build-standard', 'build'),
        makeFlavor('review-standard', 'review'),
      ];

      return {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        ...overrides,
      };
    }

    it('runs a single-stage pipeline', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['build']);
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('runs a multi-stage pipeline in order', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['research', 'plan', 'build']);
      expect(result.stageResults).toHaveLength(3);
      expect(result.stageResults.map((r) => r.stageCategory)).toEqual([
        'research', 'plan', 'build',
      ]);
    });

    it('produces a pipeline reflection', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['build']);
      expect(result.pipelineReflection).toBeDefined();
      expect(result.pipelineReflection.overallQuality).toBeDefined();
      expect(result.pipelineReflection.learnings.length).toBeGreaterThan(0);
    });

    it('persists artifacts for each stage', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.startsWith('research-'))).toBe(true);
      expect(files.some((f) => f.startsWith('build-'))).toBe(true);
    });

    it('dryRun does not persist artifacts', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['research', 'build'], { dryRun: true });
      expect(result.stageResults).toHaveLength(2);
      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
      expect(files).toHaveLength(0);
    });

    it('passes bet to meta-orchestrator', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['build'], { bet: { title: 'Add search' } });
      // The bet context should appear in the capability-analysis decision
      const analysis = result.stageResults[0]!.decisions.find(
        (d) => d.decisionType === 'capability-analysis',
      );
      expect(analysis).toBeDefined();
      const ctx = analysis!.context as Record<string, unknown>;
      expect(ctx.bet).toEqual({ title: 'Add search' });
    });

    it('runPipeline with yolo: true completes successfully', async () => {
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      const result = await runner.runPipeline(['build'], { yolo: true });
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('runPipeline passes yolo option to MetaOrchestrator', async () => {
      const spy = vi.spyOn(MetaOrchestrator.prototype, 'runPipeline');
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['build'], { yolo: true });
      expect(spy).toHaveBeenCalledWith(['build'], undefined, { yolo: true });
      spy.mockRestore();
    });

    it('runPipeline without yolo passes undefined options.yolo to MetaOrchestrator', async () => {
      const spy = vi.spyOn(MetaOrchestrator.prototype, 'runPipeline');
      const deps = makePipelineDeps();
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['build']);
      // options.yolo is undefined when not supplied — threaded as { yolo: undefined }
      expect(spy).toHaveBeenCalledWith(['build'], undefined, { yolo: undefined });
      spy.mockRestore();
    });
  });

  describe('runPipeline() — error handling', () => {
    it('throws OrchestratorError for empty pipeline', async () => {
      const flavors = [makeFlavor('build-standard', 'build')];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await expect(runner.runPipeline([])).rejects.toThrow(OrchestratorError);
    });

    it('throws when no flavors registered for a category', async () => {
      const flavors = [makeFlavor('build-standard', 'build')];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await expect(runner.runPipeline(['research'])).rejects.toThrow(OrchestratorError);
    });
  });

  describe('analytics integration', () => {
    it('records analytics events after runStage', async () => {
      const analytics = new UsageAnalytics(baseDir);
      const deps = makeDeps({ kataDir: baseDir, analytics });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const events = analytics.getEvents();
      expect(events).toHaveLength(1);
      expect(events[0]!.stageCategory).toBe('build');
      expect(events[0]!.selectedFlavors.length).toBeGreaterThan(0);
    });

    it('records analytics events for each stage in runPipeline', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const analytics = new UsageAnalytics(baseDir);
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        analytics,
      };
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const events = analytics.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0]!.stageCategory).toBe('research');
      expect(events[1]!.stageCategory).toBe('build');
    });

    it('does not crash when analytics fails', async () => {
      const analytics = {
        recordEvent: vi.fn(() => { throw new Error('Disk full'); }),
        getEvents: vi.fn(() => []),
        getStats: vi.fn(),
      } as unknown as UsageAnalytics;
      const deps = makeDeps({ kataDir: baseDir, analytics });
      const runner = new KiaiRunner(deps);
      // Should not throw despite analytics failure
      const result = await runner.runStage('build');
      expect(result.stageCategory).toBe('build');
    });
  });

  describe('history entry writing (#215)', () => {
    function readHistoryFiles(dir: string) {
      const historyDir = join(dir, 'history');
      try {
        return readdirSync(historyDir).filter((f) => f.endsWith('.json'));
      } catch {
        return [];
      }
    }

    function readHistoryEntry(dir: string, file: string) {
      const raw = readFileSync(join(dir, 'history', file), 'utf-8');
      return JSON.parse(raw);
    }

    it('writes a history entry after runStage', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      expect(files.length).toBe(1);
    });

    it('history entry passes ExecutionHistoryEntrySchema validation', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      const result = ExecutionHistoryEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('history entry contains all required fields', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);

      expect(entry.id).toBeDefined();
      expect(entry.pipelineId).toBeDefined();
      expect(entry.stageType).toBe('build');
      expect(entry.stageIndex).toBe(0);
      expect(entry.adapter).toBe('manual');
      expect(entry.startedAt).toBeDefined();
      expect(entry.completedAt).toBeDefined();
      expect(entry.artifactNames).toEqual(expect.arrayContaining([expect.any(String)]));
    });

    it('history entry uses provided adapterName', async () => {
      const deps = makeDeps({ kataDir: baseDir, adapterName: 'claude-cli' });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.adapter).toBe('claude-cli');
    });

    it('history entry includes cycleId and betId from bet context', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const cycleId = '00000000-0000-4000-8000-000000000001';
      const betId = '00000000-0000-4000-8000-000000000002';
      await runner.runStage('build', { bet: { cycleId, id: betId } });
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.cycleId).toBe(cycleId);
      expect(entry.betId).toBe(betId);
    });

    it('dryRun does not write history entries', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build', { dryRun: true });
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(0);
    });

    it('writes history entries for each stage in runPipeline', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(2);

      // Verify stageIndex is set correctly
      const entries = files.map((f) => readHistoryEntry(baseDir, f));
      const indices = entries.map((e: { stageIndex: number }) => e.stageIndex).sort();
      expect(indices).toEqual([0, 1]);
    });

    it('pipeline history entries share the same pipelineId', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const files = readHistoryFiles(baseDir);
      const entries = files.map((f) => readHistoryEntry(baseDir, f));
      const pipelineIds = entries.map((e: { pipelineId: string }) => e.pipelineId);
      expect(pipelineIds).toHaveLength(2);
      expect(pipelineIds[0]).toBe(pipelineIds[1]);
    });

    it('pipeline history entries all pass schema validation', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('plan-standard', 'plan'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'plan', 'build']);
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(3);

      for (const file of files) {
        const entry = readHistoryEntry(baseDir, file);
        const result = ExecutionHistoryEntrySchema.safeParse(entry);
        expect(result.success).toBe(true);
      }
    });

    it('dryRun pipeline does not write history entries', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: KiaiRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new KiaiRunner(deps);
      await runner.runPipeline(['research', 'build'], { dryRun: true });
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(0);
    });

    it('history entry has valid durationMs', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('history entry timestamps are valid ISO 8601', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(() => new Date(entry.startedAt)).not.toThrow();
      expect(() => new Date(entry.completedAt)).not.toThrow();
      expect(new Date(entry.startedAt).toISOString()).toBe(entry.startedAt);
      expect(new Date(entry.completedAt).toISOString()).toBe(entry.completedAt);
    });
  });
});
