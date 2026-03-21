import { randomUUID } from 'node:crypto';
import { Given, Then, When, QuickPickleWorld } from 'quickpickle';
import { expect } from 'vitest';
import type { Cycle } from '@domain/types/cycle.js';
import { resolveCycleActivationName, type ResolvedCycleActivationName } from './cycle-activation-name-resolver.js';
import type { CycleNameSuggestion } from './cycle-name-suggester.js';

interface ActivationNameWorld extends QuickPickleWorld {
  cycle?: Cycle;
  suggestion?: CycleNameSuggestion;
  providedName?: string;
  promptName?: string;
  resolved?: ResolvedCycleActivationName;
}

function makeCycle(name?: string): Cycle {
  return {
    id: randomUUID(),
    name,
    budget: {},
    bets: [{ id: randomUUID(), description: 'Fix login bug', appetite: 30, outcome: 'pending', issueRefs: [] }],
    pipelineMappings: [],
    state: 'planning',
    cooldownReserve: 10,
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
  };
}

Given(
  'a planning cycle named {string} for activation naming',
  (world: ActivationNameWorld, name: string) => {
    world.cycle = makeCycle(name);
  },
);

Given(
  'an unnamed planning cycle for activation naming',
  (world: ActivationNameWorld) => {
    world.cycle = makeCycle();
  },
);

Given(
  'the cycle name suggester recommends {string}',
  (world: ActivationNameWorld, name: string) => {
    world.suggestion = { name, source: 'llm' };
  },
);

Given(
  'the activation naming prompt returns {string}',
  (world: ActivationNameWorld, name: string) => {
    world.promptName = name;
  },
);

When(
  'activation naming resolves with provided name {string}',
  async (world: ActivationNameWorld, providedName: string) => {
    world.resolved = await resolveCycleActivationName(
      { cycle: world.cycle!, providedName },
      { suggester: { suggest: () => world.suggestion! } },
    );
  },
);

When(
  'activation naming resolves without a prompt',
  async (world: ActivationNameWorld) => {
    world.resolved = await resolveCycleActivationName(
      { cycle: world.cycle! },
      { suggester: { suggest: () => world.suggestion! } },
    );
  },
);

When(
  'activation naming resolves with a prompt',
  async (world: ActivationNameWorld) => {
    world.resolved = await resolveCycleActivationName(
      {
        cycle: world.cycle!,
        promptForName: async () => world.promptName!,
      },
      { suggester: { suggest: () => world.suggestion! } },
    );
  },
);

Then(
  'the resolved activation name is {string}',
  (world: ActivationNameWorld, expected: string) => {
    expect(world.resolved?.name).toBe(expected);
  },
);

Then(
  'the activation name source is {string}',
  (world: ActivationNameWorld, expected: string) => {
    expect(world.resolved?.source).toBe(expected);
  },
);
