import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { logger } from '@shared/lib/logger.js';
import { CooldownBeltComputer, type CooldownBeltDeps } from './cooldown-belt-computer.js';

function makeDeps(overrides: Partial<CooldownBeltDeps> = {}): CooldownBeltDeps {
  return { ...overrides };
}

function writeAgentRecord(dir: string, id: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${id}.json`),
    JSON.stringify({
      id,
      name,
      role: 'executor',
      skills: [],
      createdAt: new Date().toISOString(),
      active: true,
    }),
  );
}

describe('CooldownBeltComputer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cbc-unit-'));
  });

  describe('compute()', () => {
    it('returns the belt result from the calculator', () => {
      const expected = { belt: 'yon-kyu', previous: 'go-kyu', leveledUp: true };
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
        beltCalculator: { computeAndStore: vi.fn(() => expected) },
      }));

      const result = computer.compute();

      expect(result).toBe(expected);
    });

    it('returns undefined when only beltCalculator is provided (no projectStateFile)', () => {
      const computer = new CooldownBeltComputer(makeDeps({
        beltCalculator: { computeAndStore: vi.fn() },
      }));

      expect(computer.compute()).toBeUndefined();
    });

    it('returns undefined when only projectStateFile is provided (no beltCalculator)', () => {
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
      }));

      expect(computer.compute()).toBeUndefined();
    });

    it('passes the project state file path to computeAndStore', () => {
      const stateFile = join(tmpDir, 'state.json');
      const spy = vi.fn(() => ({ belt: 'go-kyu', previous: 'go-kyu', leveledUp: false }));
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: stateFile,
        beltCalculator: { computeAndStore: spy },
      }));

      computer.compute();

      expect(spy).toHaveBeenCalledWith(stateFile, expect.anything());
    });

    it('logs info when belt levels up', () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
        beltCalculator: {
          computeAndStore: vi.fn(() => ({
            belt: 'yon-kyu',
            previous: 'go-kyu',
            leveledUp: true,
          })),
        },
      }));

      computer.compute();

      expect(infoSpy).toHaveBeenCalledWith('Belt advanced: go-kyu → yon-kyu');
      infoSpy.mockRestore();
    });

    it('does not log info when belt stays steady', () => {
      const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
        beltCalculator: {
          computeAndStore: vi.fn(() => ({
            belt: 'go-kyu',
            previous: 'go-kyu',
            leveledUp: false,
          })),
        },
      }));

      computer.compute();

      expect(infoSpy).not.toHaveBeenCalled();
      infoSpy.mockRestore();
    });

    it('warns and returns undefined on computation error', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
        beltCalculator: {
          computeAndStore: vi.fn(() => { throw new Error('disk full'); }),
        },
      }));

      const result = computer.compute();

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Belt computation failed: disk full'));
      warnSpy.mockRestore();
    });

    it('warns with stringified non-Error thrown values', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const computer = new CooldownBeltComputer(makeDeps({
        projectStateFile: join(tmpDir, 'state.json'),
        beltCalculator: {
          computeAndStore: vi.fn(() => { throw 'string error'; }),
        },
      }));

      computer.compute();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
      warnSpy.mockRestore();
    });
  });

  describe('computeAgentConfidence()', () => {
    it('calls compute for each registered agent', () => {
      const agentDir = join(tmpDir, 'agents');
      const id1 = randomUUID();
      const id2 = randomUUID();
      writeAgentRecord(agentDir, id1, 'Agent-A');
      writeAgentRecord(agentDir, id2, 'Agent-B');

      const computeSpy = vi.fn();
      const computer = new CooldownBeltComputer(makeDeps({
        agentDir,
        agentConfidenceCalculator: { compute: computeSpy },
      }));

      computer.computeAgentConfidence();

      expect(computeSpy).toHaveBeenCalledTimes(2);
      expect(computeSpy).toHaveBeenCalledWith(id1, 'Agent-A');
      expect(computeSpy).toHaveBeenCalledWith(id2, 'Agent-B');
    });

    it('prefers agentConfidenceCalculator over katakaConfidenceCalculator', () => {
      const agentDir = join(tmpDir, 'agents-pref');
      writeAgentRecord(agentDir, randomUUID(), 'X');

      const canonicalSpy = vi.fn();
      const legacySpy = vi.fn();
      const computer = new CooldownBeltComputer(makeDeps({
        agentDir,
        agentConfidenceCalculator: { compute: canonicalSpy },
        katakaConfidenceCalculator: { compute: legacySpy },
      }));

      computer.computeAgentConfidence();

      expect(canonicalSpy).toHaveBeenCalled();
      expect(legacySpy).not.toHaveBeenCalled();
    });

    it('prefers agentDir over katakaDir', () => {
      const agentDir = join(tmpDir, 'agents-dir-pref');
      const katakaDir = join(tmpDir, 'kataka-dir-pref');
      writeAgentRecord(agentDir, randomUUID(), 'Canonical');
      writeAgentRecord(katakaDir, randomUUID(), 'Legacy');

      const computeSpy = vi.fn();
      const computer = new CooldownBeltComputer(makeDeps({
        agentDir,
        katakaDir,
        agentConfidenceCalculator: { compute: computeSpy },
      }));

      computer.computeAgentConfidence();

      const names = computeSpy.mock.calls.map((c: [string, string]) => c[1]);
      expect(names).toContain('Canonical');
      expect(names).not.toContain('Legacy');
    });

    it('falls back to katakaConfidenceCalculator when canonical is absent', () => {
      const katakaDir = join(tmpDir, 'kataka-fallback');
      writeAgentRecord(katakaDir, randomUUID(), 'Fallback');

      const legacySpy = vi.fn();
      const computer = new CooldownBeltComputer(makeDeps({
        katakaDir,
        katakaConfidenceCalculator: { compute: legacySpy },
      }));

      computer.computeAgentConfidence();

      expect(legacySpy).toHaveBeenCalledWith(expect.any(String), 'Fallback');
    });

    it('no-ops when calculator is provided but directory is missing', () => {
      const computeSpy = vi.fn();
      const computer = new CooldownBeltComputer(makeDeps({
        agentConfidenceCalculator: { compute: computeSpy },
      }));

      computer.computeAgentConfidence();

      expect(computeSpy).not.toHaveBeenCalled();
    });

    it('no-ops when directory is provided but calculator is missing', () => {
      const agentDir = join(tmpDir, 'agents-no-calc');
      writeAgentRecord(agentDir, randomUUID(), 'Orphan');

      const computer = new CooldownBeltComputer(makeDeps({ agentDir }));

      // Should not throw
      computer.computeAgentConfidence();
    });

    it('continues computing remaining agents when one agent fails', () => {
      const agentDir = join(tmpDir, 'agents-partial-fail');
      const id1 = randomUUID();
      const id2 = randomUUID();
      writeAgentRecord(agentDir, id1, 'Failing');
      writeAgentRecord(agentDir, id2, 'Healthy');

      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const computeSpy = vi.fn((_id: string, name: string) => {
        if (name === 'Failing') throw new Error('agent broke');
        return {} as ReturnType<typeof computeSpy>;
      });

      const computer = new CooldownBeltComputer(makeDeps({
        agentDir,
        agentConfidenceCalculator: { compute: computeSpy },
      }));

      computer.computeAgentConfidence();

      expect(computeSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Confidence computation failed for agent "Failing"'));
      warnSpy.mockRestore();
    });

    it('warns and continues when agent registry throws', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const brokenPath = join(tmpDir, 'broken.json');
      writeFileSync(brokenPath, '{}');

      const computer = new CooldownBeltComputer(makeDeps({
        agentDir: brokenPath,
        agentConfidenceCalculator: { compute: vi.fn() },
      }));

      computer.computeAgentConfidence();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Agent confidence computation failed'));
      warnSpy.mockRestore();
    });

    it('warns with stringified non-Error thrown values', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      const agentDir = join(tmpDir, 'agents-throw');
      writeAgentRecord(agentDir, randomUUID(), 'Thrower');

      const computer = new CooldownBeltComputer(makeDeps({
        agentDir,
        agentConfidenceCalculator: {
          compute: vi.fn(() => { throw 'non-error throw'; }),
        },
      }));

      computer.computeAgentConfidence();

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('non-error throw'));
      warnSpy.mockRestore();
    });
  });
});
