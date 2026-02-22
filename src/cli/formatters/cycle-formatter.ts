import type { BudgetStatus, Cycle } from '@domain/types/cycle.js';
import type { CooldownReport, CooldownBetReport } from '@domain/services/cycle-manager.js';
import type { CycleProposal } from '@features/cycle-management/proposal-generator.js';
import type { CooldownSessionResult } from '@features/cycle-management/cooldown-session.js';

/**
 * Format cycle budget status as a human-readable summary.
 */
export function formatCycleStatus(status: BudgetStatus, cycle: Cycle): string {
  const lines: string[] = [];

  lines.push(`Enbu: ${cycle.name ?? cycle.id}`);
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

  lines.push('=== Ma (Cooldown) Report ===');
  lines.push('');
  lines.push(`Enbu: ${report.cycleName ?? report.cycleId}`);
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

/**
 * Format cycle proposals as a human-readable list.
 */
export function formatProposals(proposals: CycleProposal[]): string {
  if (proposals.length === 0) {
    return 'No proposals generated for the next cycle.';
  }

  const lines: string[] = [];
  lines.push('=== Next-Cycle Proposals ===');
  lines.push('');

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i]!;
    const priorityTag = `[${p.priority.toUpperCase()}]`;
    lines.push(`${i + 1}. ${priorityTag} ${p.description}`);
    lines.push(`   Source: ${p.source} | Appetite: ${p.suggestedAppetite}%`);
    lines.push(`   Rationale: ${p.rationale}`);

    if (p.relatedBetIds && p.relatedBetIds.length > 0) {
      lines.push(`   Related bets: ${p.relatedBetIds.join(', ')}`);
    }
    if (p.relatedLearningIds && p.relatedLearningIds.length > 0) {
      lines.push(`   Related learnings: ${p.relatedLearningIds.join(', ')}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format proposals as JSON.
 */
export function formatProposalsJson(proposals: CycleProposal[]): string {
  return JSON.stringify(proposals, null, 2);
}

/**
 * Format a full cooldown session result.
 */
export function formatCooldownSessionResult(result: CooldownSessionResult): string {
  const lines: string[] = [];

  // Use the existing cooldown report formatter
  lines.push(formatCooldownReport(result.report));
  lines.push('');

  // Bet outcomes section
  if (result.betOutcomes.length > 0) {
    lines.push('--- Bet Outcomes Recorded ---');
    for (const outcome of result.betOutcomes) {
      const icon = outcomeIcon(outcome.outcome);
      lines.push(`  ${icon} ${outcome.betId}: ${outcome.outcome}${outcome.notes ? ` — ${outcome.notes}` : ''}`);
    }
    lines.push('');
  }

  // Learnings captured
  if (result.learningsCaptured > 0) {
    lines.push(`Learnings captured: ${result.learningsCaptured}`);
    lines.push('');
  }

  // Proposals section
  if (result.proposals.length > 0) {
    lines.push(formatProposals(result.proposals));
  } else {
    lines.push('No proposals generated for the next cycle.');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format a bet for the outcome selection prompt.
 */
export function formatBetOutcomePrompt(bet: CooldownBetReport): string {
  const icon = outcomeIcon(bet.outcome);
  const lines: string[] = [];
  lines.push(`${icon} ${bet.description}`);
  lines.push(`  Appetite: ${bet.appetite}% | Current outcome: ${bet.outcome} | Pipelines: ${bet.pipelineCount}`);
  if (bet.outcomeNotes) {
    lines.push(`  Notes: ${bet.outcomeNotes}`);
  }
  return lines.join('\n');
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
