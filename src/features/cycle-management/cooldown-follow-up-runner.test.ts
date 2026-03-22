import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
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

function makeCycle(bets: { runId?: string }[]): Cycle {
  return {
    id: 'cycle-1',
    name: 'Test',
    budget: {},
    bets: bets.map((b, i) => ({
      id: `bet-${i}`,
      description: `Bet ${i}`,
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

function makePromoter() {
  return {
    promoteStepToFlavor: vi.fn<PromoteStepToFlavorFn>().mockReturnValue({ learnings: [{ id: 'f1' } as Learning], events: [] }),
    promoteFlavorToStage: vi.fn<PromoteFlavorToStageFn>().mockReturnValue({ learnings: [{ id: 's1' } as Learning], events: [] }),
    promoteStageToCategory: vi.fn<PromoteStageToCategoryFn>(),
  };
}

function makeDeps(overrides: Partial<CooldownFollowUpDeps> = {}): CooldownFollowUpDeps {
  return {
    predictionMatcher: null,
    calibrationDetector: null,
    hierarchicalPromoter: makePromoter(),
    frictionAnalyzer: null,
    knowledgeStore: { query: vi.fn().mockReturnValue([]) },
    ...overrides,
  };
}

describe('CooldownFollowUpRunner', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    debugSpy = vi.spyOn(logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run() orchestration', () => {
    it('calls all enabled analyses in order', () => {
      const matchSpy = vi.fn<MatchFn>();
      const detectSpy = vi.fn<DetectFn>();
      const analyzeSpy = vi.fn<AnalyzeFn>();
      const promoter = makePromoter();
      const querySpy = vi.fn().mockReturnValue([{ id: 'l1' } as Learning]);

      const runner = new CooldownFollowUpRunner({
        predictionMatcher: { match: matchSpy },
        calibrationDetector: { detect: detectSpy },
        hierarchicalPromoter: promoter,
        frictionAnalyzer: { analyze: analyzeSpy },
        knowledgeStore: { query: querySpy },
      });

      const cycle = makeCycle([{ runId: 'r1' }]);
      runner.run(cycle);

      expect(matchSpy).toHaveBeenCalledWith('r1');
      expect(detectSpy).toHaveBeenCalledWith('r1');
      expect(promoter.promoteStepToFlavor).toHaveBeenCalled();
      expect(analyzeSpy).toHaveBeenCalledWith('r1');
    });

    it('runs prediction matching before calibration detection', () => {
      const matchSpy = vi.fn<MatchFn>();
      const detectSpy = vi.fn<DetectFn>();

      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
        calibrationDetector: { detect: detectSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }]));

      const matchOrder = matchSpy.mock.invocationCallOrder[0]!;
      const detectOrder = detectSpy.mock.invocationCallOrder[0]!;
      expect(matchOrder).toBeLessThan(detectOrder);
    });

    it('runs for each bet with a runId', () => {
      const matchSpy = vi.fn<MatchFn>();
      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }, { runId: 'r2' }, {}]));

      expect(matchSpy).toHaveBeenCalledTimes(2);
      expect(matchSpy).toHaveBeenCalledWith('r1');
      expect(matchSpy).toHaveBeenCalledWith('r2');
    });

    it('skips bets without runId', () => {
      const matchSpy = vi.fn<MatchFn>();
      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
      }));

      runner.run(makeCycle([{}]));

      expect(matchSpy).not.toHaveBeenCalled();
    });
  });

  describe('prediction matching', () => {
    it('no-ops when predictionMatcher is null', () => {
      const runner = new CooldownFollowUpRunner(makeDeps());
      runner.run(makeCycle([{ runId: 'r1' }]));
      // Should not throw
    });

    it('isolates per-run failures', () => {
      const matchSpy = vi.fn<MatchFn>().mockImplementation((runId: string) => {
        if (runId === 'r1') throw new Error('match broke');
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }, { runId: 'r2' }]));

      expect(matchSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Prediction matching failed for run r1'));
    });
  });

  describe('calibration detection', () => {
    it('no-ops when calibrationDetector is null', () => {
      const runner = new CooldownFollowUpRunner(makeDeps());
      runner.run(makeCycle([{ runId: 'r1' }]));
    });

    it('detects for each bet run', () => {
      const detectSpy = vi.fn<DetectFn>();
      const runner = new CooldownFollowUpRunner(makeDeps({
        calibrationDetector: { detect: detectSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }, { runId: 'r2' }]));

      expect(detectSpy).toHaveBeenCalledWith('r1');
      expect(detectSpy).toHaveBeenCalledWith('r2');
    });
  });

  describe('hierarchical promotion', () => {
    it('promotes step -> flavor -> stage -> category', () => {
      const promoter = makePromoter();
      const querySpy = vi.fn().mockReturnValue([{ id: 'step-1' } as Learning]);
      const runner = new CooldownFollowUpRunner(makeDeps({
        hierarchicalPromoter: promoter,
        knowledgeStore: { query: querySpy },
      }));

      runner.run(makeCycle([]));

      expect(querySpy).toHaveBeenCalledWith({ tier: 'step' });
      expect(promoter.promoteStepToFlavor).toHaveBeenCalledWith(
        [{ id: 'step-1' }],
        'cooldown-retrospective',
      );
      expect(promoter.promoteFlavorToStage).toHaveBeenCalledWith(
        [{ id: 'f1' }],
        'cooldown',
      );
      expect(promoter.promoteStageToCategory).toHaveBeenCalledWith([{ id: 's1' }]);
    });

    it('swallows promotion errors and logs warning', () => {
      const promoter = makePromoter();
      promoter.promoteStepToFlavor.mockImplementation(() => {
        throw new Error('promotion broke');
      });
      const runner = new CooldownFollowUpRunner(makeDeps({ hierarchicalPromoter: promoter }));

      runner.run(makeCycle([]));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Hierarchical learning promotion failed'));
    });

    it('logs non-Error throws as strings', () => {
      const promoter = makePromoter();
      promoter.promoteStepToFlavor.mockImplementation(() => {
        throw 'string error'; // eslint-disable-line no-throw-literal
      });
      const runner = new CooldownFollowUpRunner(makeDeps({ hierarchicalPromoter: promoter }));

      runner.run(makeCycle([]));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
    });
  });

  describe('expiry check', () => {
    it('calls checkExpiry when available', () => {
      const checkExpiry = vi.fn().mockReturnValue({ archived: [], flaggedStale: [] });
      const runner = new CooldownFollowUpRunner(makeDeps({
        knowledgeStore: { query: vi.fn().mockReturnValue([]), checkExpiry },
      }));

      runner.run(makeCycle([]));

      expect(checkExpiry).toHaveBeenCalled();
    });

    it('skips when checkExpiry is not a function', () => {
      const runner = new CooldownFollowUpRunner(makeDeps({
        knowledgeStore: { query: vi.fn().mockReturnValue([]) },
      }));

      // Should not throw — duck-type check skips
      runner.run(makeCycle([]));
    });

    it('logs debug messages for expiry results', () => {
      const checkExpiry = vi.fn().mockReturnValue({
        archived: [{ id: 'a1' }],
        flaggedStale: [{ id: 's1' }],
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        knowledgeStore: { query: vi.fn().mockReturnValue([]), checkExpiry },
      }));

      runner.run(makeCycle([]));

      expect(debugSpy).toHaveBeenCalled();
    });

    it('swallows expiry errors and logs warning', () => {
      const checkExpiry = vi.fn().mockImplementation(() => {
        throw new Error('expiry broke');
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        knowledgeStore: { query: vi.fn().mockReturnValue([]), checkExpiry },
      }));

      runner.run(makeCycle([]));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Learning expiry check failed'));
    });

    it('logs non-Error throws as strings in expiry', () => {
      const checkExpiry = vi.fn().mockImplementation(() => {
        throw 42; // eslint-disable-line no-throw-literal
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        knowledgeStore: { query: vi.fn().mockReturnValue([]), checkExpiry },
      }));

      runner.run(makeCycle([]));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    });
  });

  describe('friction analysis', () => {
    it('no-ops when frictionAnalyzer is null', () => {
      const runner = new CooldownFollowUpRunner(makeDeps());
      runner.run(makeCycle([{ runId: 'r1' }]));
    });

    it('analyzes friction for each bet run', () => {
      const analyzeSpy = vi.fn<AnalyzeFn>();
      const runner = new CooldownFollowUpRunner(makeDeps({
        frictionAnalyzer: { analyze: analyzeSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }, { runId: 'r2' }]));

      expect(analyzeSpy).toHaveBeenCalledWith('r1');
      expect(analyzeSpy).toHaveBeenCalledWith('r2');
    });
  });

  describe('per-run error isolation', () => {
    it('continues after a run failure', () => {
      const matchSpy = vi.fn<MatchFn>().mockImplementation((runId: string) => {
        if (runId === 'r1') throw new Error('run broke');
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }, { runId: 'r2' }]));

      expect(matchSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('logs non-Error throws in per-run handler', () => {
      const matchSpy = vi.fn<MatchFn>().mockImplementation(() => {
        throw 'string run error'; // eslint-disable-line no-throw-literal
      });
      const runner = new CooldownFollowUpRunner(makeDeps({
        predictionMatcher: { match: matchSpy },
      }));

      runner.run(makeCycle([{ runId: 'r1' }]));

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('string run error'));
    });
  });
});
