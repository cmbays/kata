import { randomUUID } from 'node:crypto';
import type { Cycle } from '@domain/types/cycle.js';
import {
  CycleNameSuggester,
  buildCycleNameSuggestionPrompt,
  buildHeuristicCycleName,
  parseSuggestedCycleName,
} from './cycle-name-suggester.js';

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

describe('CycleNameSuggester', () => {
  it('returns an llm-sourced name when Claude yields a valid line', () => {
    const suggester = new CycleNameSuggester({
      invokeClaude: vi.fn().mockReturnValue('Cycle Name: Auth Stabilization Sprint\n'),
    });

    const result = suggester.suggest(makeCycle({
      bets: [{ id: randomUUID(), description: 'Stabilize auth flow', appetite: 30, outcome: 'pending', issueRefs: [] }],
    }));

    expect(result).toEqual({ name: 'Auth Stabilization Sprint', source: 'llm' });
  });

  it('falls back to a heuristic name when Claude returns no usable name', () => {
    const suggester = new CycleNameSuggester({
      invokeClaude: vi.fn().mockReturnValue('\n\n'),
    });

    const result = suggester.suggest(makeCycle({
      bets: [{ id: randomUUID(), description: 'Fix login bug', appetite: 30, outcome: 'pending', issueRefs: [] }],
    }));

    expect(result).toEqual({ name: 'Fix Login Bug', source: 'heuristic' });
  });

  it('falls back to a heuristic name when Claude throws', () => {
    const suggester = new CycleNameSuggester({
      invokeClaude: vi.fn(() => {
        throw new Error('claude unavailable');
      }),
    });

    const result = suggester.suggest(makeCycle({
      bets: [{ id: randomUUID(), description: 'Fix login bug', appetite: 30, outcome: 'pending', issueRefs: [] }],
    }));

    expect(result).toEqual({ name: 'Fix Login Bug', source: 'heuristic' });
  });
});

describe('buildCycleNameSuggestionPrompt', () => {
  it('includes the cycle bets and asks for a single name', () => {
    const prompt = buildCycleNameSuggestionPrompt(makeCycle({
      id: 'cycle-123',
      createdAt: '2026-03-21T10:00:00.000Z',
      bets: [
        { id: randomUUID(), description: 'Fix login bug', appetite: 30, outcome: 'pending', issueRefs: [] },
        { id: randomUUID(), description: 'Tighten tests', appetite: 20, outcome: 'pending', issueRefs: [] },
      ],
    }));

    expect(prompt).toBe([
      'You are naming a software development cycle.',
      'Return exactly one concise cycle name.',
      'Constraints:',
      '- 3 to 7 words when possible',
      '- Title Case',
      '- No quotes',
      '- No numbering or bullets',
      '- Reflect the actual bets in the cycle',
      '',
      'Cycle ID: cycle-123',
      'Created At: 2026-03-21T10:00:00.000Z',
      '',
      'Bets:',
      '- Fix login bug',
      '- Tighten tests',
      '',
      'Return only the cycle name.',
    ].join('\n'));
  });

  it('uses the no-bets placeholder when the cycle has no bets yet', () => {
    const prompt = buildCycleNameSuggestionPrompt(makeCycle({
      id: 'cycle-empty',
      createdAt: '2026-03-21T10:00:00.000Z',
      bets: [],
    }));

    expect(prompt).toContain('Cycle ID: cycle-empty');
    expect(prompt).toContain('- No bets have been added yet.');
  });
});

describe('parseSuggestedCycleName', () => {
  it('strips labels, bullets, and quotes', () => {
    expect(parseSuggestedCycleName('1. "Cycle Name: Login Reliability Push"')).toBe('Login Reliability Push');
  });

  it('strips a bullet and a generic name label', () => {
    expect(parseSuggestedCycleName('- Name: API Hardening Sprint')).toBe('API Hardening Sprint');
  });

  it('collapses repeated internal whitespace', () => {
    expect(parseSuggestedCycleName('  Cycle Name:   Login   Reliability   Push  ')).toBe('Login Reliability Push');
  });

  it('returns undefined for empty output', () => {
    expect(parseSuggestedCycleName('\n  \n')).toBeUndefined();
  });
});

describe('buildHeuristicCycleName', () => {
  it('returns the first summarized bet when only one bet exists', () => {
    const name = buildHeuristicCycleName(makeCycle({
      bets: [
        { id: randomUUID(), description: 'API auth cleanup', appetite: 30, outcome: 'pending', issueRefs: [] },
      ],
    }));

    expect(name).toBe('API Auth Cleanup');
  });

  it('uses the first two bet descriptions and appends + More when needed', () => {
    const name = buildHeuristicCycleName(makeCycle({
      bets: [
        { id: randomUUID(), description: 'Fix login bug', appetite: 30, outcome: 'pending', issueRefs: [] },
        { id: randomUUID(), description: 'Tighten tests', appetite: 20, outcome: 'pending', issueRefs: [] },
        { id: randomUUID(), description: 'Polish docs', appetite: 10, outcome: 'pending', issueRefs: [] },
      ],
    }));

    expect(name).toBe('Fix Login Bug + Tighten Tests + More');
  });

  it('returns a generic planned cycle name when there are no bets', () => {
    expect(buildHeuristicCycleName(makeCycle())).toBe('Planned Cycle');
  });

  it('strips issue refs and quotes before summarizing a bet', () => {
    const name = buildHeuristicCycleName(makeCycle({
      bets: [
        { id: randomUUID(), description: 'Fixes #123 “stabilize login retries”', appetite: 30, outcome: 'pending', issueRefs: ['#123'] },
      ],
    }));

    expect(name).toBe('Stabilize Login Retries');
  });

  it('truncates very long bet descriptions to a concise title', () => {
    const name = buildHeuristicCycleName(makeCycle({
      bets: [
        {
          id: randomUUID(),
          description: 'Investigate and stabilize flaky authentication retries across all edge environments',
          appetite: 30,
          outcome: 'pending',
          issueRefs: [],
        },
      ],
    }));

    expect(name).toBe('Investigate And Stabilize Flaky Authent...');
  });
});
