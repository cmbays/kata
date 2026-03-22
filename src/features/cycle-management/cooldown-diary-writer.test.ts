import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import { logger } from '@shared/lib/logger.js';
import { CooldownDiaryWriter, type CooldownDiaryDeps } from './cooldown-diary-writer.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { BetOutcomeRecord } from './cooldown-session.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';

function makeCycle(bets: { id: string; description: string; outcome?: string }[]): Cycle {
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

function makeDeps(overrides: Partial<CooldownDiaryDeps> = {}): CooldownDiaryDeps {
  return {
    dojoDir: '/tmp/test-dojo',
    knowledgeStore: { query: vi.fn().mockReturnValue([]) } as unknown as CooldownDiaryDeps['knowledgeStore'],
    cycleManager: { get: vi.fn(), list: vi.fn().mockReturnValue([]) } as unknown as CooldownDiaryDeps['cycleManager'],
    ...overrides,
  };
}

describe('CooldownDiaryWriter', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeForRun()', () => {
    it('writes a diary entry with enriched bet descriptions', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));
      const cycle = makeCycle([
        { id: 'bet-1', description: 'Redesign login', outcome: 'complete' },
      ]);

      writer.writeForRun({
        cycleId: 'cycle-1',

        cycle,
        betOutcomes: [{ betId: 'bet-1', outcome: 'complete' }],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(writeSpy).toHaveBeenCalledTimes(1);
      const input = writeSpy.mock.calls[0]![0];
      expect(input.betOutcomes[0].betDescription).toBe('Redesign login');
    });

    it('passes human perspective through to diary entry', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
        humanPerspective: 'Team felt rushed',
      });

      expect(writeSpy.mock.calls[0]![0].humanPerspective).toBe('Team felt rushed');
    });

    it('skips when dojoDir is not configured', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ dojoDir: undefined, diaryWriteFn: writeSpy }));

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('writeForComplete()', () => {
    it('derives bet outcomes from cycle state, filtering pending bets', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));
      const cycle = makeCycle([
        { id: 'bet-1', description: 'Done', outcome: 'complete' },
        { id: 'bet-2', description: 'Dropped', outcome: 'abandoned' },
        { id: 'bet-3', description: 'Still going', outcome: 'pending' },
      ]);

      writer.writeForComplete({
        cycleId: 'cycle-1',
        cycle,
        proposals: [],
      });

      const outcomes = writeSpy.mock.calls[0]![0].betOutcomes;
      expect(outcomes).toHaveLength(2);
      expect(outcomes.map((o: BetOutcomeRecord) => o.outcome)).toEqual(['complete', 'abandoned']);
    });

    it('includes agent perspective from synthesis proposals', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));
      const proposals: SynthesisProposal[] = [
        { id: 'p1', summary: 'Speed up CI', type: 'new-learning', confidence: 0.8, proposedTier: 'step', proposedCategory: 'tooling', proposedContent: 'CI is slow' } as SynthesisProposal,
      ];

      writer.writeForComplete({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        proposals: [],
        synthesisProposals: proposals,
      });

      expect(writeSpy.mock.calls[0]![0].agentPerspective).toBeDefined();
      expect(writeSpy.mock.calls[0]![0].agentPerspective.length).toBeGreaterThan(0);
    });

    it('skips when dojoDir is not configured', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ dojoDir: undefined, diaryWriteFn: writeSpy }));

      writer.writeForComplete({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        proposals: [],
      });

      expect(writeSpy).not.toHaveBeenCalled();
    });
  });

  describe('bet outcome enrichment (via writeForRun)', () => {
    it('fills missing betDescription from cycle bets', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));
      const cycle = makeCycle([{ id: 'bet-1', description: 'Ship dashboard' }]);

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle,
        betOutcomes: [{ betId: 'bet-1', outcome: 'complete' }],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(writeSpy.mock.calls[0]![0].betOutcomes[0].betDescription).toBe('Ship dashboard');
    });

    it('preserves existing betDescription', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));
      const cycle = makeCycle([{ id: 'bet-1', description: 'Cycle desc' }]);

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle,
        betOutcomes: [{ betId: 'bet-1', outcome: 'complete', betDescription: 'Pre-existing note' }],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(writeSpy.mock.calls[0]![0].betOutcomes[0].betDescription).toBe('Pre-existing note');
    });

    it('handles bet without matching cycle entry', () => {
      const writeSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        betOutcomes: [{ betId: 'bet-orphan', outcome: 'complete' }],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(writeSpy.mock.calls[0]![0].betOutcomes[0].betDescription).toBeUndefined();
    });
  });

  describe('writeDojoSession()', () => {
    it('calls builder when both dojoDir and dojoSessionBuilder are set', () => {
      const tmpDojoDir = mkdtempSync(join(tmpdir(), 'dojo-test-'));
      try {
        const buildSpy = vi.fn();
        const writer = new CooldownDiaryWriter(makeDeps({
          dojoDir: tmpDojoDir,
          runsDir: '/tmp/runs',
          knowledgeStore: {
            query: vi.fn().mockReturnValue([]),
            stats: vi.fn().mockReturnValue({ totalLearnings: 0, tiers: {} }),
          } as unknown as CooldownDiaryDeps['knowledgeStore'],
          dojoSessionBuilder: { build: buildSpy },
        }));

        writer.writeDojoSession('cycle-1', 'Test');

        expect(buildSpy).toHaveBeenCalled();
      } finally {
        rmSync(tmpDojoDir, { recursive: true, force: true });
      }
    });

    it('skips when dojoDir is not configured', () => {
      const buildSpy = vi.fn();
      const writer = new CooldownDiaryWriter(makeDeps({
        dojoDir: undefined,
        dojoSessionBuilder: { build: buildSpy },
      }));

      writer.writeDojoSession('cycle-1');

      expect(buildSpy).not.toHaveBeenCalled();
    });

    it('skips when dojoSessionBuilder is not configured', () => {
      const writer = new CooldownDiaryWriter(makeDeps({
        dojoSessionBuilder: undefined,
      }));

      // Should not throw
      writer.writeDojoSession('cycle-1');
    });

    it('logs warning on failure', () => {
      const writer = new CooldownDiaryWriter(makeDeps({
        dojoSessionBuilder: {
          build: vi.fn().mockImplementation(() => {
            throw new Error('build broke');
          }),
        },
      }));

      writer.writeDojoSession('cycle-1');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dojo session for cycle'));
    });

    it('logs non-Error throws as strings', () => {
      const tmpDojoDir = mkdtempSync(join(tmpdir(), 'dojo-test-'));
      try {
        const writer = new CooldownDiaryWriter(makeDeps({
          dojoDir: tmpDojoDir,
          runsDir: '/tmp/runs',
          knowledgeStore: {
            query: vi.fn().mockReturnValue([]),
            stats: vi.fn().mockReturnValue({ totalLearnings: 0, tiers: {} }),
          } as unknown as CooldownDiaryDeps['knowledgeStore'],
          dojoSessionBuilder: {
            build: vi.fn().mockImplementation(() => {
              throw 'string error'; // eslint-disable-line no-throw-literal
            }),
          },
        }));

        writer.writeDojoSession('cycle-1');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
      } finally {
        rmSync(tmpDojoDir, { recursive: true, force: true });
      }
    });
  });

  describe('diary entry error handling', () => {
    it('logs warning when diary write fails', () => {
      const writeSpy = vi.fn().mockImplementation(() => {
        throw new Error('write broke');
      });
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('diary'));
    });

    it('logs non-Error throws as strings in diary write', () => {
      const writeSpy = vi.fn().mockImplementation(() => {
        throw 42; // eslint-disable-line no-throw-literal
      });
      const writer = new CooldownDiaryWriter(makeDeps({ diaryWriteFn: writeSpy }));

      writer.writeForRun({
        cycleId: 'cycle-1',
        cycle: makeCycle([]),
        betOutcomes: [],
        proposals: [],
        learningsCaptured: 0,
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('42'));
    });
  });
});
