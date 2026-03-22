import { After, Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect, vi } from 'vitest';
import { logger } from '@shared/lib/logger.js';
import { CooldownFollowUpRunner, type CooldownFollowUpDeps } from './cooldown-follow-up-runner.js';
import type { PredictionMatcher } from '@features/self-improvement/prediction-matcher.js';
import type { CalibrationDetector } from '@features/self-improvement/calibration-detector.js';
import type { HierarchicalPromoter } from '@infra/knowledge/hierarchical-promoter.js';
import type { FrictionAnalyzer } from '@features/self-improvement/friction-analyzer.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { Learning } from '@domain/types/learning.js';

type MatchFn = PredictionMatcher['match'];
type DetectFn = CalibrationDetector['detect'];
type AnalyzeFn = FrictionAnalyzer['analyze'];
type PromoteStepToFlavorFn = HierarchicalPromoter['promoteStepToFlavor'];
type PromoteFlavorToStageFn = HierarchicalPromoter['promoteFlavorToStage'];
type PromoteStageToCategoryFn = HierarchicalPromoter['promoteStageToCategory'];

// -- World -------------------------------------------------------

interface CooldownFollowUpRunnerWorld extends QuickPickleWorld {
  predictionMatcherSpy?: { match: ReturnType<typeof vi.fn<MatchFn>> };
  calibrationDetectorSpy?: { detect: ReturnType<typeof vi.fn<DetectFn>> };
  hierarchicalPromoterSpy?: {
    promoteStepToFlavor: ReturnType<typeof vi.fn<PromoteStepToFlavorFn>>;
    promoteFlavorToStage: ReturnType<typeof vi.fn<PromoteFlavorToStageFn>>;
    promoteStageToCategory: ReturnType<typeof vi.fn<PromoteStageToCategoryFn>>;
  };
  frictionAnalyzerSpy?: { analyze: ReturnType<typeof vi.fn<AnalyzeFn>> };
  knowledgeStoreSpy: {
    query: ReturnType<typeof vi.fn>;
    checkExpiry?: ReturnType<typeof vi.fn>;
  };
  cycle: Cycle;
  runner?: CooldownFollowUpRunner;
  loggerWarnSpy: ReturnType<typeof vi.fn>;
  loggerDebugSpy: ReturnType<typeof vi.fn>;
  lastError?: Error;
}

// -- Helpers -----------------------------------------------------

function buildCycle(bets: { runId?: string }[]): Cycle {
  return {
    id: 'cycle-1',
    name: 'Test Cycle',
    budget: {},
    bets: bets.map((b, i) => ({
      id: `bet-${i + 1}`,
      description: `Bet ${i + 1}`,
      appetite: 1,
      issueRefs: [],
      outcome: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...b,
    })),
    pipelineMappings: [],
    state: 'cooldown' as const,
    cooldownReserve: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Cycle;
}

function buildRunner(world: CooldownFollowUpRunnerWorld): CooldownFollowUpRunner {
  const deps: CooldownFollowUpDeps = {
    predictionMatcher: world.predictionMatcherSpy ?? null,
    calibrationDetector: world.calibrationDetectorSpy ?? null,
    hierarchicalPromoter: world.hierarchicalPromoterSpy ?? {
      promoteStepToFlavor: vi.fn<PromoteStepToFlavorFn>().mockReturnValue({ learnings: [], events: [] }),
      promoteFlavorToStage: vi.fn<PromoteFlavorToStageFn>().mockReturnValue({ learnings: [], events: [] }),
      promoteStageToCategory: vi.fn<PromoteStageToCategoryFn>(),
    },
    frictionAnalyzer: world.frictionAnalyzerSpy ?? null,
    knowledgeStore: world.knowledgeStoreSpy as unknown as CooldownFollowUpDeps['knowledgeStore'],
  };
  return new CooldownFollowUpRunner(deps);
}

// -- Background --------------------------------------------------

Given(
  'the follow-up pipeline environment is ready',
  (world: CooldownFollowUpRunnerWorld) => {
    world.knowledgeStoreSpy = { query: vi.fn().mockReturnValue([]) };
    world.cycle = buildCycle([]);
    world.loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    world.loggerDebugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  },
);

// -- Given: prediction matching ----------------------------------

Given(
  'prediction matching is enabled',
  (world: CooldownFollowUpRunnerWorld) => {
    world.predictionMatcherSpy = { match: vi.fn<MatchFn>() };
  },
);

Given(
  'prediction matching is not enabled',
  (_world: CooldownFollowUpRunnerWorld) => {
    // predictionMatcherSpy left undefined -> null dep
  },
);

Given(
  'prediction matching will fail for run {string}',
  (world: CooldownFollowUpRunnerWorld, failRunId: string) => {
    world.predictionMatcherSpy!.match.mockImplementation((runId: string) => {
      if (runId === failRunId) throw new Error(`Prediction matching failed for ${runId}`);
      return { runId, matched: [], unmatched: [], reflectionsWritten: 0 };
    });
  },
);

// -- Given: calibration detection --------------------------------

Given(
  'calibration detection is enabled',
  (world: CooldownFollowUpRunnerWorld) => {
    world.calibrationDetectorSpy = { detect: vi.fn<DetectFn>() };
  },
);

Given(
  'calibration detection is not enabled',
  (_world: CooldownFollowUpRunnerWorld) => {
    // calibrationDetectorSpy left undefined -> null dep
  },
);

// -- Given: hierarchical promotion -------------------------------

Given(
  'hierarchical promotion is enabled',
  (world: CooldownFollowUpRunnerWorld) => {
    world.hierarchicalPromoterSpy = {
      promoteStepToFlavor: vi.fn<PromoteStepToFlavorFn>().mockReturnValue({ learnings: [{ id: 'flavor-1' } as Learning], events: [] }),
      promoteFlavorToStage: vi.fn<PromoteFlavorToStageFn>().mockReturnValue({ learnings: [{ id: 'stage-1' } as Learning], events: [] }),
      promoteStageToCategory: vi.fn<PromoteStageToCategoryFn>(),
    };
  },
);

Given(
  'the knowledge store contains step-tier learnings',
  (world: CooldownFollowUpRunnerWorld) => {
    world.knowledgeStoreSpy.query.mockReturnValue([{ id: 'step-1', tier: 'step' } as Learning]);
  },
);

Given(
  'hierarchical promotion will fail with an internal error',
  (world: CooldownFollowUpRunnerWorld) => {
    world.hierarchicalPromoterSpy!.promoteStepToFlavor.mockImplementation(() => {
      throw new Error('Simulated promotion failure');
    });
  },
);

// -- Given: expiry checking --------------------------------------

Given(
  'expiry checking is available',
  (world: CooldownFollowUpRunnerWorld) => {
    world.knowledgeStoreSpy.checkExpiry = vi.fn().mockReturnValue({ archived: [], flaggedStale: [] });
  },
);

Given(
  'learnings have expired',
  (world: CooldownFollowUpRunnerWorld) => {
    world.knowledgeStoreSpy.checkExpiry!.mockReturnValue({
      archived: [{ id: 'expired-1' } as Learning],
      flaggedStale: [{ id: 'stale-1' } as Learning],
    });
  },
);

Given(
  'expiry checking is not available',
  (_world: CooldownFollowUpRunnerWorld) => {
    // checkExpiry left undefined on knowledgeStoreSpy - duck-type check will skip
  },
);

Given(
  'the expiry check will fail with an internal error',
  (world: CooldownFollowUpRunnerWorld) => {
    world.knowledgeStoreSpy.checkExpiry!.mockImplementation(() => {
      throw new Error('Simulated expiry failure');
    });
  },
);

// -- Given: friction analysis ------------------------------------

Given(
  'friction analysis is enabled',
  (world: CooldownFollowUpRunnerWorld) => {
    world.frictionAnalyzerSpy = { analyze: vi.fn<AnalyzeFn>() };
  },
);

Given(
  'friction analysis is not enabled',
  (_world: CooldownFollowUpRunnerWorld) => {
    // frictionAnalyzerSpy left undefined -> null dep
  },
);

// -- Given: cycle bets -------------------------------------------

Given(
  'the cycle has bets with runs {string} and {string}',
  (world: CooldownFollowUpRunnerWorld, runId1: string, runId2: string) => {
    world.cycle = buildCycle([{ runId: runId1 }, { runId: runId2 }]);
  },
);

Given(
  'the cycle has bets with runs {string}',
  (world: CooldownFollowUpRunnerWorld, runId: string) => {
    world.cycle = buildCycle([{ runId }]);
  },
);

Given(
  'the cycle has a bet without a run',
  (world: CooldownFollowUpRunnerWorld) => {
    world.cycle = buildCycle([{}]); // no runId
  },
);

// -- When --------------------------------------------------------

When(
  'the follow-up pipeline runs',
  (world: CooldownFollowUpRunnerWorld) => {
    world.runner = buildRunner(world);
    try {
      world.runner.run(world.cycle);
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

// -- Then: prediction matching assertions ------------------------

Then(
  'predictions are matched for run {string}',
  (world: CooldownFollowUpRunnerWorld, runId: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.predictionMatcherSpy).toBeDefined();
    const calls = world.predictionMatcherSpy!.match.mock.calls as [string][];
    const match = calls.find(([id]) => id === runId);
    expect(match).toBeDefined();
  },
);

Then(
  'no prediction matching occurs',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.predictionMatcherSpy) {
      expect(world.predictionMatcherSpy.match).not.toHaveBeenCalled();
    }
  },
);

// -- Then: calibration detection assertions ----------------------

Then(
  'calibration is checked for run {string}',
  (world: CooldownFollowUpRunnerWorld, runId: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.calibrationDetectorSpy).toBeDefined();
    const calls = world.calibrationDetectorSpy!.detect.mock.calls as [string][];
    const match = calls.find(([id]) => id === runId);
    expect(match).toBeDefined();
  },
);

Then(
  'no calibration detection occurs',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.calibrationDetectorSpy) {
      expect(world.calibrationDetectorSpy.detect).not.toHaveBeenCalled();
    }
  },
);

// -- Then: hierarchical promotion assertions ---------------------

Then(
  'step learnings are promoted to flavor tier',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.hierarchicalPromoterSpy!.promoteStepToFlavor).toHaveBeenCalled();
  },
);

Then(
  'flavor learnings are promoted to stage tier',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.hierarchicalPromoterSpy!.promoteFlavorToStage).toHaveBeenCalled();
  },
);

Then(
  'stage learnings are promoted to category tier',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.hierarchicalPromoterSpy!.promoteStageToCategory).toHaveBeenCalled();
  },
);

// -- Then: expiry check assertions -------------------------------

Then(
  'expired learnings are flagged',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.knowledgeStoreSpy.checkExpiry).toHaveBeenCalled();
  },
);

Then(
  'no expiry check occurs',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    // checkExpiry is undefined on the spy - duck-type check should have skipped it
    if (world.knowledgeStoreSpy.checkExpiry) {
      expect(world.knowledgeStoreSpy.checkExpiry).not.toHaveBeenCalled();
    }
  },
);

// -- Then: friction analysis assertions --------------------------

Then(
  'friction is analyzed for run {string}',
  (world: CooldownFollowUpRunnerWorld, runId: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.frictionAnalyzerSpy).toBeDefined();
    const calls = world.frictionAnalyzerSpy!.analyze.mock.calls as [string][];
    const match = calls.find(([id]) => id === runId);
    expect(match).toBeDefined();
  },
);

Then(
  'no friction analysis occurs',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.frictionAnalyzerSpy) {
      expect(world.frictionAnalyzerSpy.analyze).not.toHaveBeenCalled();
    }
  },
);

// -- Then: pipeline ordering assertions --------------------------

Then(
  'predictions are matched before calibration is checked for run {string}',
  (world: CooldownFollowUpRunnerWorld, runId: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.predictionMatcherSpy).toBeDefined();
    expect(world.calibrationDetectorSpy).toBeDefined();

    const matchCalls = world.predictionMatcherSpy!.match.mock.calls as [string][];
    const detectCalls = world.calibrationDetectorSpy!.detect.mock.calls as [string][];
    const matchIdx = matchCalls.findIndex(([id]) => id === runId);
    const detectIdx = detectCalls.findIndex(([id]) => id === runId);
    expect(matchIdx).toBeGreaterThanOrEqual(0);
    expect(detectIdx).toBeGreaterThanOrEqual(0);

    // Verify ordering via invocation call order
    const matchOrder = world.predictionMatcherSpy!.match.mock.invocationCallOrder[matchIdx]!;
    const detectOrder = world.calibrationDetectorSpy!.detect.mock.invocationCallOrder[detectIdx]!;
    expect(matchOrder).toBeLessThan(detectOrder);
  },
);

// -- Then: safety assertions -------------------------------------

Then(
  'a warning is logged about hierarchical promotion failure',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msg = world.loggerWarnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('Hierarchical learning promotion failed');
  },
);

Then(
  'a warning is logged about expiry check failure',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msgs = world.loggerWarnSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const expiryMsg = msgs.find((m) => m.includes('Learning expiry check failed'));
    expect(expiryMsg).toBeDefined();
  },
);

Then(
  'a warning is logged about the run failure',
  (world: CooldownFollowUpRunnerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msgs = world.loggerWarnSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const failMsg = msgs.find((m) => m.includes('failed for run'));
    expect(failMsg).toBeDefined();
  },
);

// -- Cleanup -----------------------------------------------------

After((_world: CooldownFollowUpRunnerWorld) => {
  vi.restoreAllMocks();
});

// 'cooldown continues normally' step is shared - defined in bridge-run-syncer.steps.ts
