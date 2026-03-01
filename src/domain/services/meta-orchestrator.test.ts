import { describe, it, expect, vi } from 'vitest';
import type { Flavor } from '@domain/types/flavor.js';
import type { IFlavorRegistry } from '@domain/ports/flavor-registry.js';
import type { IDecisionRegistry } from '@domain/ports/decision-registry.js';
import type {
  IFlavorExecutor,
  FlavorExecutionResult,
} from '@domain/ports/stage-orchestrator.js';
import { FlavorNotFoundError, OrchestratorError } from '@shared/lib/errors.js';
import { MetaOrchestrator, type MetaOrchestratorDeps } from './meta-orchestrator.js';

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

function makeExecutor(): IFlavorExecutor {
  return {
    execute: vi.fn((flavor: Flavor) =>
      Promise.resolve(makeFlavorResult(flavor.name)),
    ),
  };
}

function makeDeps(overrides: Partial<MetaOrchestratorDeps> & { flavors?: Flavor[] } = {}): MetaOrchestratorDeps {
  const {
    flavors = [
      makeFlavor('research-standard', 'research'),
      makeFlavor('plan-standard', 'plan'),
      makeFlavor('build-standard', 'build'),
      makeFlavor('review-standard', 'review'),
    ],
    ...rest
  } = overrides;
  return {
    flavorRegistry: makeFlavorRegistry(flavors),
    decisionRegistry: makeDecisionRegistry(),
    executor: makeExecutor(),
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetaOrchestrator', () => {
  describe('runPipeline() — happy path', () => {
    it('runs a single-stage pipeline', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['build']);
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('runs a multi-stage pipeline in order', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'plan', 'build', 'review']);
      expect(result.stageResults).toHaveLength(4);
      expect(result.stageResults.map((r) => r.stageCategory)).toEqual([
        'research', 'plan', 'build', 'review',
      ]);
    });

    it('passes artifacts from earlier stages to later stages', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'build']);

      // The build stage should have received the research stage's artifact
      const buildDecisions = result.stageResults[1]!.decisions;
      const analysisDecision = buildDecisions.find((d) => d.decisionType === 'capability-analysis');
      expect(analysisDecision).toBeDefined();
      // The context should include the research synthesis artifact
      const ctx = analysisDecision!.context as Record<string, unknown>;
      const artifacts = ctx.availableArtifacts as string[];
      expect(artifacts).toContain('research-synthesis');
    });

    it('returns pipeline-level reflection', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['build']);
      expect(result.pipelineReflection).toBeDefined();
      expect(result.pipelineReflection.overallQuality).toBe('good');
      expect(result.pipelineReflection.learnings.length).toBeGreaterThan(0);
    });

    it('pipeline reflection aggregates learnings from all stages', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'build']);
      // Should have pipeline summary + per-stage learnings
      expect(result.pipelineReflection.learnings.length).toBeGreaterThan(1);
      expect(result.pipelineReflection.learnings[0]).toContain('research');
      expect(result.pipelineReflection.learnings[0]).toContain('build');
    });

    it('passes bet context to all stages', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const bet = { title: 'Add search feature' };
      const result = await meta.runPipeline(['research', 'build'], bet);

      // Both stages should have the bet in their capability-analysis decision
      for (const stageResult of result.stageResults) {
        const analysis = stageResult.decisions.find((d) => d.decisionType === 'capability-analysis');
        expect(analysis).toBeDefined();
        const ctx = analysis!.context as Record<string, unknown>;
        expect(ctx.bet).toEqual(bet);
      }
    });

    it('each stage produces a stageArtifact', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'plan']);
      expect(result.stageResults[0]!.stageArtifact.name).toBe('research-synthesis');
      expect(result.stageResults[1]!.stageArtifact.name).toBe('plan-synthesis');
    });
  });

  describe('runPipeline() — error handling', () => {
    it('throws OrchestratorError for empty pipeline', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      await expect(meta.runPipeline([])).rejects.toThrow(OrchestratorError);
    });

    it('throws OrchestratorError when no flavors registered for a category', async () => {
      const deps = makeDeps({ flavors: [makeFlavor('build-standard', 'build')] });
      const meta = new MetaOrchestrator(deps);
      // research has no flavors
      await expect(meta.runPipeline(['research'])).rejects.toThrow(OrchestratorError);
    });

    it('propagates stage execution errors', async () => {
      const executor: IFlavorExecutor = {
        execute: vi.fn().mockRejectedValue(new OrchestratorError('executor failure')),
      };
      const deps = makeDeps({ executor });
      const meta = new MetaOrchestrator(deps);
      await expect(meta.runPipeline(['build'])).rejects.toThrow(OrchestratorError);
    });
  });

  describe('runPipeline() — yolo option', () => {
    it('accepts yolo: true and runs successfully', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['build'], undefined, { yolo: true });
      expect(result.stageResults).toHaveLength(1);
      expect(result.stageResults[0]!.stageCategory).toBe('build');
    });

    it('accepts yolo: false and runs successfully', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['build'], undefined, { yolo: false });
      expect(result.stageResults).toHaveLength(1);
    });

    it('yolo: true works in a multi-stage pipeline', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'build'], undefined, { yolo: true });
      expect(result.stageResults).toHaveLength(2);
      expect(result.stageResults.map((r) => r.stageCategory)).toEqual(['research', 'build']);
    });

    it('yolo: true still produces pipeline reflection', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['build'], undefined, { yolo: true });
      expect(result.pipelineReflection).toBeDefined();
      expect(result.pipelineReflection.overallQuality).toBeDefined();
    });
  });

  describe('runPipeline() — artifact handoff', () => {
    it('first stage gets empty availableArtifacts', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research']);
      const analysis = result.stageResults[0]!.decisions.find(
        (d) => d.decisionType === 'capability-analysis',
      )!;
      const ctx = analysis.context as Record<string, unknown>;
      expect(ctx.availableArtifacts).toEqual([]);
    });

    it('second stage gets first stage artifact name in availableArtifacts', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'plan']);
      const planAnalysis = result.stageResults[1]!.decisions.find(
        (d) => d.decisionType === 'capability-analysis',
      )!;
      const ctx = planAnalysis.context as Record<string, unknown>;
      const artifacts = ctx.availableArtifacts as string[];
      expect(artifacts).toContain('research-synthesis');
    });

    it('third stage gets both prior stage artifacts', async () => {
      const deps = makeDeps();
      const meta = new MetaOrchestrator(deps);
      const result = await meta.runPipeline(['research', 'plan', 'build']);
      const buildAnalysis = result.stageResults[2]!.decisions.find(
        (d) => d.decisionType === 'capability-analysis',
      )!;
      const ctx = buildAnalysis.context as Record<string, unknown>;
      const artifacts = ctx.availableArtifacts as string[];
      expect(artifacts).toContain('research-synthesis');
      expect(artifacts).toContain('plan-synthesis');
    });
  });
});
