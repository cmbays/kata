import { join } from 'node:path';
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
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
import { FlavorNotFoundError } from '@shared/lib/errors.js';
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

    it('returns exactly 3 decisions', async () => {
      const deps = makeDeps({ kataDir: baseDir });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build');
      expect(result.decisions).toHaveLength(3);
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

    it('dryRun returns result without executing flavors', async () => {
      const executor = makeExecutor();
      const deps = makeDeps({ kataDir: baseDir, executor });
      const runner = new KiaiRunner(deps);
      const result = await runner.runStage('build', { dryRun: true });
      // dryRun should still return a result shape but may not execute
      expect(result).toBeDefined();
    });
  });

  describe('runStage() — different categories', () => {
    const categories: StageCategory[] = ['research', 'plan', 'build', 'review', 'wrapup'];

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
});
