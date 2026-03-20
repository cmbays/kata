import { Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect } from 'vitest';
import { canTransitionCycleState } from '@domain/rules/cycle-rules.js';
import type { CycleState } from '@domain/types/cycle.js';

// Step definitions for cycle-rules.feature
// Extends QuickPickleWorld with prefixed properties to avoid collisions.

interface CrWorld extends QuickPickleWorld {
  crFrom?: CycleState;
  crResult?: boolean;
}

Given('a cycle in {string} state', (world: CrWorld, state: string) => {
  world.crFrom = state as CycleState;
});

When('checking if transition to {string} is allowed', (world: CrWorld, to: string) => {
  world.crResult = canTransitionCycleState(world.crFrom!, to as CycleState);
});

Then('the transition is allowed', (world: CrWorld) => {
  expect(world.crResult).toBe(true);
});

Then('the transition is rejected', (world: CrWorld) => {
  expect(world.crResult).toBe(false);
});
