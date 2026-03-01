import type { BudgetStatus, Cycle } from '@domain/types/cycle.js';
import type { CooldownReport, CooldownBetReport } from '@domain/services/cycle-manager.js';
import type { CycleProposal } from '@features/cycle-management/proposal-generator.js';
import type { CooldownSessionResult } from '@features/cycle-management/cooldown-session.js';
import type { RunSummary } from '@features/cycle-management/types.js';
import type { DomainTags } from '@domain/types/domain-tags.js';
import { getLexicon, cap } from '@cli/lexicon.js';

/**
 * Format cycle budget status as a human-readable summary.
 */
export function formatCycleStatus(status: BudgetStatus, cycle: Cycle, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`${cap(lex.cycle)}: ${cycle.name ?? cycle.id}`);
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
      if (cycleBet?.domainTags) {
        const tagLine = formatDomainTagsLine(cycleBet.domainTags);
        if (tagLine) {
          lines.push(`    tags: ${tagLine}`);
        }
      }
    }
  }

  return lines.join('\n').trimEnd();
}

/**
 * Format a cooldown report as a retrospective summary.
 */
export function formatCooldownReport(report: CooldownReport, plain?: boolean): string {
  const lines: string[] = [];
  const lex = getLexicon(plain);

  lines.push(`=== ${cap(lex.cooldown)} Report ===`);
  lines.push('');
  lines.push(`${cap(lex.cycle)}: ${report.cycleName ?? report.cycleId}`);
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
export function formatProposals(proposals: CycleProposal[], plain?: boolean): string {
  const lex = getLexicon(plain);
  if (proposals.length === 0) {
    return `No proposals generated for the next ${lex.cycle}.`;
  }

  const lines: string[] = [];
  lines.push(`=== Next-${cap(lex.cycle)} Proposals ===`);
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
export function formatCooldownSessionResult(
  result: CooldownSessionResult,
  suggestionReview?: { accepted: number; rejected: number; deferred: number },
  plain?: boolean,
): string {
  const lines: string[] = [];

  // Use the existing cooldown report formatter
  lines.push(formatCooldownReport(result.report, plain));
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

  // Run summaries section
  if (result.runSummaries && result.runSummaries.length > 0) {
    lines.push('--- Run Summaries ---');
    for (const s of result.runSummaries) {
      lines.push(formatRunSummaryLine(s));
    }
    lines.push('');
  }

  // Rule suggestions review section
  if (suggestionReview) {
    lines.push('--- Rule Suggestions ---');
    lines.push(`  Accepted: ${suggestionReview.accepted}, Rejected: ${suggestionReview.rejected}, Deferred: ${suggestionReview.deferred}`);
    lines.push('');
  } else if (result.ruleSuggestions && result.ruleSuggestions.length > 0) {
    lines.push('--- Rule Suggestions ---');
    lines.push(`  ${result.ruleSuggestions.length} pending suggestion(s) (run interactively to review)`);
    lines.push('');
  }

  // Proposals section
  if (result.proposals.length > 0) {
    lines.push(formatProposals(result.proposals, plain));
  } else {
    const lex = getLexicon(plain);
    lines.push(`No proposals generated for the next ${lex.cycle}.`);
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

function formatRunSummaryLine(s: RunSummary): string {
  const confidence = s.avgConfidence !== null
    ? `avg confidence ${(s.avgConfidence * 100).toFixed(0)}%`
    : 'no decisions recorded';
  const gaps = s.gapCount > 0
    ? `${s.gapCount} gap(s) [H:${s.gapsBySeverity.high} M:${s.gapsBySeverity.medium} L:${s.gapsBySeverity.low}]`
    : 'no gaps';
  const yolo = s.yoloDecisionCount > 0 ? ` (${s.yoloDecisionCount} --yolo decision(s))` : '';
  return `  bet ${s.betId.slice(0, 8)}: ${s.stagesCompleted} stage(s) completed, ${gaps}, ${confidence}${yolo}`;
}

function outcomeIcon(outcome: string): string {
  switch (outcome) {
    case 'complete': return '[+]';
    case 'partial': return '[~]';
    case 'abandoned': return '[-]';
    default: return '[ ]';
  }
}

/**
 * Format domain tags as a single-line string separated by ' · '.
 * Only non-empty fields are included. Returns empty string if no tags set.
 */
export function formatDomainTagsLine(tags: DomainTags): string {
  const parts: string[] = [];
  if (tags.language) parts.push(tags.language);
  if (tags.domain) parts.push(tags.domain);
  if (tags.workType) parts.push(tags.workType);
  if (tags.framework) parts.push(tags.framework);
  if (tags.scope) parts.push(tags.scope);
  if (tags.novelty) parts.push(tags.novelty);
  return parts.join(' · ');
}
