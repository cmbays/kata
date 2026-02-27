import type { BudgetStatus, Cycle } from '@domain/types/cycle.js';
import type { CooldownReport, CooldownBetReport } from '@domain/services/cycle-manager.js';
import type { CycleProposal } from '@features/cycle-management/proposal-generator.js';
import type { CooldownSessionResult } from '@features/cycle-management/cooldown-session.js';
import type { RunSummary } from '@features/cycle-management/types.js';
import {
  formatCycleStatus,
  formatCooldownReport,
  formatCycleStatusJson,
  formatCooldownReportJson,
  formatProposals,
  formatProposalsJson,
  formatCooldownSessionResult,
  formatBetOutcomePrompt,
} from './cycle-formatter.js';

const makeCycle = (overrides: Partial<Cycle> = {}): Cycle => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Test Cycle',
  budget: { tokenBudget: 100000 },
  bets: [],
  pipelineMappings: [],
  state: 'active',
  cooldownReserve: 10,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...overrides,
});

const makeStatus = (overrides: Partial<BudgetStatus> = {}): BudgetStatus => ({
  cycleId: '00000000-0000-0000-0000-000000000001',
  budget: { tokenBudget: 100000 },
  tokensUsed: 25000,
  utilizationPercent: 25,
  perBet: [],
  ...overrides,
});

describe('formatCycleStatus', () => {
  it('shows cycle name, state, and budget', () => {
    const result = formatCycleStatus(makeStatus(), makeCycle(), true);
    expect(result).toContain('Cycle: Test Cycle');
    expect(result).toContain('State: active');
    expect(result).toContain('25,000 / 100,000');
    expect(result).toContain('25.0%');
  });

  it('uses thematic cycle label by default', () => {
    const result = formatCycleStatus(makeStatus(), makeCycle());
    expect(result).toContain('Keiko: Test Cycle');
  });

  it('shows alert level when present', () => {
    const result = formatCycleStatus(
      makeStatus({ alertLevel: 'warning', utilizationPercent: 92 }),
      makeCycle(),
    );
    expect(result).toContain('WARNING');
  });

  it('shows per-bet breakdown', () => {
    const cycle = makeCycle({
      bets: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          description: 'Implement auth',
          appetite: 30,
          outcome: 'pending',
          issueRefs: [],
        },
      ],
    });
    const status = makeStatus({
      perBet: [
        { betId: '00000000-0000-0000-0000-000000000010', allocated: 30000, used: 5000, utilizationPercent: 16.7 },
      ],
    });
    const result = formatCycleStatus(status, cycle);
    expect(result).toContain('Implement auth');
    expect(result).toContain('5,000 / 30,000');
  });

  it('shows time budget', () => {
    const result = formatCycleStatus(
      makeStatus({ budget: { tokenBudget: 100000, timeBudget: '2 weeks' } }),
      makeCycle(),
    );
    expect(result).toContain('Time: 2 weeks');
  });

  it('uses cycle id when name is missing', () => {
    const cycle = makeCycle({ name: undefined });
    const result = formatCycleStatus(makeStatus(), cycle, true);
    expect(result).toContain('Cycle: 00000000-0000-0000-0000-000000000001');
  });
});

describe('formatCooldownReport', () => {
  const makeReport = (overrides: Partial<CooldownReport> = {}): CooldownReport => ({
    cycleId: '00000000-0000-0000-0000-000000000001',
    cycleName: 'Sprint 1',
    budget: { tokenBudget: 50000 },
    tokensUsed: 40000,
    utilizationPercent: 80,
    bets: [],
    completionRate: 75,
    summary: 'Good progress overall.',
    ...overrides,
  });

  it('shows the report header (plain)', () => {
    const result = formatCooldownReport(makeReport(), true);
    expect(result).toContain('=== Cooldown Report ===');
    expect(result).toContain('Sprint 1');
  });

  it('uses thematic cooldown label by default', () => {
    const result = formatCooldownReport(makeReport());
    expect(result).toContain('=== Ma Report ===');
  });

  it('shows completion rate and utilization', () => {
    const result = formatCooldownReport(makeReport());
    expect(result).toContain('Completion Rate: 75.0%');
    expect(result).toContain('Token Utilization: 80.0%');
  });

  it('shows bet outcomes with icons', () => {
    const result = formatCooldownReport(
      makeReport({
        bets: [
          { betId: 'b1', description: 'Auth feature', appetite: 40, outcome: 'complete', pipelineCount: 2 },
          { betId: 'b2', description: 'Search feature', appetite: 30, outcome: 'partial', outcomeNotes: 'Ran out of time', pipelineCount: 1 },
          { betId: 'b3', description: 'Dropped idea', appetite: 20, outcome: 'abandoned', pipelineCount: 0 },
        ],
      }),
    );
    expect(result).toContain('[+] Auth feature');
    expect(result).toContain('[~] Search feature');
    expect(result).toContain('[-] Dropped idea');
    expect(result).toContain('Notes: Ran out of time');
  });

  it('shows summary text', () => {
    const result = formatCooldownReport(makeReport({ summary: 'All objectives met.' }));
    expect(result).toContain('Summary:');
    expect(result).toContain('All objectives met.');
  });
});

describe('formatCycleStatusJson', () => {
  it('returns valid JSON', () => {
    const result = formatCycleStatusJson(makeStatus(), makeCycle());
    const parsed = JSON.parse(result);
    expect(parsed.status.cycleId).toBe('00000000-0000-0000-0000-000000000001');
    expect(parsed.cycle.name).toBe('Test Cycle');
  });
});

describe('formatCooldownReportJson', () => {
  it('returns valid JSON', () => {
    const report: CooldownReport = {
      cycleId: 'c1',
      budget: {},
      tokensUsed: 0,
      utilizationPercent: 0,
      bets: [],
      completionRate: 0,
      summary: 'Empty',
    };
    const result = formatCooldownReportJson(report);
    const parsed = JSON.parse(result);
    expect(parsed.cycleId).toBe('c1');
  });
});

describe('formatProposals', () => {
  const makeProposal = (overrides: Partial<CycleProposal> = {}): CycleProposal => ({
    id: '00000000-0000-0000-0000-000000000099',
    description: 'Continue: Build auth system',
    rationale: 'Partially completed in previous cycle.',
    suggestedAppetite: 24,
    priority: 'high',
    source: 'unfinished',
    relatedBetIds: ['00000000-0000-0000-0000-000000000010'],
    ...overrides,
  });

  it('shows empty message when no proposals (plain)', () => {
    const result = formatProposals([], true);
    expect(result).toBe('No proposals generated for the next cycle.');
  });

  it('shows thematic empty message by default', () => {
    const result = formatProposals([]);
    expect(result).toBe('No proposals generated for the next keiko.');
  });

  it('shows proposal with priority tag and details (plain)', () => {
    const result = formatProposals([makeProposal()], true);
    expect(result).toContain('=== Next-Cycle Proposals ===');
    expect(result).toContain('[HIGH]');
    expect(result).toContain('Continue: Build auth system');
    expect(result).toContain('Source: unfinished');
    expect(result).toContain('Appetite: 24%');
    expect(result).toContain('Partially completed');
  });

  it('shows related bet IDs', () => {
    const result = formatProposals([makeProposal()]);
    expect(result).toContain('Related bets: 00000000-0000-0000-0000-000000000010');
  });

  it('shows related learning IDs', () => {
    const result = formatProposals([
      makeProposal({
        source: 'learning',
        relatedBetIds: undefined,
        relatedLearningIds: ['learning-1', 'learning-2'],
      }),
    ]);
    expect(result).toContain('Related learnings: learning-1, learning-2');
  });

  it('numbers proposals correctly', () => {
    const result = formatProposals([
      makeProposal({ description: 'First proposal' }),
      makeProposal({ id: 'id-2', description: 'Second proposal', priority: 'medium' }),
    ]);
    expect(result).toContain('1. [HIGH] First proposal');
    expect(result).toContain('2. [MEDIUM] Second proposal');
  });
});

describe('formatProposalsJson', () => {
  it('returns valid JSON array', () => {
    const proposals: CycleProposal[] = [
      {
        id: 'p1',
        description: 'Test',
        rationale: 'Reason',
        suggestedAppetite: 20,
        priority: 'high',
        source: 'unfinished',
      },
    ];
    const result = formatProposalsJson(proposals);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe('p1');
  });

  it('returns empty array for no proposals', () => {
    const result = formatProposalsJson([]);
    const parsed = JSON.parse(result);
    expect(parsed).toEqual([]);
  });
});

describe('formatCooldownSessionResult', () => {
  const makeSessionResult = (overrides: Partial<CooldownSessionResult> = {}): CooldownSessionResult => ({
    report: {
      cycleId: '00000000-0000-0000-0000-000000000001',
      cycleName: 'Sprint 1',
      budget: { tokenBudget: 50000 },
      tokensUsed: 40000,
      utilizationPercent: 80,
      bets: [
        { betId: 'b1', description: 'Auth feature', appetite: 40, outcome: 'complete', pipelineCount: 2 },
      ],
      completionRate: 100,
      summary: 'All done.',
    },
    betOutcomes: [],
    proposals: [],
    learningsCaptured: 0,
    ...overrides,
  });

  it('includes cooldown report (plain)', () => {
    const result = formatCooldownSessionResult(makeSessionResult(), undefined, true);
    expect(result).toContain('=== Cooldown Report ===');
    expect(result).toContain('Sprint 1');
  });

  it('shows bet outcomes when present', () => {
    const result = formatCooldownSessionResult(
      makeSessionResult({
        betOutcomes: [
          { betId: 'b1', outcome: 'complete', notes: 'All tests pass' },
          { betId: 'b2', outcome: 'partial' },
        ],
      }),
    );
    expect(result).toContain('--- Bet Outcomes Recorded ---');
    expect(result).toContain('[+] b1: complete');
    expect(result).toContain('All tests pass');
    expect(result).toContain('[~] b2: partial');
  });

  it('shows learnings captured count', () => {
    const result = formatCooldownSessionResult(
      makeSessionResult({ learningsCaptured: 3 }),
    );
    expect(result).toContain('Learnings captured: 3');
  });

  it('shows proposals when present (plain)', () => {
    const result = formatCooldownSessionResult(
      makeSessionResult({
        proposals: [
          {
            id: 'p1',
            description: 'Continue: Auth system',
            rationale: 'Partial work',
            suggestedAppetite: 24,
            priority: 'high',
            source: 'unfinished',
          },
        ],
      }),
      undefined,
      true,
    );
    expect(result).toContain('=== Next-Cycle Proposals ===');
    expect(result).toContain('Continue: Auth system');
  });

  it('shows no-proposals message when empty (plain)', () => {
    const result = formatCooldownSessionResult(makeSessionResult(), undefined, true);
    expect(result).toContain('No proposals generated for the next cycle.');
  });

  it('shows run summaries section when present', () => {
    const runSummaries: RunSummary[] = [
      {
        betId: 'aaaaaaaa-0000-0000-0000-000000000001',
        runId: 'rrrrrrrr-0000-0000-0000-000000000001',
        stagesCompleted: 3,
        gapCount: 2,
        gapsBySeverity: { high: 1, medium: 1, low: 0 },
        avgConfidence: 0.75,
        artifactPaths: [],
        stageDetails: [],
        yoloDecisionCount: 0,
      },
    ];
    const result = formatCooldownSessionResult(makeSessionResult({ runSummaries }));
    expect(result).toContain('--- Run Summaries ---');
    expect(result).toContain('3 stage(s) completed');
    expect(result).toContain('2 gap(s) [H:1 M:1 L:0]');
    expect(result).toContain('avg confidence 75%');
  });

  it('shows null confidence as no decisions recorded', () => {
    const runSummaries: RunSummary[] = [
      {
        betId: 'aaaaaaaa-0000-0000-0000-000000000002',
        runId: 'rrrrrrrr-0000-0000-0000-000000000002',
        stagesCompleted: 1,
        gapCount: 0,
        gapsBySeverity: { high: 0, medium: 0, low: 0 },
        avgConfidence: null,
        artifactPaths: [],
        stageDetails: [],
        yoloDecisionCount: 0,
      },
    ];
    const result = formatCooldownSessionResult(makeSessionResult({ runSummaries }));
    expect(result).toContain('no decisions recorded');
    expect(result).toContain('no gaps');
  });

  it('omits run summaries section when not provided', () => {
    const result = formatCooldownSessionResult(makeSessionResult());
    expect(result).not.toContain('--- Run Summaries ---');
  });

  it('shows Rule Suggestions section with counts when suggestionReview is provided', () => {
    const review = { accepted: 2, rejected: 1, deferred: 0 };
    const result = formatCooldownSessionResult(makeSessionResult(), review);
    expect(result).toContain('--- Rule Suggestions ---');
    expect(result).toContain('Accepted: 2, Rejected: 1, Deferred: 0');
  });

  it('shows pending count when ruleSuggestions present but no review taken', () => {
    const ruleSuggestions = [
      {
        id: '00000000-0000-4000-8000-000000000001',
        suggestedRule: { category: 'build' as const, name: 'Boost TS', condition: 'always', effect: 'boost' as const, magnitude: 0.3, confidence: 0.8, source: 'auto-detected' as const, evidence: [] },
        triggerDecisionIds: [],
        observationCount: 3,
        reasoning: 'test',
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      },
    ];
    const result = formatCooldownSessionResult(makeSessionResult({ ruleSuggestions }));
    expect(result).toContain('--- Rule Suggestions ---');
    expect(result).toContain('1 pending suggestion(s) (run interactively to review)');
  });

  it('omits Rule Suggestions section when no suggestions and no review', () => {
    const result = formatCooldownSessionResult(makeSessionResult());
    expect(result).not.toContain('--- Rule Suggestions ---');
  });

  it('shows --yolo decision count in run summary line when yoloDecisionCount > 0', () => {
    const runSummaries: RunSummary[] = [
      {
        betId: 'aaaaaaaa-0000-0000-0000-000000000003',
        runId: 'rrrrrrrr-0000-0000-0000-000000000003',
        stagesCompleted: 2,
        gapCount: 0,
        gapsBySeverity: { high: 0, medium: 0, low: 0 },
        avgConfidence: 0.72,
        artifactPaths: [],
        stageDetails: [],
        yoloDecisionCount: 1,
      },
    ];
    const result = formatCooldownSessionResult(makeSessionResult({ runSummaries }));
    expect(result).toContain('(1 --yolo decision(s))');
  });

  it('does not show --yolo suffix when yoloDecisionCount is 0', () => {
    const runSummaries: RunSummary[] = [
      {
        betId: 'aaaaaaaa-0000-0000-0000-000000000004',
        runId: 'rrrrrrrr-0000-0000-0000-000000000004',
        stagesCompleted: 1,
        gapCount: 0,
        gapsBySeverity: { high: 0, medium: 0, low: 0 },
        avgConfidence: 0.85,
        artifactPaths: [],
        stageDetails: [],
        yoloDecisionCount: 0,
      },
    ];
    const result = formatCooldownSessionResult(makeSessionResult({ runSummaries }));
    expect(result).not.toContain('--yolo');
  });
});

describe('formatBetOutcomePrompt', () => {
  it('formats a bet for outcome selection', () => {
    const bet: CooldownBetReport = {
      betId: 'b1',
      description: 'Build authentication',
      appetite: 30,
      outcome: 'pending',
      pipelineCount: 2,
    };
    const result = formatBetOutcomePrompt(bet);
    expect(result).toContain('[ ] Build authentication');
    expect(result).toContain('Appetite: 30%');
    expect(result).toContain('Current outcome: pending');
    expect(result).toContain('Pipelines: 2');
  });

  it('shows outcome notes when present', () => {
    const bet: CooldownBetReport = {
      betId: 'b2',
      description: 'Search feature',
      appetite: 25,
      outcome: 'partial',
      outcomeNotes: 'Basic search works, filters not done',
      pipelineCount: 1,
    };
    const result = formatBetOutcomePrompt(bet);
    expect(result).toContain('[~] Search feature');
    expect(result).toContain('Notes: Basic search works, filters not done');
  });

  it('uses correct icons for each outcome', () => {
    const complete: CooldownBetReport = {
      betId: 'b1', description: 'Done', appetite: 20, outcome: 'complete', pipelineCount: 0,
    };
    const abandoned: CooldownBetReport = {
      betId: 'b2', description: 'Dropped', appetite: 10, outcome: 'abandoned', pipelineCount: 0,
    };

    expect(formatBetOutcomePrompt(complete)).toContain('[+]');
    expect(formatBetOutcomePrompt(abandoned)).toContain('[-]');
  });
});
