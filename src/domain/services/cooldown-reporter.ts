import type { Cycle } from '@domain/types/cycle.js';
import type { CooldownReport, CooldownBetReport } from '@domain/types/cooldown.js';
import { calculateUtilization } from '@domain/rules/budget-rules.js';

/**
 * Generate a cooldown report for a cycle.
 *
 * Pure function — takes a Cycle value and returns a CooldownReport.
 * No I/O, no persistence. Token usage is placeholder (0) until
 * external token tracking is wired.
 */
export function generateCooldownReport(cycle: Cycle): CooldownReport {
  const { percent, alertLevel } = calculateUtilization(cycle.budget, 0);

  const bets: CooldownBetReport[] = cycle.bets.map((bet) => ({
    betId: bet.id,
    description: bet.description,
    appetite: bet.appetite,
    outcome: bet.outcome,
    outcomeNotes: bet.outcomeNotes,
    pipelineCount: cycle.pipelineMappings.filter((m) => m.betId === bet.id).length,
  }));

  const completedBets = cycle.bets.filter((b) => b.outcome === 'complete').length;
  const totalBets = cycle.bets.length;
  const completionRate = totalBets > 0 ? (completedBets / totalBets) * 100 : 0;

  const summary = buildCooldownSummary(cycle, completionRate, bets);

  return {
    cycleId: cycle.id,
    cycleName: cycle.name,
    budget: cycle.budget,
    tokensUsed: 0,
    utilizationPercent: percent,
    alertLevel,
    bets,
    completionRate,
    summary,
  };
}

function buildCooldownSummary(
  cycle: Cycle,
  completionRate: number,
  bets: CooldownBetReport[],
): string {
  const lines: string[] = [];
  lines.push(`Cycle: ${cycle.name ?? cycle.id}`);
  lines.push(`State: ${cycle.state}`);
  lines.push(`Bets: ${bets.length}`);
  lines.push(`Completion rate: ${completionRate.toFixed(1)}%`);

  if (cycle.budget.tokenBudget) {
    lines.push(`Token budget: ${cycle.budget.tokenBudget.toLocaleString()}`);
  }
  if (cycle.budget.timeBudget) {
    lines.push(`Time budget: ${cycle.budget.timeBudget}`);
  }

  const outcomes = bets.reduce<Record<string, number>>((acc, bet) => {
    acc[bet.outcome] = (acc[bet.outcome] ?? 0) + 1;
    return acc;
  }, {});

  for (const [outcome, count] of Object.entries(outcomes)) {
    lines.push(`  ${outcome}: ${count}`);
  }

  return lines.join('\n');
}
