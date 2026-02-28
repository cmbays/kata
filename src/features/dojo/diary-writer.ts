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
}

export class DiaryWriter {
  constructor(private readonly store: DiaryStore) {}

  write(input: DiaryWriterInput): DojoDiaryEntry {
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
      createdAt: new Date().toISOString(),
    });

    this.store.write(entry);
    return entry;
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
        const notes = b.notes ? ` — ${b.notes}` : '';
        return `Completed bet${notes}`;
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
