import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { vi } from 'vitest';
import { logger } from '@shared/lib/logger.js';
import { CooldownSynthesisManager, type CooldownSynthesisDeps } from './cooldown-synthesis-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { CooldownReport } from '@domain/services/cycle-manager.js';

const TEST_CYCLE_ID = '00000000-0000-4000-8000-000000000001';

function makeCycle(bets: { id: string; description: string; runId?: string }[]): Cycle {
  return {
    id: TEST_CYCLE_ID,
    name: 'Test Cycle',
    budget: {},
    bets: bets.map((b) => ({
      id: b.id,
      description: b.description,
      runId: b.runId,
      appetite: 1,
      issueRefs: [],
      outcome: 'pending' as const,
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

function makeReport(): CooldownReport {
  return { budget: { tokenBudget: 1000 }, tokensUsed: 500 } as CooldownReport;
}

function makeKnowledgeStore(overrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  return {
    capture: vi.fn(),
    update: vi.fn(),
    promoteTier: vi.fn(),
    archiveLearning: vi.fn(),
    get: vi.fn().mockReturnValue({ confidence: 0.5, content: 'Old content' }),
    query: vi.fn().mockReturnValue([]),
    ...overrides,
  } as unknown as IKnowledgeStore;
}

function makeDeps(overrides: Partial<CooldownSynthesisDeps> = {}): CooldownSynthesisDeps {
  return {
    synthesisDir: '/tmp/test-synthesis',
    runsDir: '/tmp/test-runs',
    knowledgeStore: makeKnowledgeStore(),
    loadBridgeRunIdsByBetId: vi.fn().mockReturnValue(new Map()),
    ...overrides,
  };
}

function makeProposal(type: string, overrides: Record<string, unknown> = {}): SynthesisProposal {
  const base = {
    id: crypto.randomUUID(),
    confidence: 0.8,
    citations: [crypto.randomUUID(), crypto.randomUUID()],
    reasoning: 'Test',
    createdAt: new Date().toISOString(),
  };
  switch (type) {
    case 'new-learning':
      return { ...base, type: 'new-learning', proposedContent: 'Insight', proposedTier: 'step', proposedCategory: 'tooling', ...overrides } as SynthesisProposal;
    case 'update-learning':
      return { ...base, type: 'update-learning', targetLearningId: crypto.randomUUID(), proposedContent: 'Updated', confidenceDelta: 0.1, ...overrides } as SynthesisProposal;
    case 'promote':
      return { ...base, type: 'promote', targetLearningId: crypto.randomUUID(), fromTier: 'step', toTier: 'flavor', ...overrides } as SynthesisProposal;
    case 'archive':
      return { ...base, type: 'archive', targetLearningId: crypto.randomUUID(), reason: 'Outdated', ...overrides } as SynthesisProposal;
    case 'methodology-recommendation':
      return { ...base, type: 'methodology-recommendation', area: 'testing', recommendation: 'More tests', ...overrides } as SynthesisProposal;
    default:
      return { ...base, type, ...overrides } as SynthesisProposal;
  }
}

describe('CooldownSynthesisManager', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('writeInput()', () => {
    it('writes a synthesis input file to the synthesis directory', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir }));
        const result = mgr.writeInput(TEST_CYCLE_ID, makeCycle([]), makeReport(), 'standard');

        expect(result.synthesisInputId).toBeTruthy();
        expect(result.synthesisInputPath).toContain(tmpDir);
        const files = readdirSync(tmpDir).filter((f) => f.startsWith('pending-'));
        expect(files).toHaveLength(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns placeholder when synthesisDir is not configured', () => {
      const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: undefined }));
      const result = mgr.writeInput(TEST_CYCLE_ID, makeCycle([]), makeReport(), 'standard');

      expect(result.synthesisInputId).toBeTruthy();
      expect(result.synthesisInputPath).toBe('');
    });

    it('queries learnings from knowledge store', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const ks = makeKnowledgeStore();
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore: ks }));
        mgr.writeInput(TEST_CYCLE_ID, makeCycle([]), makeReport(), 'standard');

        expect(ks.query).toHaveBeenCalled();
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('cleans up stale input files for the same cycle', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      writeFileSync(join(tmpDir, 'pending-old.json'), JSON.stringify({ cycleId: TEST_CYCLE_ID }));
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir }));
        mgr.writeInput(TEST_CYCLE_ID, makeCycle([]), makeReport(), 'standard');

        const files = readdirSync(tmpDir);
        expect(files).not.toContain('pending-old.json');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('preserves input files for other cycles', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      writeFileSync(join(tmpDir, 'pending-other.json'), JSON.stringify({ cycleId: 'other-cycle' }));
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir }));
        mgr.writeInput(TEST_CYCLE_ID, makeCycle([]), makeReport(), 'standard');

        const files = readdirSync(tmpDir);
        expect(files).toContain('pending-other.json');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('skips bets without run identifiers', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const runsDir = mkdtempSync(join(tmpdir(), 'runs-test-'));
      try {
        const cycle = makeCycle([{ id: 'bet-1', description: 'No run' }]);
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, runsDir }));
        const result = mgr.writeInput(TEST_CYCLE_ID, cycle, makeReport(), 'standard');

        expect(result.synthesisInputPath).toContain(tmpDir);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(runsDir, { recursive: true, force: true });
      }
    });

    it('uses bridge-run lookup for bets without direct run IDs', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const runsDir = mkdtempSync(join(tmpdir(), 'runs-test-'));
      const bridgeMap = new Map([['bet-1', 'run-bridge']]);
      try {
        const cycle = makeCycle([{ id: 'bet-1', description: 'Indirect' }]);
        const mgr = new CooldownSynthesisManager(makeDeps({
          synthesisDir: tmpDir,
          runsDir,
          loadBridgeRunIdsByBetId: vi.fn().mockReturnValue(bridgeMap),
        }));
        const result = mgr.writeInput(TEST_CYCLE_ID, cycle, makeReport(), 'standard');

        expect(result.synthesisInputPath).toContain(tmpDir);
        // run-bridge doesn't exist so observations will be empty, but the lookup happened
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
        rmSync(runsDir, { recursive: true, force: true });
      }
    });

    it('logs warning when write fails and returns empty path', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      try {
        // Use a read-only dir or mock to trigger write failure
        // Easiest: pass a cycle with an invalid ID that fails schema validation
        const badCycle = makeCycle([]);
        badCycle.id = 'not-a-uuid'; // Will fail SynthesisInputSchema validation (cycleId: z.string().uuid())
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir }));
        const result = mgr.writeInput('not-a-uuid', badCycle, makeReport(), 'standard');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('synthesis input'));
        expect(result.synthesisInputPath).toBe('');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('readAndApplyResults()', () => {
    it('reads result file and applies accepted proposals', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const p1 = makeProposal('new-learning');
      const p2 = makeProposal('new-learning');
      writeFileSync(join(tmpDir, 'result-input-1.json'), JSON.stringify({ inputId: crypto.randomUUID(), proposals: [p1, p2] }));
      const ks = makeKnowledgeStore();
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore: ks }));
        const result = mgr.readAndApplyResults('input-1', [p1.id]);

        expect(result).toHaveLength(1);
        expect(ks.capture).toHaveBeenCalledTimes(1);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('applies all proposals when no filter is provided', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const p1 = makeProposal('new-learning');
      const p2 = makeProposal('new-learning');
      writeFileSync(join(tmpDir, 'result-input-1.json'), JSON.stringify({ inputId: crypto.randomUUID(), proposals: [p1, p2] }));
      const ks = makeKnowledgeStore();
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore: ks }));
        const result = mgr.readAndApplyResults('input-1');

        expect(result).toHaveLength(2);
        expect(ks.capture).toHaveBeenCalledTimes(2);
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('returns undefined when no result file exists', () => {
      const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: '/tmp/nonexistent' }));
      const result = mgr.readAndApplyResults('missing-id');

      expect(result).toBeUndefined();
    });

    it('returns undefined when synthesisDir is not configured', () => {
      const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: undefined }));
      const result = mgr.readAndApplyResults('any-id');

      expect(result).toBeUndefined();
    });

    it('returns undefined when synthesisInputId is not provided', () => {
      const mgr = new CooldownSynthesisManager(makeDeps());
      const result = mgr.readAndApplyResults(undefined);

      expect(result).toBeUndefined();
    });

    it('logs warning on corrupt result file', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      writeFileSync(join(tmpDir, 'result-bad.json'), '{ invalid !!!');
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir }));
        const result = mgr.readAndApplyResults('bad');

        expect(result).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('synthesis result'));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe('proposal application', () => {
    function applyProposal(proposal: SynthesisProposal, ks?: IKnowledgeStore): SynthesisProposal[] | undefined {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      writeFileSync(join(tmpDir, 'result-id.json'), JSON.stringify({ inputId: crypto.randomUUID(), proposals: [proposal] }));
      const knowledgeStore = ks ?? makeKnowledgeStore();
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore }));
        return mgr.readAndApplyResults('id');
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    }

    it('captures new-learning proposals', () => {
      const ks = makeKnowledgeStore();
      applyProposal(makeProposal('new-learning'), ks);

      expect(ks.capture).toHaveBeenCalledWith(expect.objectContaining({
        tier: 'step',
        source: 'synthesized',
      }));
    });

    it('updates learning with clamped confidence for update-learning proposals', () => {
      const targetId = crypto.randomUUID();
      const ks = makeKnowledgeStore({
        get: vi.fn().mockReturnValue({ confidence: 0.5 }),
      });
      applyProposal(makeProposal('update-learning', { targetLearningId: targetId, confidenceDelta: 0.1 }), ks);

      expect(ks.update).toHaveBeenCalledWith(targetId, expect.objectContaining({
        content: 'Updated',
        confidence: 0.6,
      }));
    });

    it('promotes learning tier for promote proposals', () => {
      const targetId = crypto.randomUUID();
      const ks = makeKnowledgeStore();
      applyProposal(makeProposal('promote', { targetLearningId: targetId }), ks);

      expect(ks.promoteTier).toHaveBeenCalledWith(targetId, 'flavor');
    });

    it('archives learning for archive proposals', () => {
      const targetId = crypto.randomUUID();
      const ks = makeKnowledgeStore();
      applyProposal(makeProposal('archive', { targetLearningId: targetId }), ks);

      expect(ks.archiveLearning).toHaveBeenCalledWith(targetId, 'Outdated');
    });

    it('logs methodology-recommendation without modifying knowledge store', () => {
      const ks = makeKnowledgeStore();
      applyProposal(makeProposal('methodology-recommendation'), ks);

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('Methodology recommendation'));
      expect(ks.capture).not.toHaveBeenCalled();
      expect(ks.update).not.toHaveBeenCalled();
    });

    it('logs warning and continues when a proposal fails to apply', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const p1 = makeProposal('new-learning');
      const p2 = makeProposal('new-learning');
      writeFileSync(join(tmpDir, 'result-id.json'), JSON.stringify({ inputId: crypto.randomUUID(), proposals: [p1, p2] }));
      const ks = makeKnowledgeStore({
        capture: vi.fn()
          .mockImplementationOnce(() => { throw new Error('fail'); })
          .mockImplementationOnce(() => undefined),
      });
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore: ks }));
        const result = mgr.readAndApplyResults('id');

        expect(result).toHaveLength(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('proposal'));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('logs non-Error throws as strings', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'synth-test-'));
      const p1 = makeProposal('new-learning');
      writeFileSync(join(tmpDir, 'result-id.json'), JSON.stringify({ inputId: crypto.randomUUID(), proposals: [p1] }));
      const ks = makeKnowledgeStore({
        capture: vi.fn().mockImplementation(() => {
          throw 'string error'; // eslint-disable-line no-throw-literal
        }),
      });
      try {
        const mgr = new CooldownSynthesisManager(makeDeps({ synthesisDir: tmpDir, knowledgeStore: ks }));
        mgr.readAndApplyResults('id');

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
