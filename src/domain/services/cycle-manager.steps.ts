import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { After, Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect } from 'vitest';
import type { Cycle, CycleState } from '@domain/types/cycle.js';
import { CycleManager } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';

// Step definitions for cycle-manager.feature
// Extends QuickPickleWorld with prefixed properties to avoid collisions.

interface CmWorld extends QuickPickleWorld {
  cmKataDir?: string;
  cmManager?: CycleManager;
  cmCycle?: Cycle;
  cmBetId?: string;
  cmError?: Error;
  cmUpdatedAtBefore?: string;
}

function createTestDir(): string {
  const dir = join(tmpdir(), `kata-cm-acceptance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function setupManager(w: CmWorld): void {
  w.cmKataDir = createTestDir();
  const cyclesDir = join(w.cmKataDir, 'cycles');
  w.cmManager = new CycleManager(cyclesDir, JsonStore);
}

function createCycleInState(
  w: CmWorld,
  state: CycleState,
  betDescription: string,
  name?: string,
): void {
  setupManager(w);
  const cycle = w.cmManager!.create({ tokenBudget: 100000 }, name);
  w.cmCycle = w.cmManager!.addBet(cycle.id, {
    description: betDescription,
    appetite: 30,
    outcome: 'pending',
    issueRefs: [],
  });
  w.cmBetId = w.cmCycle.bets[0]!.id;

  // Walk through states to reach the target state
  const stateOrder: CycleState[] = ['planning', 'active', 'cooldown', 'complete'];
  const targetIdx = stateOrder.indexOf(state);
  for (let i = 1; i <= targetIdx; i++) {
    const nextState = stateOrder[i]!;
    const transitionName = nextState === 'active'
      ? (name ?? 'Acceptance Cycle')
      : undefined;
    w.cmCycle = w.cmManager!.transitionState(w.cmCycle.id, nextState, transitionName);
  }

  w.cmUpdatedAtBefore = w.cmCycle.updatedAt;
}

After(async (world: CmWorld) => {
  if (world.cmKataDir) {
    rmSync(world.cmKataDir, { recursive: true, force: true });
  }
});

// --- Givens ---

Given(
  'a cycle in {string} state with bet {string}',
  (world: CmWorld, state: string, betDesc: string) => {
    createCycleInState(world, state as CycleState, betDesc);
  },
);

Given(
  'a cycle in {string} state with bet {string} named {string}',
  (world: CmWorld, state: string, betDesc: string, name: string) => {
    createCycleInState(world, state as CycleState, betDesc, name);
  },
);

Given(
  'the bet starts with outcome {string}',
  (world: CmWorld, outcome: string) => {
    if (outcome !== 'pending') {
      world.cmManager!.updateBetOutcomes(world.cmCycle!.id, [
        { betId: world.cmBetId!, outcome },
      ]);
      world.cmCycle = world.cmManager!.get(world.cmCycle!.id);
    }
    world.cmUpdatedAtBefore = world.cmCycle!.updatedAt;
  },
);

// --- Whens ---

function tryTransition(world: CmWorld, to: string): void {
  try {
    world.cmCycle = world.cmManager!.transitionState(world.cmCycle!.id, to as CycleState);
  } catch (e) {
    world.cmError = e as Error;
  }
}

When('the cycle transitions to {string}', tryTransition);
When('the cycle attempts to transition to {string}', tryTransition);

When(
  'the cycle transitions to {string} with name {string}',
  (world: CmWorld, to: string, name: string) => {
    try {
      world.cmCycle = world.cmManager!.transitionState(world.cmCycle!.id, to as CycleState, name);
    } catch (e) {
      world.cmError = e as Error;
    }
  },
);

When(
  'setBetOutcome is called with {string}',
  (world: CmWorld, outcome: string) => {
    try {
      world.cmCycle = world.cmManager!.setBetOutcome(
        world.cmCycle!.id,
        world.cmBetId!,
        outcome as 'complete' | 'partial',
      );
    } catch (e) {
      world.cmError = e as Error;
    }
  },
);

When(
  'setBetOutcome is called with {string} for an unknown bet',
  (world: CmWorld, outcome: string) => {
    try {
      world.cmCycle = world.cmManager!.setBetOutcome(
        world.cmCycle!.id,
        randomUUID(),
        outcome as 'complete' | 'partial',
      );
    } catch (e) {
      world.cmError = e as Error;
    }
  },
);

When(
  'removeBet is called for the bet',
  (world: CmWorld) => {
    try {
      world.cmCycle = world.cmManager!.removeBet(world.cmCycle!.id, world.cmBetId!);
    } catch (e) {
      world.cmError = e as Error;
    }
  },
);

When(
  'deleteCycle is called',
  (world: CmWorld) => {
    try {
      world.cmManager!.deleteCycle(world.cmCycle!.id);
    } catch (e) {
      world.cmError = e as Error;
    }
  },
);

// --- Thens ---

Then(
  'the cycle state is {string}',
  (world: CmWorld, expected: string) => {
    expect(world.cmError).toBeUndefined();
    const cycle = world.cmManager!.get(world.cmCycle!.id);
    expect(cycle.state).toBe(expected);
  },
);

Then(
  'the cycle name is {string}',
  (world: CmWorld, expected: string) => {
    const cycle = world.cmManager!.get(world.cmCycle!.id);
    expect(cycle.name).toBe(expected);
  },
);

Then(
  'the cycle updatedAt is unchanged',
  (world: CmWorld) => {
    const cycle = world.cmManager!.get(world.cmCycle!.id);
    expect(cycle.updatedAt).toBe(world.cmUpdatedAtBefore);
  },
);

Then(
  'the transition is rejected with an error',
  (world: CmWorld) => {
    expect(world.cmError).toBeDefined();
    expect(world.cmError!.message).toMatch(/Cannot transition/);
  },
);

Then(
  'the transition is rejected because the cycle has no name',
  (world: CmWorld) => {
    expect(world.cmError).toBeDefined();
    expect(world.cmError!.message).toMatch(/cycle name is required before activation/i);
  },
);

Then(
  'the bet outcome becomes {string}',
  (world: CmWorld, expected: string) => {
    const cycle = world.cmManager!.get(world.cmCycle!.id);
    const bet = cycle.bets.find((b) => b.id === world.cmBetId!);
    expect(bet!.outcome).toBe(expected);
  },
);

Then(
  'a bet-not-found error is thrown',
  (world: CmWorld) => {
    expect(world.cmError).toBeDefined();
    expect(world.cmError!.message).toMatch(/not found/);
  },
);

Then(
  'a state-guard error is thrown',
  (world: CmWorld) => {
    expect(world.cmError).toBeDefined();
    expect(world.cmError!.message).toMatch(/Cannot|Only planning/);
  },
);
