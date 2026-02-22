import type { BudgetStatus, Cycle } from '@domain/types/cycle.js';
import type { CooldownReport } from '@domain/services/cycle-manager.js';
import {
  formatCycleStatus,
  formatCooldownReport,
  formatCycleStatusJson,
  formatCooldownReportJson,
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
    const result = formatCycleStatus(makeStatus(), makeCycle());
    expect(result).toContain('Cycle: Test Cycle');
    expect(result).toContain('State: active');
    expect(result).toContain('25,000 / 100,000');
    expect(result).toContain('25.0%');
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
    const result = formatCycleStatus(makeStatus(), cycle);
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

  it('shows the report header', () => {
    const result = formatCooldownReport(makeReport());
    expect(result).toContain('=== Cooldown Report ===');
    expect(result).toContain('Sprint 1');
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
