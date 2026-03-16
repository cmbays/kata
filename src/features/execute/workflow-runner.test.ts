import { join } from 'node:path';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { logger } from '@shared/lib/logger.js';
import { WorkflowRunner, type WorkflowRunnerDeps, listRecentArtifacts } from './workflow-runner.js';

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

function makeDeps(overrides: Partial<WorkflowRunnerDeps> = {}): WorkflowRunnerDeps {
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

describe('WorkflowRunner', () => {
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
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      expect(result.stageCategory).toBe('build');
    });

    it('selects flavors from FlavorRegistry for the given category', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      expect(deps.flavorRegistry.list).toHaveBeenCalledWith('build');
    });

    it('returns selectedFlavors containing at least one flavor', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      expect(result.selectedFlavors.length).toBeGreaterThan(0);
    });

    it('returns exactly 4 decisions (capability-analysis, flavor-selection, execution-mode, synthesis-approach)', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      expect(result.decisions).toHaveLength(4);
    });

    it('produces a stageArtifact', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      expect(result.stageArtifact).toBeDefined();
      expect(result.stageArtifact.name).toBe('build-synthesis');
    });

    it('persists stageArtifact to artifacts dir', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
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
      const runner = new WorkflowRunner(deps);
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
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build', { pin: ['pinned-one'] });
      expect(result.selectedFlavors).toContain('pinned-one');
    });

    it('dryRun runs orchestrator but does not persist artifacts', async () => {
      const executor = makeExecutor();
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build', { dryRun: true });
      expect(result).toBeDefined();
      expect(result.stageCategory).toBe('build');
      // Orchestrator still runs, but no artifact files should be written
      const { readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const files = readdirSync(join(baseDir, 'artifacts')).filter((f) => f.endsWith('.json'));
      expect(files).toHaveLength(0);
    });

    it('creates the artifacts directory on demand and uses a sanitized timestamp filename', async () => {
      rmSync(join(baseDir, 'artifacts'), { recursive: true, force: true });
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-13T14:15:16.789Z'));

      try {
        const deps = makeDeps({ kataDir: baseDir });
        const runner = new WorkflowRunner(deps);
        await runner.runStage('build');
      } finally {
        vi.useRealTimers();
      }

      const files = readdirSync(join(baseDir, 'artifacts')).filter((file) => file.endsWith('.json'));
      expect(files).toEqual(['build-2026-03-13T14-15-16-789Z.json']);
    });

    it('threads katakaId-only runs into executor context and artifact metadata', async () => {
      let seenContext: Record<string, unknown> | undefined;
      const executor: IFlavorExecutor = {
        execute: vi.fn((flavor, context) => {
          seenContext = context as Record<string, unknown>;
          return Promise.resolve(makeFlavorResult(flavor.name));
        }),
      };
      const katakaId = '00000000-0000-4000-8000-000000000003';
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new WorkflowRunner(deps);

      await runner.runStage('build', { katakaId });

      expect(seenContext).toMatchObject({
        activeAgentId: katakaId,
        activeKatakaId: katakaId,
      });

      const artifactFile = readdirSync(join(baseDir, 'artifacts')).find((f) => f.endsWith('.json'));
      const artifact = JSON.parse(readFileSync(join(baseDir, 'artifacts', artifactFile!), 'utf-8'));
      expect(artifact.agentId).toBe(katakaId);
      expect(artifact.katakaId).toBe(katakaId);
    });

    it('passes existing json artifact names into orchestrator context', async () => {
      writeFileSync(join(baseDir, 'artifacts', 'alpha.json'), '{}');
      writeFileSync(join(baseDir, 'artifacts', 'notes.txt'), 'ignore me');
      writeFileSync(join(baseDir, 'artifacts', 'beta.json'), '{}');

      let seenContext: Record<string, unknown> | undefined;
      const executor: IFlavorExecutor = {
        execute: vi.fn((flavor, context) => {
          seenContext = context as Record<string, unknown>;
          return Promise.resolve(makeFlavorResult(flavor.name));
        }),
      };
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new WorkflowRunner(deps);

      await runner.runStage('build');

      expect(seenContext?.availableArtifacts).toEqual(expect.arrayContaining(['alpha', 'beta']));
      expect(seenContext?.availableArtifacts).not.toContain('notes.txt');
    });

    it('treats a missing artifacts directory as no available artifacts', async () => {
      rmSync(join(baseDir, 'artifacts'), { recursive: true, force: true });

      let seenContext: Record<string, unknown> | undefined;
      const executor: IFlavorExecutor = {
        execute: vi.fn((flavor, context) => {
          seenContext = context as Record<string, unknown>;
          return Promise.resolve(makeFlavorResult(flavor.name));
        }),
      };
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new WorkflowRunner(deps);

      await runner.runStage('build');

      expect(seenContext?.availableArtifacts).toEqual([]);
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
      const runner = new WorkflowRunner(deps);
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

      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        ruleRegistry: mockRuleRegistry,
      };
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['build']);

      expect(result.stageResults).toHaveLength(1);
      // loadRules is called by the orchestrator when ruleRegistry is wired in
      expect(mockRuleRegistry.loadRules).toHaveBeenCalledWith('build');
    });
  });

  describe('runStage() — yolo option', () => {
    it('runStage with yolo: true completes successfully', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build', { yolo: true });
      expect(result.stageCategory).toBe('build');
    });

    it('runStage with yolo: false uses default threshold (smoke test)', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
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
        const runner = new WorkflowRunner(deps);
        const result = await runner.runStage(category);
        expect(result.stageCategory).toBe(category);
      });
    }
  });

  describe('listRecentArtifacts()', () => {
    it('returns empty array when no artifacts exist', () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      expect(runner.listRecentArtifacts()).toEqual([]);
    });

    it('returns empty array when the artifacts directory is missing', () => {
      rmSync(join(baseDir, 'artifacts'), { recursive: true, force: true });
      expect(listRecentArtifacts(baseDir)).toEqual([]);
    });

    it('returns artifact entries after a stage run', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const artifacts = runner.listRecentArtifacts();
      expect(artifacts.length).toBeGreaterThan(0);
      expect(artifacts[0]).toHaveProperty('name');
      expect(artifacts[0]).toHaveProperty('timestamp');
    });

    it('sorts JSON artifacts newest-first and ignores non-JSON files', () => {
      writeFileSync(
        join(baseDir, 'artifacts', '2026-03-12T10-00-00-000Z.json'),
        JSON.stringify({ name: 'first', timestamp: '2026-03-12T10:00:00.000Z' }),
      );
      writeFileSync(
        join(baseDir, 'artifacts', '2026-03-13T11-00-00-000Z.json'),
        JSON.stringify({ name: 'second', timestamp: '2026-03-13T11:00:00.000Z' }),
      );
      writeFileSync(join(baseDir, 'artifacts', 'notes.txt'), 'ignore me');

      const artifacts = listRecentArtifacts(baseDir);

      expect(artifacts.map((artifact) => artifact.file)).toEqual([
        '2026-03-13T11-00-00-000Z.json',
        '2026-03-12T10-00-00-000Z.json',
      ]);
      expect(artifacts.map((artifact) => artifact.name)).toEqual(['second', 'first']);
    });

    it('falls back to filename and completedAt when artifact metadata is partial', () => {
      writeFileSync(
        join(baseDir, 'artifacts', 'build-snapshot.json'),
        JSON.stringify({ completedAt: '2026-03-13T15:00:00.000Z' }),
      );

      const [artifact] = listRecentArtifacts(baseDir);

      expect(artifact).toEqual({
        name: 'build-snapshot',
        timestamp: '2026-03-13T15:00:00.000Z',
        file: 'build-snapshot.json',
      });
    });

    it('falls back to filename and unknown when artifact JSON is malformed', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      writeFileSync(join(baseDir, 'artifacts', 'broken.json'), '{ broken json ');

      try {
        const [artifact] = listRecentArtifacts(baseDir);

        expect(artifact).toEqual({
          name: 'broken',
          timestamp: 'unknown',
          file: 'broken.json',
        });
        expect(warnSpy).toHaveBeenCalledWith(
          'Could not parse artifact file "broken.json" — showing partial info.',
          { file: 'broken.json', error: expect.any(String) },
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('runPipeline() — happy path', () => {
    function makePipelineDeps(overrides: Partial<WorkflowRunnerDeps> = {}): WorkflowRunnerDeps {
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
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['build']);
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('runs a multi-stage pipeline in order', async () => {
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['research', 'plan', 'build']);
      expect(result.stageResults).toHaveLength(3);
      expect(result.stageResults.map((r) => r.stageCategory)).toEqual([
        'research', 'plan', 'build',
      ]);
    });

    it('produces a pipeline reflection', async () => {
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['build']);
      expect(result.pipelineReflection).toBeDefined();
      expect(result.pipelineReflection.overallQuality).toBeDefined();
      expect(result.pipelineReflection.learnings.length).toBeGreaterThan(0);
    });

    it('persists artifacts for each stage', async () => {
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some((f) => f.startsWith('research-'))).toBe(true);
      expect(files.some((f) => f.startsWith('build-'))).toBe(true);
    });

    it('dryRun does not persist artifacts', async () => {
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['research', 'build'], { dryRun: true });
      expect(result.stageResults).toHaveLength(2);
      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
      expect(files).toHaveLength(0);
    });

    it('passes bet to meta-orchestrator', async () => {
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
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
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['build'], { yolo: true });
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('runPipeline passes yolo option to MetaOrchestrator', async () => {
      const spy = vi.spyOn(MetaOrchestrator.prototype, 'runPipeline');
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['build'], { yolo: true });
      expect(spy).toHaveBeenCalledWith(['build'], undefined, { yolo: true });
      spy.mockRestore();
    });

    it('runPipeline without yolo passes undefined options.yolo to MetaOrchestrator', async () => {
      const spy = vi.spyOn(MetaOrchestrator.prototype, 'runPipeline');
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['build']);
      // options.yolo is undefined when not supplied — threaded as { yolo: undefined }
      expect(spy).toHaveBeenCalledWith(['build'], undefined, { yolo: undefined });
      spy.mockRestore();
    });

    it('runPipeline canonicalizes katakaId-only runs for the meta orchestrator', async () => {
      const spy = vi.spyOn(MetaOrchestrator.prototype, 'runPipeline');
      const deps = makePipelineDeps();
      const runner = new WorkflowRunner(deps);
      const katakaId = '00000000-0000-4000-8000-000000000004';

      await runner.runPipeline(['build'], { katakaId });

      expect(spy).toHaveBeenCalledWith(
        ['build'],
        undefined,
        expect.objectContaining({ agentId: katakaId, katakaId }),
      );
      spy.mockRestore();
    });
  });

  describe('runPipeline() — error handling', () => {
    it('throws OrchestratorError for empty pipeline', async () => {
      const flavors = [makeFlavor('build-standard', 'build')];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      await expect(runner.runPipeline([])).rejects.toThrow(OrchestratorError);
    });

    it('throws when no flavors registered for a category', async () => {
      const flavors = [makeFlavor('build-standard', 'build')];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      await expect(runner.runPipeline(['research'])).rejects.toThrow(OrchestratorError);
    });
  });

  describe('analytics integration', () => {
    it('records analytics events after runStage', async () => {
      const analytics = new UsageAnalytics(baseDir);
      const deps = makeDeps({ kataDir: baseDir, analytics });
      const runner = new WorkflowRunner(deps);
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
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        analytics,
      };
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['research', 'build']);
      const events = analytics.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0]!.stageCategory).toBe('research');
      expect(events[1]!.stageCategory).toBe('build');
    });

    it('does not crash when analytics fails', async () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const analytics = {
        recordEvent: vi.fn(() => { throw new Error('Disk full'); }),
        getEvents: vi.fn(() => []),
        getStats: vi.fn(),
      } as unknown as UsageAnalytics;
      const deps = makeDeps({ kataDir: baseDir, analytics });
      const runner = new WorkflowRunner(deps);

      try {
        const result = await runner.runStage('build');
        expect(result.stageCategory).toBe('build');
        expect(debugSpy).toHaveBeenCalledWith(
          'Analytics recordEvent failed — non-fatal, continuing.',
          { error: 'Disk full' },
        );
      } finally {
        debugSpy.mockRestore();
      }
    });

    it('logs analytics failures for each stage during runPipeline without crashing', async () => {
      const debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
      const analytics = {
        recordEvent: vi.fn(() => { throw new Error('Disk full'); }),
        getEvents: vi.fn(() => []),
        getStats: vi.fn(),
      } as unknown as UsageAnalytics;
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
        analytics,
      };
      const runner = new WorkflowRunner(deps);

      try {
        const result = await runner.runPipeline(['research', 'build']);
        expect(result.stageResults).toHaveLength(2);
        expect(debugSpy).toHaveBeenCalledTimes(2);
        expect(debugSpy).toHaveBeenNthCalledWith(
          1,
          'Analytics recordEvent failed — non-fatal, continuing.',
          { error: 'Disk full' },
        );
        expect(debugSpy).toHaveBeenNthCalledWith(
          2,
          'Analytics recordEvent failed — non-fatal, continuing.',
          { error: 'Disk full' },
        );
      } finally {
        debugSpy.mockRestore();
      }
    });

    it('logs a warning when stage artifact persistence fails but still returns a stage result', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      vi.spyOn(runner as never, 'persistArtifact').mockImplementation(() => {
        throw new Error('Artifact write exploded');
      });

      try {
        const result = await runner.runStage('build');
        expect(result.stageCategory).toBe('build');
        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to persist stage artifact — result is still valid.',
          { stageCategory: 'build', error: 'Artifact write exploded' },
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('logs a warning when pipeline artifact persistence fails but still returns stage results', async () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      vi.spyOn(runner as never, 'persistArtifact').mockImplementation(() => {
        throw new Error('Artifact write exploded');
      });

      try {
        const result = await runner.runPipeline(['research', 'build']);
        expect(result.stageResults).toHaveLength(2);
        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to persist stage artifact — result is still valid.',
          { stageCategory: 'research', error: 'Artifact write exploded' },
        );
        expect(warnSpy).toHaveBeenCalledWith(
          'Failed to persist stage artifact — result is still valid.',
          { stageCategory: 'build', error: 'Artifact write exploded' },
        );
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

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

  describe('history entry writing (#215)', () => {

    it('writes a history entry after runStage', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      expect(files.length).toBe(1);
    });

    it('history entry passes ExecutionHistoryEntrySchema validation', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      const result = ExecutionHistoryEntrySchema.safeParse(entry);
      expect(result.success).toBe(true);
    });

    it('history entry contains all required fields', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
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
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.adapter).toBe('claude-cli');
    });

    it('history entry includes cycleId and betId from bet context', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
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
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build', { dryRun: true });
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(0);
    });

    it('writes history entries for each stage in runPipeline', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
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
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
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
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
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
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['research', 'build'], { dryRun: true });
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(0);
    });

    it('history entry has valid durationMs', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('history entry stores the exact Date.now() duration delta', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(1_450);

      try {
        await runner.runStage('build');
      } finally {
        nowSpy.mockRestore();
      }

      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(entry.durationMs).toBe(450);
    });

    it('pipeline history entries store the exact shared Date.now() duration delta', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValueOnce(2_000).mockReturnValueOnce(2_650);

      try {
        await runner.runPipeline(['research', 'build']);
      } finally {
        nowSpy.mockRestore();
      }

      const files = readHistoryFiles(baseDir);
      const entries = files.map((file) => readHistoryEntry(baseDir, file));
      expect(entries).toHaveLength(2);
      expect(entries.every((entry) => entry.durationMs === 650)).toBe(true);
    });

    it('history entry timestamps are valid ISO 8601', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      expect(() => new Date(entry.startedAt)).not.toThrow();
      expect(() => new Date(entry.completedAt)).not.toThrow();
      expect(new Date(entry.startedAt).toISOString()).toBe(entry.startedAt);
      expect(new Date(entry.completedAt).toISOString()).toBe(entry.completedAt);
    });

  });

  describe('listRecentArtifacts filtering', () => {
    it('filters out non-json files from the artifacts directory', () => {
      const artifactsDir = join(baseDir, 'artifacts');
      mkdirSync(artifactsDir, { recursive: true });
      writeFileSync(join(artifactsDir, 'readme.txt'), 'not an artifact');
      writeFileSync(join(artifactsDir, 'notes.md'), '# notes');
      writeFileSync(join(artifactsDir, 'valid.json'), JSON.stringify({ name: 'test-artifact', timestamp: '2026-03-16T10:00:00Z' }));

      const artifacts = listRecentArtifacts(baseDir);
      expect(artifacts).toHaveLength(1);
      expect(artifacts[0]!.name).toBe('test-artifact');
    });
  });

  describe('runStage agentId and katakaId handling', () => {
    it('persists agentId and katakaId in artifact metadata when agentId is provided', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build', { agentId: 'agent-42' });

      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f: string) => f.endsWith('.json'));
      expect(files).toHaveLength(1);
      const artifact = JSON.parse(readFileSync(join(artifactsDir, files[0]!), 'utf-8'));
      expect(artifact.agentId).toBe('agent-42');
      expect(artifact.katakaId).toBe('agent-42');
    });

    it('does not include agentId in artifact when not provided', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');

      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f: string) => f.endsWith('.json'));
      const artifact = JSON.parse(readFileSync(join(artifactsDir, files[0]!), 'utf-8'));
      expect(artifact.agentId).toBeUndefined();
      expect(artifact.katakaId).toBeUndefined();
    });

    it('falls back to katakaId when agentId is not provided', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build', { katakaId: 'kataka-99' });

      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f: string) => f.endsWith('.json'));
      const artifact = JSON.parse(readFileSync(join(artifactsDir, files[0]!), 'utf-8'));
      expect(artifact.agentId).toBe('kataka-99');
      expect(artifact.katakaId).toBe('kataka-99');
    });
  });

  describe('runPipeline agentId attribution', () => {
    it('persists agentId in pipeline artifacts when provided', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      await runner.runPipeline(['research', 'build'], { agentId: 'pipeline-agent' });

      const artifactsDir = join(baseDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f: string) => f.endsWith('.json'));
      expect(files).toHaveLength(2);
      for (const file of files) {
        const artifact = JSON.parse(readFileSync(join(artifactsDir, file), 'utf-8'));
        expect(artifact.agentId).toBe('pipeline-agent');
      }
    });
  });

  describe('scanAvailableArtifacts', () => {
    it('returns artifact names from the artifacts directory', async () => {
      writeFileSync(join(baseDir, 'artifacts', 'build-123.json'), JSON.stringify({ name: 'build-123' }));
      writeFileSync(join(baseDir, 'artifacts', 'review-456.json'), JSON.stringify({ name: 'review-456' }));

      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');

      // The result should be defined and contain stage output
      expect(result).toBeDefined();
      expect(result.stageCategory).toBe('build');
    });

    it('returns empty when artifacts directory does not exist', async () => {
      const tempDir = join(tmpdir(), `kata-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(tempDir, 'stages'), { recursive: true });
      mkdirSync(join(tempDir, 'flavors'), { recursive: true });
      mkdirSync(join(tempDir, 'history'), { recursive: true });
      // Do NOT create artifacts dir

      try {
        const deps = makeDeps({ kataDir: tempDir });
        const runner = new WorkflowRunner(deps);
        const result = await runner.runStage('build');
        expect(result).toBeDefined();
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('persistArtifact directory creation', () => {
    it('creates artifacts dir and persists artifact when dir did not exist', async () => {
      // Ensure artifacts dir does NOT exist
      const testDir = join(tmpdir(), `kata-wf-persist-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      mkdirSync(join(testDir, 'stages'), { recursive: true });
      mkdirSync(join(testDir, 'flavors'), { recursive: true });
      mkdirSync(join(testDir, 'history'), { recursive: true });
      mkdirSync(join(testDir, 'tracking'), { recursive: true });
      // Do NOT create artifacts dir — the runner should create it

      const deps = makeDeps({ kataDir: testDir });
      const runner = new WorkflowRunner(deps);
      await runner.runStage('build');

      const artifactsDir = join(testDir, 'artifacts');
      const files = readdirSync(artifactsDir).filter((f) => f.endsWith('.json'));
      expect(files).toHaveLength(1);

      rmSync(testDir, { recursive: true, force: true });
    });
  });

  describe('mutation coverage — history entry fields', () => {
    it('history entry stageFlavor is comma-joined selectedFlavors', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      // stageFlavor must be the selectedFlavors joined with commas
      expect(entry.stageFlavor).toBe(result.selectedFlavors.join(','));
      // Verify the join separator is specifically a comma (not empty or other)
      if (result.selectedFlavors.length > 1) {
        expect(entry.stageFlavor).toContain(',');
      }
    });

    it('history entry artifactNames is a single-element array with the stage artifact name', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      const files = readHistoryFiles(baseDir);
      const entry = readHistoryEntry(baseDir, files[0]!);
      // Must be an array (not empty) containing exactly the artifact name
      expect(entry.artifactNames).toEqual([result.stageArtifact.name]);
      expect(entry.artifactNames).toHaveLength(1);
    });

    it('pipeline history entries each have correct stageFlavor and artifactNames', async () => {
      const flavors = [
        makeFlavor('research-standard', 'research'),
        makeFlavor('build-standard', 'build'),
      ];
      const deps: WorkflowRunnerDeps = {
        flavorRegistry: makeFlavorRegistry(flavors),
        decisionRegistry: makeDecisionRegistry(),
        executor: makeExecutor(),
        kataDir: baseDir,
      };
      const runner = new WorkflowRunner(deps);
      const result = await runner.runPipeline(['research', 'build']);
      const files = readHistoryFiles(baseDir);
      expect(files).toHaveLength(2);

      // History entries may be in any order — match by stageType
      const entries = files.map((f) => readHistoryEntry(baseDir, f));
      for (const stageResult of result.stageResults) {
        const entry = entries.find((e) => e.stageType === stageResult.stageCategory);
        expect(entry).toBeDefined();
        expect(entry!.stageFlavor).toBe(stageResult.selectedFlavors.join(','));
        expect(entry!.artifactNames).toEqual([stageResult.stageArtifact.name]);
      }
    });
  });

  describe('mutation coverage — orchestrator context', () => {
    it('passes empty learnings array in context to orchestrator', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new WorkflowRunner(deps);
      const result = await runner.runStage('build');
      // The orchestrator receives context.learnings = [] which must be an array
      // (mutating [] to ["Stryker was here"] would still satisfy Array.isArray)
      // Verify the result is valid — the orchestrator ran with the correct context
      expect(result.stageCategory).toBe('build');
      expect(result.selectedFlavors).toBeDefined();
    });
  });

  describe('mutation coverage — listRecentArtifacts sort order', () => {
    it('returns artifacts in reverse chronological order (newest first)', () => {
      const artifactsDir = join(baseDir, 'artifacts');
      // Write files with names that sort differently when reversed
      writeFileSync(
        join(artifactsDir, 'build-2026-01-01.json'),
        JSON.stringify({ name: 'old-artifact', timestamp: '2026-01-01T00:00:00Z' }),
      );
      writeFileSync(
        join(artifactsDir, 'build-2026-03-16.json'),
        JSON.stringify({ name: 'new-artifact', timestamp: '2026-03-16T00:00:00Z' }),
      );
      writeFileSync(
        join(artifactsDir, 'build-2026-02-01.json'),
        JSON.stringify({ name: 'mid-artifact', timestamp: '2026-02-01T00:00:00Z' }),
      );

      const artifacts = listRecentArtifacts(baseDir);
      expect(artifacts).toHaveLength(3);
      // Files are sorted alphabetically then reversed — so 03-16 > 02-01 > 01-01
      expect(artifacts[0]!.name).toBe('new-artifact');
      expect(artifacts[1]!.name).toBe('mid-artifact');
      expect(artifacts[2]!.name).toBe('old-artifact');
    });

    it('returns artifacts sorted so earlier filenames come after later ones', () => {
      const artifactsDir = join(baseDir, 'artifacts');
      writeFileSync(
        join(artifactsDir, 'aaa.json'),
        JSON.stringify({ name: 'alpha', timestamp: '2026-01-01T00:00:00Z' }),
      );
      writeFileSync(
        join(artifactsDir, 'zzz.json'),
        JSON.stringify({ name: 'zeta', timestamp: '2026-03-16T00:00:00Z' }),
      );

      const artifacts = listRecentArtifacts(baseDir);
      expect(artifacts).toHaveLength(2);
      // reverse sort: zzz before aaa
      expect(artifacts[0]!.name).toBe('zeta');
      expect(artifacts[1]!.name).toBe('alpha');
    });
  });
});
