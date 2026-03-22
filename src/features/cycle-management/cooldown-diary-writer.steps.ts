import { mkdtempSync, rmSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { tmpdir } from 'node:os';
import { After, Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect, vi } from 'vitest';
import { logger } from '@shared/lib/logger.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { BetOutcomeRecord } from './cooldown-session.js';
import type { CooldownDiaryWriter, CooldownDiaryDeps, DiaryEntryInput } from './cooldown-diary-writer.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import type { SessionBuilder } from '@features/dojo/session-builder.js';

type DiaryWriteFn = (input: DiaryEntryInput) => void;
type BuildFn = SessionBuilder['build'];

// -- World -------------------------------------------------------

interface CooldownDiaryWriterWorld extends QuickPickleWorld {
  deps: Partial<CooldownDiaryDeps>;
  cycle: Cycle;
  betOutcomes: BetOutcomeRecord[];
  humanPerspective?: string;
  synthesisProposals?: SynthesisProposal[];
  writer?: CooldownDiaryWriter;
  lastDiaryInput?: Record<string, unknown>;
  enrichedOutcomes?: BetOutcomeRecord[];
  loggerWarnSpy: ReturnType<typeof vi.spyOn>;
  lastError?: Error;
  diaryWriterWriteSpy: ReturnType<typeof vi.fn<DiaryWriteFn>>;
  dojoSessionBuilderSpy?: { build: ReturnType<typeof vi.fn<BuildFn>> };
}

// -- Helpers -----------------------------------------------------

function buildCycle(bets: { id: string; description: string; outcome?: string }[]): Cycle {
  return {
    id: 'cycle-1',
    name: 'Test Cycle',
    budget: {},
    bets: bets.map((b) => ({
      id: b.id,
      description: b.description,
      appetite: 1,
      issueRefs: [],
      outcome: (b.outcome ?? 'pending') as 'pending',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    pipelineMappings: [],
    state: 'cooldown' as const,
    cooldownReserve: 10,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Cycle;
}

async function loadWriter(): Promise<typeof import('./cooldown-diary-writer.js')> {
  return import('./cooldown-diary-writer.js');
}

// -- Background --------------------------------------------------

Given(
  'the diary writer environment is ready',
  (world: CooldownDiaryWriterWorld) => {
    world.deps = {};
    world.cycle = buildCycle([]);
    world.betOutcomes = [];
    world.diaryWriterWriteSpy = vi.fn<DiaryWriteFn>();
    world.loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  },
);

// -- Given: dojo directory configuration -------------------------

Given(
  'the dojo directory is configured',
  (world: CooldownDiaryWriterWorld) => {
    world.deps.dojoDir = mkdtempSync(pathJoin(tmpdir(), 'dojo-bdd-'));
    world.deps.runsDir = '/tmp/test-runs';
    world.deps.knowledgeStore = {
      query: vi.fn().mockReturnValue([]),
      stats: vi.fn().mockReturnValue({ totalLearnings: 0, tiers: {} }),
    } as unknown as CooldownDiaryDeps['knowledgeStore'];
    world.deps.cycleManager = {
      get: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    } as unknown as CooldownDiaryDeps['cycleManager'];
  },
);

Given(
  'the dojo directory is not configured',
  (world: CooldownDiaryWriterWorld) => {
    world.deps.dojoDir = undefined;
  },
);

// -- Given: cycle bets -------------------------------------------

Given(
  'the cycle has bets with descriptions {string} and {string}',
  (world: CooldownDiaryWriterWorld, desc1: string, desc2: string) => {
    world.cycle = buildCycle([
      { id: 'bet-1', description: desc1, outcome: 'complete' },
      { id: 'bet-2', description: desc2, outcome: 'partial' },
    ]);
  },
);

Given(
  'bet outcomes are provided for the cycle',
  (world: CooldownDiaryWriterWorld) => {
    world.betOutcomes = world.cycle.bets.map((b) => ({
      betId: b.id,
      outcome: 'complete' as const,
    }));
  },
);

Given(
  'the cycle has completed and abandoned bets',
  (world: CooldownDiaryWriterWorld) => {
    world.cycle = buildCycle([
      { id: 'bet-1', description: 'Completed bet', outcome: 'complete' },
      { id: 'bet-2', description: 'Abandoned bet', outcome: 'abandoned' },
      { id: 'bet-3', description: 'Pending bet', outcome: 'pending' },
    ]);
  },
);

// -- Given: perspectives -----------------------------------------

Given(
  'a human perspective {string} is provided',
  (world: CooldownDiaryWriterWorld, perspective: string) => {
    world.humanPerspective = perspective;
  },
);

Given(
  'synthesis proposals are available',
  (world: CooldownDiaryWriterWorld) => {
    world.synthesisProposals = [
      {
        id: 'prop-1',
        type: 'new-learning',
        confidence: 0.8,
        citations: [],
        reasoning: 'CI is slow',
        createdAt: new Date().toISOString(),
        proposedTier: 'step',
        proposedCategory: 'tooling',
        proposedContent: 'Improve CI speed',
      } as SynthesisProposal,
    ];
  },
);

// -- Given: diary writer failure ---------------------------------

Given(
  'the diary writer will fail with an internal error',
  (world: CooldownDiaryWriterWorld) => {
    world.diaryWriterWriteSpy.mockImplementation(() => {
      throw new Error('Simulated diary write failure');
    });
  },
);

// -- Given: dojo session builder ---------------------------------

Given(
  'the dojo session builder is configured',
  (world: CooldownDiaryWriterWorld) => {
    world.dojoSessionBuilderSpy = { build: vi.fn<BuildFn>() };
    world.deps.dojoSessionBuilder = world.dojoSessionBuilderSpy;
  },
);

Given(
  'the dojo session builder is not configured',
  (world: CooldownDiaryWriterWorld) => {
    world.deps.dojoSessionBuilder = undefined;
  },
);

Given(
  'the dojo session builder will fail with an internal error',
  (world: CooldownDiaryWriterWorld) => {
    world.dojoSessionBuilderSpy!.build.mockImplementation(() => {
      throw new Error('Simulated dojo session failure');
    });
  },
);

// -- Given: bet outcome enrichment -------------------------------

Given(
  'the cycle has a bet {string} with description {string}',
  (world: CooldownDiaryWriterWorld, betId: string, description: string) => {
    world.cycle = buildCycle([{ id: betId, description }]);
  },
);

Given(
  'a bet outcome exists for {string} without a description',
  (world: CooldownDiaryWriterWorld, betId: string) => {
    world.betOutcomes = [{ betId, outcome: 'complete' as const }];
  },
);

Given(
  'a bet outcome for {string} already has description {string}',
  (world: CooldownDiaryWriterWorld, betId: string, description: string) => {
    world.cycle = buildCycle([{ id: betId, description: 'Cycle description (should be overridden)' }]);
    world.betOutcomes = [{ betId, outcome: 'complete' as const, betDescription: description }];
  },
);

// -- When --------------------------------------------------------

When(
  'a run diary is written',
  async (world: CooldownDiaryWriterWorld) => {
    const { CooldownDiaryWriter: Cls } = await loadWriter();
    world.writer = new Cls({ ...world.deps, diaryWriteFn: world.diaryWriterWriteSpy } as CooldownDiaryDeps);
    try {
      world.writer.writeForRun({
        cycleId: 'cycle-1',

        cycle: world.cycle,
        betOutcomes: world.betOutcomes,
        proposals: [],
        learningsCaptured: 0,
        humanPerspective: world.humanPerspective,
      });
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'a complete diary is written',
  async (world: CooldownDiaryWriterWorld) => {
    const { CooldownDiaryWriter: Cls } = await loadWriter();
    world.writer = new Cls({ ...world.deps, diaryWriteFn: world.diaryWriterWriteSpy } as CooldownDiaryDeps);
    try {
      world.writer.writeForComplete({
        cycleId: 'cycle-1',

        cycle: world.cycle,
        proposals: [],
        synthesisProposals: world.synthesisProposals,
      });
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'a diary entry is written',
  async (world: CooldownDiaryWriterWorld) => {
    const { CooldownDiaryWriter: Cls } = await loadWriter();
    world.writer = new Cls({ ...world.deps, diaryWriteFn: world.diaryWriterWriteSpy } as CooldownDiaryDeps);
    try {
      world.writer.writeForRun({
        cycleId: 'cycle-1',

        cycle: world.cycle,
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
      });
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'bet outcomes are enriched',
  async (world: CooldownDiaryWriterWorld) => {
    const { CooldownDiaryWriter: Cls } = await loadWriter();
    // Test enrichment through writeForRun — enrichBetOutcomesWithDescriptions is private
    world.deps.dojoDir = world.deps.dojoDir ?? '/tmp/enrich-test';
    const writeSpy = vi.fn<DiaryWriteFn>();
    world.writer = new Cls({ ...world.deps, diaryWriteFn: writeSpy } as CooldownDiaryDeps);
    world.writer.writeForRun({
      cycleId: 'cycle-1',
      cycle: world.cycle,
      betOutcomes: world.betOutcomes,
      proposals: [],
      learningsCaptured: 0,
    });
    world.enrichedOutcomes = (writeSpy.mock.calls[0]?.[0] as { betOutcomes: BetOutcomeRecord[] })?.betOutcomes;
  },
);

When(
  'a dojo session is requested',
  async (world: CooldownDiaryWriterWorld) => {
    const { CooldownDiaryWriter: Cls } = await loadWriter();
    world.writer = new Cls(world.deps as CooldownDiaryDeps);
    try {
      world.writer.writeDojoSession('cycle-1', 'Test Cycle');
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

// -- Then: run diary assertions ----------------------------------

Then(
  'the diary entry contains descriptions {string} and {string}',
  (world: CooldownDiaryWriterWorld, desc1: string, desc2: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.diaryWriterWriteSpy).toHaveBeenCalled();
    const input = world.diaryWriterWriteSpy.mock.calls[0]![0] as { betOutcomes: BetOutcomeRecord[] };
    const descriptions = input.betOutcomes.map((b: BetOutcomeRecord) => b.betDescription);
    expect(descriptions).toContain(desc1);
    expect(descriptions).toContain(desc2);
  },
);

Then(
  'the diary entry includes the human perspective {string}',
  (world: CooldownDiaryWriterWorld, perspective: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.diaryWriterWriteSpy).toHaveBeenCalled();
    const input = world.diaryWriterWriteSpy.mock.calls[0]![0] as { humanPerspective?: string };
    expect(input.humanPerspective).toBe(perspective);
  },
);

// -- Then: complete diary assertions -----------------------------

Then(
  'the diary entry contains outcomes for the completed and abandoned bets',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.diaryWriterWriteSpy).toHaveBeenCalled();
    const input = world.diaryWriterWriteSpy.mock.calls[0]![0] as { betOutcomes: BetOutcomeRecord[] };
    const outcomes = input.betOutcomes.map((b: BetOutcomeRecord) => b.outcome);
    expect(outcomes).toContain('complete');
    expect(outcomes).toContain('abandoned');
    // Pending bets should not appear
    expect(outcomes).not.toContain('pending');
  },
);

Then(
  'the diary entry includes an agent perspective summary',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.diaryWriterWriteSpy).toHaveBeenCalled();
    const input = world.diaryWriterWriteSpy.mock.calls[0]![0] as { agentPerspective?: string };
    expect(input.agentPerspective).toBeDefined();
    expect(input.agentPerspective!.length).toBeGreaterThan(0);
  },
);

// -- Then: error handling assertions -----------------------------

Then(
  'a warning is logged about diary write failure',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msgs = world.loggerWarnSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const failMsg = msgs.find((m: string) => m.includes('diary'));
    expect(failMsg).toBeDefined();
  },
);

Then(
  'a warning is logged about dojo session failure',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msgs = world.loggerWarnSpy.mock.calls.map((c: unknown[]) => c[0] as string);
    const failMsg = msgs.find((m: string) => m.includes('dojo session for cycle'));
    expect(failMsg).toBeDefined();
  },
);

// -- Then: enrichment assertions ---------------------------------

Then(
  'the enriched outcome for {string} has description {string}',
  (world: CooldownDiaryWriterWorld, betId: string, description: string) => {
    expect(world.enrichedOutcomes).toBeDefined();
    const outcome = world.enrichedOutcomes!.find((o) => o.betId === betId);
    expect(outcome).toBeDefined();
    expect(outcome!.betDescription).toBe(description);
  },
);

// -- Then: dojo session assertions -------------------------------

Then(
  'a dojo session is built from aggregated cycle data',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.dojoSessionBuilderSpy).toBeDefined();
    expect(world.dojoSessionBuilderSpy!.build).toHaveBeenCalled();
  },
);

Then(
  'no dojo session is generated',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.dojoSessionBuilderSpy) {
      expect(world.dojoSessionBuilderSpy.build).not.toHaveBeenCalled();
    }
  },
);

// -- Then: diary skip assertions ---------------------------------

Then(
  'no diary entry is written',
  (world: CooldownDiaryWriterWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.diaryWriterWriteSpy).not.toHaveBeenCalled();
  },
);

// 'cooldown continues normally' step is shared - defined in bridge-run-syncer.steps.ts

// -- Cleanup -----------------------------------------------------

After(async (world: CooldownDiaryWriterWorld) => {
  vi.restoreAllMocks();
  const dojoDir = world.deps?.dojoDir;
  if (dojoDir && dojoDir.includes('dojo-bdd-')) {
    try { rmSync(dojoDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
