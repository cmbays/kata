import { randomUUID } from 'node:crypto';
import type { Cycle } from '@domain/types/cycle.js';
import { resolveCycleActivationName } from './cycle-activation-name-resolver.js';

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: randomUUID(),
    name: undefined,
    budget: {},
    bets: [],
    pipelineMappings: [],
    state: 'planning',
    cooldownReserve: 10,
    createdAt: '2026-03-21T10:00:00.000Z',
    updatedAt: '2026-03-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('resolveCycleActivationName', () => {
  it('prefers an explicitly provided name', async () => {
    const result = await resolveCycleActivationName({
      cycle: makeCycle({ name: 'Existing Cycle' }),
      providedName: '  Manual Launch Name  ',
    });

    expect(result).toEqual({ name: 'Manual Launch Name', source: 'provided' });
  });

  it('reuses an existing persisted cycle name when no override is supplied', async () => {
    const result = await resolveCycleActivationName({
      cycle: makeCycle({ name: 'Existing Cycle' }),
    });

    expect(result).toEqual({ name: 'Existing Cycle', source: 'existing' });
  });

  it('uses the suggester automatically when the cycle is unnamed', async () => {
    const result = await resolveCycleActivationName(
      { cycle: makeCycle() },
      { suggester: { suggest: vi.fn().mockReturnValue({ name: 'Suggested Cycle', source: 'llm' }) } },
    );

    expect(result).toEqual({
      name: 'Suggested Cycle',
      source: 'llm',
      suggestedName: 'Suggested Cycle',
    });
  });

  it('lets a prompt callback edit the suggested name', async () => {
    const promptForName = vi.fn().mockResolvedValue('Edited Cycle Name');

    const result = await resolveCycleActivationName(
      { cycle: makeCycle(), promptForName },
      { suggester: { suggest: vi.fn().mockReturnValue({ name: 'Suggested Cycle', source: 'heuristic' }) } },
    );

    expect(result).toEqual({
      name: 'Edited Cycle Name',
      source: 'prompted',
      suggestedName: 'Suggested Cycle',
    });
  });

  it('preserves the suggester source when the prompt accepts the suggested name', async () => {
    const promptForName = vi.fn().mockResolvedValue('Suggested Cycle');

    const result = await resolveCycleActivationName(
      { cycle: makeCycle(), promptForName },
      { suggester: { suggest: vi.fn().mockReturnValue({ name: 'Suggested Cycle', source: 'heuristic' }) } },
    );

    expect(result).toEqual({
      name: 'Suggested Cycle',
      source: 'heuristic',
      suggestedName: 'Suggested Cycle',
    });
  });

  it('rejects a whitespace-only explicit name', async () => {
    await expect(resolveCycleActivationName({
      cycle: makeCycle(),
      providedName: '   ',
    })).rejects.toThrow('Cycle name must be non-empty when provided.');
  });

  it('rejects a whitespace-only prompted name before activation', async () => {
    await expect(resolveCycleActivationName(
      { cycle: makeCycle(), promptForName: vi.fn().mockResolvedValue('   ') },
      { suggester: { suggest: vi.fn().mockReturnValue({ name: 'Suggested Cycle', source: 'llm' }) } },
    )).rejects.toThrow('Cycle name is required before activation.');
  });
});
