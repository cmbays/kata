import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect, vi } from 'vitest';
import { logger } from '@shared/lib/logger.js';
import { CooldownBeltComputer, type CooldownAgentRegistry, type CooldownBeltDeps } from './cooldown-belt-computer.js';
import type { BeltComputeResult } from '@features/belt/belt-calculator.js';
import type { BeltLevel } from '@domain/types/belt.js';
import type { BeltCalculator } from '@features/belt/belt-calculator.js';
import type { KataAgentConfidenceCalculator } from '@features/kata-agent/kata-agent-confidence-calculator.js';

type ComputeAndStoreFn = BeltCalculator['computeAndStore'];
type ComputeFn = KataAgentConfidenceCalculator['compute'];
type ListAgentsFn = CooldownAgentRegistry['list'];

// ── World ────────────────────────────────────────────────────

interface CooldownBeltComputerWorld extends QuickPickleWorld {
  tmpDir: string;
  beltCalculatorSpy?: { computeAndStore: ReturnType<typeof vi.fn<ComputeAndStoreFn>> };
  projectStateFile?: string;
  agentConfidenceCalculatorSpy?: { compute: ReturnType<typeof vi.fn<ComputeFn>> };
  agentRegistry?: { list: ReturnType<typeof vi.fn<ListAgentsFn>> };
  computer?: CooldownBeltComputer;
  beltResult?: BeltComputeResult;
  loggerInfoSpy: ReturnType<typeof vi.fn>;
  loggerWarnSpy: ReturnType<typeof vi.fn>;
  lastError?: Error;
}

function buildComputer(world: CooldownBeltComputerWorld): CooldownBeltComputer {
  const deps: CooldownBeltDeps = {
    beltCalculator: world.beltCalculatorSpy,
    projectStateFile: world.projectStateFile,
    agentConfidenceCalculator: world.agentConfidenceCalculatorSpy,
    agentRegistry: world.agentRegistry,
  };
  return new CooldownBeltComputer(deps);
}

// ── Background ───────────────────────────────────────────────

Given(
  'the cooldown environment is ready',
  (world: CooldownBeltComputerWorld) => {
    world.tmpDir = mkdtempSync(join(tmpdir(), 'cbc-'));
    world.loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
    world.loggerWarnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  },
);

// ── Given: belt evaluation ───────────────────────────────────

Given(
  'belt evaluation is enabled',
  (world: CooldownBeltComputerWorld) => {
    world.projectStateFile = join(world.tmpDir, 'project-state.json');
    world.beltCalculatorSpy = { computeAndStore: vi.fn<ComputeAndStoreFn>() };
  },
);

Given(
  'the practitioner has earned advancement from {string} to {string}',
  (world: CooldownBeltComputerWorld, from: string, to: string) => {
    world.beltCalculatorSpy!.computeAndStore.mockReturnValue({
      belt: to as BeltLevel,
      previous: from as BeltLevel,
      leveledUp: true,
    } as BeltComputeResult);
  },
);

Given(
  'the practitioner remains steady at {string}',
  (world: CooldownBeltComputerWorld, level: string) => {
    world.beltCalculatorSpy!.computeAndStore.mockReturnValue({
      belt: level as BeltLevel,
      previous: level as BeltLevel,
      leveledUp: false,
    } as BeltComputeResult);
  },
);

Given(
  'belt evaluation is not enabled',
  (_world: CooldownBeltComputerWorld) => {
    // No belt calculator or project state — both left undefined
  },
);

Given(
  'belt evaluation is enabled without project state',
  (world: CooldownBeltComputerWorld) => {
    world.beltCalculatorSpy = { computeAndStore: vi.fn<ComputeAndStoreFn>() };
    // projectStateFile left undefined
  },
);

Given(
  'belt evaluation will fail with an internal error',
  (world: CooldownBeltComputerWorld) => {
    world.beltCalculatorSpy!.computeAndStore.mockImplementation(() => {
      throw new Error('Simulated belt failure');
    });
  },
);

// ── Given: agent confidence tracking ─────────────────────────

Given(
  'agent confidence tracking is enabled',
  (world: CooldownBeltComputerWorld) => {
    world.agentConfidenceCalculatorSpy = { compute: vi.fn<ComputeFn>() };
  },
);

Given(
  'agents {string} and {string} are registered',
  (world: CooldownBeltComputerWorld, name1: string, name2: string) => {
    world.agentRegistry = {
      list: vi.fn<ListAgentsFn>(() => [
        { id: randomUUID(), name: name1 },
        { id: randomUUID(), name: name2 },
      ]),
    };
  },
);

Given(
  'agent confidence tracking is not enabled',
  (_world: CooldownBeltComputerWorld) => {
    // No calculator or directory — both left undefined
  },
);

Given(
  'agent confidence tracking is enabled without an agent registry',
  (world: CooldownBeltComputerWorld) => {
    world.agentConfidenceCalculatorSpy = { compute: vi.fn<ComputeFn>() };
    // agentRegistry left undefined
  },
);

Given(
  'the agent registry contains invalid data',
  (world: CooldownBeltComputerWorld) => {
    world.agentRegistry = {
      list: vi.fn<ListAgentsFn>(() => { throw new Error('Simulated registry failure'); }),
    };
  },
);

// ── When ─────────────────────────────────────────────────────

When(
  'belt evaluation runs',
  (world: CooldownBeltComputerWorld) => {
    world.computer = buildComputer(world);
    try {
      world.beltResult = world.computer.compute();
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

When(
  'agent confidence computation runs',
  (world: CooldownBeltComputerWorld) => {
    world.computer = buildComputer(world);
    try {
      world.computer.computeAgentConfidence();
    } catch (err) {
      world.lastError = err as Error;
    }
  },
);

// ── Then: belt assertions ────────────────────────────────────

Then(
  'the belt result shows a level-up to {string}',
  (world: CooldownBeltComputerWorld, expectedBelt: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.beltResult).toBeDefined();
    expect(world.beltResult!.belt).toBe(expectedBelt);
    expect(world.beltResult!.leveledUp).toBe(true);
  },
);

Then(
  'the belt result shows steady at {string}',
  (world: CooldownBeltComputerWorld, expectedBelt: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.beltResult).toBeDefined();
    expect(world.beltResult!.belt).toBe(expectedBelt);
    expect(world.beltResult!.leveledUp).toBe(false);
  },
);

Then(
  'belt advancement is logged',
  (world: CooldownBeltComputerWorld) => {
    expect(world.loggerInfoSpy).toHaveBeenCalled();
    const msg = world.loggerInfoSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('Belt advanced');
  },
);

Then(
  'no belt advancement is logged',
  (world: CooldownBeltComputerWorld) => {
    const infoCalls = world.loggerInfoSpy.mock.calls;
    const beltMessages = infoCalls.filter(
      (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('Belt advanced'),
    );
    expect(beltMessages).toHaveLength(0);
  },
);

Then(
  'no belt result is returned',
  (world: CooldownBeltComputerWorld) => {
    expect(world.lastError).toBeUndefined();
    expect(world.beltResult).toBeUndefined();
  },
);

// ── Then: agent confidence assertions ────────────────────────

Then(
  'confidence is computed for agent {string}',
  (world: CooldownBeltComputerWorld, agentName: string) => {
    expect(world.lastError).toBeUndefined();
    expect(world.agentConfidenceCalculatorSpy).toBeDefined();
    const calls = world.agentConfidenceCalculatorSpy!.compute.mock.calls as [string, string][];
    const match = calls.find(([, name]) => name === agentName);
    expect(match).toBeDefined();
  },
);

Then(
  'no confidence computations occur',
  (world: CooldownBeltComputerWorld) => {
    expect(world.lastError).toBeUndefined();
    if (world.agentConfidenceCalculatorSpy) {
      expect(world.agentConfidenceCalculatorSpy.compute).not.toHaveBeenCalled();
    }
  },
);

// ── Then: safety assertions ──────────────────────────────────

Then(
  'a warning is logged about belt computation failure',
  (world: CooldownBeltComputerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msg = world.loggerWarnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('Belt computation failed');
  },
);

Then(
  'a warning is logged about agent confidence failure',
  (world: CooldownBeltComputerWorld) => {
    expect(world.loggerWarnSpy).toHaveBeenCalled();
    const msg = world.loggerWarnSpy.mock.calls[0]![0] as string;
    expect(msg).toContain('Agent confidence computation failed');
  },
);

// 'cooldown continues normally' step is shared — defined in bridge-run-syncer.steps.ts
