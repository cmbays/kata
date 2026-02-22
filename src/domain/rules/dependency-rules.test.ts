import { describe, it, expect } from 'vitest';
import { detectCrossBetDependencies } from './dependency-rules.js';
import type { Bet } from '@domain/types/bet.js';

function makeBet(overrides?: Partial<Bet>): Bet {
  return {
    id: crypto.randomUUID(),
    description: 'Test bet',
    appetite: 30,
    issueRefs: [],
    outcome: 'pending',
    ...overrides,
  };
}

describe('detectCrossBetDependencies', () => {
  it('returns empty array for independent bets', () => {
    const bets = [
      makeBet({ projectRef: 'repo-a', issueRefs: ['#1', '#2'] }),
      makeBet({ projectRef: 'repo-b', issueRefs: ['#3', '#4'] }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(0);
  });

  it('detects bets referencing the same project', () => {
    const bets = [
      makeBet({ projectRef: 'my-app' }),
      makeBet({ projectRef: 'my-app' }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toContain('same project');
    expect(warnings[0]!.reason).toContain('my-app');
    expect(warnings[0]!.suggestion).toContain('combining');
  });

  it('detects bets with overlapping issue references', () => {
    const bets = [
      makeBet({ issueRefs: ['#1', '#2', '#3'] }),
      makeBet({ issueRefs: ['#3', '#4', '#5'] }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toContain('#3');
    expect(warnings[0]!.suggestion).toContain('Shared issues');
  });

  it('detects both project and issue overlap simultaneously', () => {
    const bets = [
      makeBet({ projectRef: 'repo-x', issueRefs: ['#10'] }),
      makeBet({ projectRef: 'repo-x', issueRefs: ['#10', '#11'] }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    // Should produce two warnings: one for shared project, one for shared issues
    expect(warnings).toHaveLength(2);
  });

  it('returns empty array for a single bet', () => {
    const bets = [makeBet({ projectRef: 'repo-a', issueRefs: ['#1'] })];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty array for empty bets array', () => {
    const warnings = detectCrossBetDependencies([]);
    expect(warnings).toHaveLength(0);
  });

  it('does not flag bets when one has no project ref', () => {
    const bets = [
      makeBet({ projectRef: 'my-app' }),
      makeBet({ projectRef: undefined }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(0);
  });

  it('does not flag bets when both have no project ref', () => {
    const bets = [
      makeBet({ projectRef: undefined }),
      makeBet({ projectRef: undefined }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(0);
  });

  it('handles multiple bets with pairwise comparisons', () => {
    const bets = [
      makeBet({ projectRef: 'shared-repo' }),
      makeBet({ projectRef: 'shared-repo' }),
      makeBet({ projectRef: 'shared-repo' }),
    ];
    // Three pairs: (0,1), (0,2), (1,2)
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(3);
  });

  it('correctly includes bet IDs in warnings', () => {
    const bet1 = makeBet({ projectRef: 'repo' });
    const bet2 = makeBet({ projectRef: 'repo' });
    const warnings = detectCrossBetDependencies([bet1, bet2]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.betIds).toEqual([bet1.id, bet2.id]);
  });

  it('detects multiple overlapping issue refs', () => {
    const bets = [
      makeBet({ issueRefs: ['#1', '#2', '#3'] }),
      makeBet({ issueRefs: ['#2', '#3', '#4'] }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.reason).toContain('#2');
    expect(warnings[0]!.reason).toContain('#3');
  });

  it('does not flag bets with empty issue refs', () => {
    const bets = [
      makeBet({ issueRefs: [] }),
      makeBet({ issueRefs: [] }),
    ];
    const warnings = detectCrossBetDependencies(bets);
    expect(warnings).toHaveLength(0);
  });
});
