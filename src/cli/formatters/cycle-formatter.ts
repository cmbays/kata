import type { BudgetStatus, Cycle } from '@domain/types/cycle.js';
import type { CooldownReport } from '@domain/services/cycle-manager.js';

/**
 * Format cycle budget status as a human-readable summary.
 */
export function formatCycleStatus(status: BudgetStatus, cycle: Cycle): string {
  const lines: string[] = [];

  lines.push(`Cycle: ${cycle.name ?? cycle.id}`);
  lines.push(`State: ${cycle.state}`);
  lines.push(`Bets: ${cycle.bets.length}`);
  lines.push('');

  // Budget overview
  lines.push('Budget:');
  if (status.budget.tokenBudget) {
    lines.push(`  Tokens: ${status.tokensUsed.toLocaleString()} / ${status.budget.tokenBudget.toLocaleString()}`);
  }
  if (status.budget.timeBudget) {
    lines.push(`  Time: ${status.budget.timeBudget}`);
  }
  lines.push(`  Utilization: ${status.utilizationPercent.toFixed(1)}%`);
  if (status.alertLevel) {
    lines.push(`  Alert: ${status.alertLevel.toUpperCase()}`);
  }
  lines.push('');

  // Per-bet breakdown
  if (status.perBet.length > 0) {
    lines.push('Per-Bet Allocation:');
    for (const bet of status.perBet) {
      const cycleBet = cycle.bets.find((b) => b.id === bet.betId);
      const label = cycleBet?.description ?? bet.betId;
      const truncated = label.length > 40 ? label.slice(0, 37) + '...' : label;
      lines.push(`  ${truncated}  ${bet.used.toLocaleString()} / ${bet.allocated.toLocaleString()} tokens (${bet.utilizationPercent.toFixed(1)}%)`);
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format a cooldown report as a retrospective summary.
 */
export function formatCooldownReport(report: CooldownReport): string {
  const lines: string[] = [];

  lines.push('=== Cooldown Report ===');
  lines.push('');
  lines.push(`Cycle: ${report.cycleName ?? report.cycleId}`);
  lines.push(`Completion Rate: ${report.completionRate.toFixed(1)}%`);
  lines.push(`Token Utilization: ${report.utilizationPercent.toFixed(1)}%`);
  if (report.alertLevel) {
    lines.push(`Alert Level: ${report.alertLevel.toUpperCase()}`);
  }
  lines.push('');

  // Budget summary
  lines.push('Budget:');
  if (report.budget.tokenBudget) {
    lines.push(`  Tokens: ${report.tokensUsed.toLocaleString()} / ${report.budget.tokenBudget.toLocaleString()}`);
  }
  if (report.budget.timeBudget) {
    lines.push(`  Time: ${report.budget.timeBudget}`);
  }
  lines.push('');

  // Bet outcomes
  if (report.bets.length > 0) {
    lines.push('Bets:');
    for (const bet of report.bets) {
      const icon = outcomeIcon(bet.outcome);
      lines.push(`  ${icon} ${bet.description} (appetite: ${bet.appetite}%)`);
      lines.push(`    Outcome: ${bet.outcome}`);
      if (bet.outcomeNotes) {
        lines.push(`    Notes: ${bet.outcomeNotes}`);
      }
      lines.push(`    Pipelines: ${bet.pipelineCount}`);
    }
    lines.push('');
  }

  // Summary
  lines.push('Summary:');
  lines.push(report.summary);

  return lines.join('\n').trimEnd();
}

/**
 * Format cycle status as JSON.
 */
export function formatCycleStatusJson(status: BudgetStatus, cycle: Cycle): string {
  return JSON.stringify({ status, cycle }, null, 2);
}

/**
 * Format cooldown report as JSON.
 */
export function formatCooldownReportJson(report: CooldownReport): string {
  return JSON.stringify(report, null, 2);
}

// ---- Helpers ----

function outcomeIcon(outcome: string): string {
  switch (outcome) {
    case 'complete': return '[+]';
    case 'partial': return '[~]';
    case 'abandoned': return '[-]';
    default: return '[ ]';
  }
}
