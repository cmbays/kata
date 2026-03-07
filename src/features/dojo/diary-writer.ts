import type { DojoDiaryEntry } from '@domain/types/dojo.js';
import { DojoDiaryEntrySchema, type DojoMood } from '@domain/types/dojo.js';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import type { BetOutcomeRecord } from '@features/cycle-management/cooldown-session.js';
import type { CycleProposal } from '@features/cycle-management/proposal-generator.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import type { RunSummary } from '@features/cycle-management/types.js';

export interface DiaryWriterInput {
  cycleId: string;
  cycleName?: string;
  narrative?: string;
  betOutcomes: BetOutcomeRecord[];
  proposals: CycleProposal[];
  runSummaries?: RunSummary[];
  learningsCaptured: number;
  ruleSuggestions?: RuleSuggestion[];
  /** Part 2 — sensei narrative or synthesis summary. Absent in --prepare mode. */
  agentPerspective?: string;
  /** Part 3 — human input captured during collaborative cooldown. Absent in --yolo mode. */
  humanPerspective?: string;
}

export class DiaryWriter {
  constructor(private readonly store: DiaryStore) {}

  write(input: DiaryWriterInput): DojoDiaryEntry {
    const rawDataSummary = this.buildRawDataSummary(input);
    const narrative = input.narrative ?? this.generateNarrative(input);
    const wins = this.extractWins(input);
    const painPoints = this.extractPainPoints(input);
    const openQuestions = this.extractOpenQuestions(input);
    const mood = this.inferMood(input);
    const tags = this.extractTags(input);

    const entry = DojoDiaryEntrySchema.parse({
      id: crypto.randomUUID(),
      cycleId: input.cycleId,
      cycleName: input.cycleName,
      narrative,
      wins,
      painPoints,
      openQuestions,
      mood,
      tags,
      rawDataSummary,
      agentPerspective: input.agentPerspective,
      humanPerspective: input.humanPerspective,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    this.store.write(entry);
    return entry;
  }

  /**
   * Build Part 1 of the three-part diary: a deterministic structured summary
   * of all cycle data — observations, decisions, gaps, bet outcomes, learnings.
   * This is the factual foundation; no interpretation.
   */
  buildRawDataSummary(input: DiaryWriterInput): string {
    const lines: string[] = [];
    const name = input.cycleName ?? input.cycleId;

    lines.push(`## Cycle: ${name}`);
    lines.push('');

    // Bet outcomes
    lines.push('### Bet Outcomes');
    if (input.betOutcomes.length === 0) {
      lines.push('No bets recorded.');
    } else {
      for (const bet of input.betOutcomes) {
        const icon = bet.outcome === 'complete' ? '✓' : bet.outcome === 'partial' ? '~' : bet.outcome === 'abandoned' ? '✗' : '·';
        const label = bet.betDescription ?? `bet ${bet.betId.slice(0, 8)}`;
        const notes = bet.notes ? ` — ${bet.notes}` : '';
        lines.push(`  ${icon} [${bet.outcome}] ${label}${notes}`);
      }
      const complete = input.betOutcomes.filter((b) => b.outcome === 'complete').length;
      lines.push(`  Completion rate: ${complete}/${input.betOutcomes.length} bets (${Math.round((complete / input.betOutcomes.length) * 100)}%)`);
    }

    // Per-run data from runSummaries
    if (input.runSummaries && input.runSummaries.length > 0) {
      lines.push('');
      lines.push('### Run Data');
      for (const summary of input.runSummaries) {
        lines.push(`  Run ${summary.runId.slice(0, 8)}:`);

        // Gaps by severity
        const { high, medium, low } = summary.gapsBySeverity;
        if (high + medium + low > 0) {
          lines.push(`    Gaps: ${high} high, ${medium} medium, ${low} low`);
        }

        // Stage details
        if (summary.stageDetails && summary.stageDetails.length > 0) {
          const stages = summary.stageDetails.map((s) => s.category).join(', ');
          lines.push(`    Stages: ${stages}`);
        }

        // Decision quality
        if (summary.avgConfidence !== null) {
          lines.push(`    Avg decision confidence: ${(summary.avgConfidence * 100).toFixed(0)}%`);
        }
        if (summary.yoloDecisionCount > 0) {
          lines.push(`    Decisions bypassed with --yolo: ${summary.yoloDecisionCount}`);
        }
        if (summary.artifactPaths.length > 0) {
          lines.push(`    Artifacts: ${summary.artifactPaths.length}`);
        }
      }
    }

    // Learnings captured
    lines.push('');
    lines.push('### Intelligence');
    lines.push(`  Learnings captured: ${input.learningsCaptured}`);

    // Next-cycle proposals
    if (input.proposals.length > 0) {
      lines.push(`  Next-cycle proposals: ${input.proposals.length}`);
      for (const p of input.proposals.slice(0, 5)) {
        lines.push(`    · [${p.priority}] ${p.description}`);
      }
      if (input.proposals.length > 5) {
        lines.push(`    … and ${input.proposals.length - 5} more`);
      }
    }

    // Rule suggestions
    if (input.ruleSuggestions && input.ruleSuggestions.length > 0) {
      lines.push(`  Pending rule suggestions: ${input.ruleSuggestions.length}`);
    }

    return lines.join('\n');
  }

  private generateNarrative(input: DiaryWriterInput): string {
    const total = input.betOutcomes.length;
    const complete = input.betOutcomes.filter((b) => b.outcome === 'complete').length;
    const partial = input.betOutcomes.filter((b) => b.outcome === 'partial').length;
    const abandoned = input.betOutcomes.filter((b) => b.outcome === 'abandoned').length;

    const parts: string[] = [];
    const name = input.cycleName ? `'${input.cycleName}'` : input.cycleId;
    parts.push(`Cycle ${name} completed with ${complete}/${total} bets fully delivered.`);

    if (partial > 0) parts.push(`${partial} bet(s) partially completed.`);
    if (abandoned > 0) parts.push(`${abandoned} bet(s) abandoned.`);
    if (input.learningsCaptured > 0) parts.push(`${input.learningsCaptured} learning(s) captured.`);
    if (input.proposals.length > 0) parts.push(`${input.proposals.length} proposal(s) generated for the next cycle.`);

    return parts.join(' ');
  }

  private extractWins(input: DiaryWriterInput): string[] {
    return input.betOutcomes
      .filter((b) => b.outcome === 'complete')
      .map((b) => {
        const label = b.betDescription ?? 'Completed bet';
        const notes = b.notes ? ` — ${b.notes}` : '';
        return `${label}${notes}`;
      });
  }

  private extractPainPoints(input: DiaryWriterInput): string[] {
    const points: string[] = [];
    for (const bet of input.betOutcomes) {
      if (bet.outcome === 'abandoned') {
        points.push(`Abandoned bet${bet.notes ? `: ${bet.notes}` : ''}`);
      } else if (bet.outcome === 'partial') {
        points.push(`Partial completion${bet.notes ? `: ${bet.notes}` : ''}`);
      }
    }
    if (input.runSummaries) {
      for (const summary of input.runSummaries) {
        if (summary.gapsBySeverity.high > 0) {
          points.push(`High-severity gaps in run ${summary.runId.slice(0, 8)}`);
        }
      }
    }
    return points;
  }

  private extractOpenQuestions(input: DiaryWriterInput): string[] {
    return input.proposals
      .filter((p) => p.priority === 'high' || p.priority === 'medium')
      .slice(0, 5)
      .map((p) => p.description);
  }

  private inferMood(input: DiaryWriterInput): DojoMood {
    if (input.betOutcomes.length === 0) return 'reflective';
    const total = input.betOutcomes.length;
    const complete = input.betOutcomes.filter((b) => b.outcome === 'complete').length;
    const ratio = complete / total;
    if (ratio > 0.8) return 'energized';
    if (ratio >= 0.5) return 'steady';
    return 'frustrated';
  }

  private extractTags(input: DiaryWriterInput): string[] {
    const tags = new Set<string>();
    if (input.runSummaries) {
      for (const summary of input.runSummaries) {
        if (summary.stageDetails) {
          for (const detail of summary.stageDetails) {
            tags.add(detail.category);
          }
        }
      }
    }
    if (input.betOutcomes.some((b) => b.outcome === 'abandoned')) tags.add('abandoned-bets');
    if (input.learningsCaptured > 0) tags.add('learnings');
    return [...tags].sort();
  }
}
