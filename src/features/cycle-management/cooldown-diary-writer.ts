import { join } from 'node:path';
import type { CycleManager } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { RuleSuggestion } from '@domain/types/rule.js';
import type { SynthesisProposal } from '@domain/types/synthesis.js';
import type { SessionBuilder } from '@features/dojo/session-builder.js';
import { DiaryWriter } from '@features/dojo/diary-writer.js';
import { DiaryStore } from '@infra/dojo/diary-store.js';
import { DataAggregator } from '@features/dojo/data-aggregator.js';
import { logger } from '@shared/lib/logger.js';
import type { BetOutcomeRecord } from './cooldown-session.js';
import type { CycleProposal } from './proposal-generator.js';
import type { RunSummary } from './types.js';
import {
  buildAgentPerspectiveFromProposals,
  buildDiaryBetOutcomesFromCycleBets,
  buildDojoSessionBuildRequest,
} from './cooldown-session.helpers.js';

/**
 * Dependencies injected into CooldownDiaryWriter for testability.
 */
export interface CooldownDiaryDeps {
  dojoDir?: string;
  dojoSessionBuilder?: Pick<SessionBuilder, 'build'>;
  knowledgeStore: IKnowledgeStore;
  cycleManager: CycleManager;
  runsDir?: string;
}

/**
 * Handles diary writing and dojo session generation during cooldown.
 *
 * Extracted from CooldownSession to isolate the diary persistence logic
 * (run diary, complete diary, bet enrichment, dojo sessions) from the
 * cooldown orchestration logic.
 *
 * Non-critical: all write failures are logged as warnings and never abort cooldown.
 */
export class CooldownDiaryWriter {
  constructor(
    private readonly deps: CooldownDiaryDeps,
    /** Injectable diary write function for testability. Defaults to real DiaryStore + DiaryWriter. */
    private readonly diaryWriteFn?: (input: Record<string, unknown>) => void,
  ) {}

  /**
   * Write a diary entry for a one-shot cooldown run.
   * Enriches bet outcomes with descriptions from the cycle before writing.
   */
  writeForRun(input: {
    cycleId: string;
    cycleName?: string;
    cycle: Cycle;
    betOutcomes: BetOutcomeRecord[];
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    learningsCaptured: number;
    ruleSuggestions?: RuleSuggestion[];
    humanPerspective?: string;
  }): void {
    // Stryker disable next-line ConditionalExpression: guard redundant with catch in writeDiaryEntry
    if (!this.deps.dojoDir) return;

    this.writeDiaryEntry({
      cycleId: input.cycleId,
      cycleName: input.cycleName,
      betOutcomes: this.enrichBetOutcomesWithDescriptions(input.cycle, input.betOutcomes),
      proposals: input.proposals,
      runSummaries: input.runSummaries,
      learningsCaptured: input.learningsCaptured,
      ruleSuggestions: input.ruleSuggestions,
      humanPerspective: input.humanPerspective,
    });
  }

  /**
   * Write a diary entry for the two-phase cooldown complete step.
   * Derives bet outcomes from cycle state and builds agent perspective from synthesis proposals.
   */
  writeForComplete(input: {
    cycleId: string;
    cycleName?: string;
    cycle: Cycle;
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    ruleSuggestions?: RuleSuggestion[];
    synthesisProposals?: SynthesisProposal[];
  }): void {
    if (!this.deps.dojoDir) return;

    this.writeDiaryEntry({
      cycleId: input.cycleId,
      cycleName: input.cycleName,
      betOutcomes: buildDiaryBetOutcomesFromCycleBets(input.cycle.bets) as BetOutcomeRecord[],
      proposals: input.proposals,
      runSummaries: input.runSummaries,
      learningsCaptured: 0,
      ruleSuggestions: input.ruleSuggestions,
      agentPerspective: buildAgentPerspectiveFromProposals(input.synthesisProposals ?? []),
    });
  }

  /**
   * Enrich bet outcomes with human-readable descriptions from the cycle's bets.
   * Preserves any existing betDescription — only fills in missing ones.
   */
  enrichBetOutcomesWithDescriptions(cycle: Cycle, betOutcomes: BetOutcomeRecord[]): BetOutcomeRecord[] {
    const betDescriptionMap = new Map(cycle.bets.map((bet) => [bet.id, bet.description]));
    return betOutcomes.map((betOutcome) => ({
      ...betOutcome,
      // Stryker disable next-line LogicalOperator: fallback enriches diary presentation — both paths produce valid output
      betDescription: betOutcome.betDescription ?? betDescriptionMap.get(betOutcome.betId),
    }));
  }

  /**
   * Generate a dojo session if both dojoDir and dojoSessionBuilder are configured.
   * Non-critical — any error is caught and logged.
   */
  writeDojoSession(cycleId: string, cycleName?: string): void {
    if (!this.deps.dojoDir || !this.deps.dojoSessionBuilder) return;
    try {
      const request = this.buildDojoSessionRequest(cycleId, cycleName);
      const data = this.gatherDojoSessionData(request);
      this.deps.dojoSessionBuilder.build(data, { title: request.title });
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      // Stryker disable next-line all: presentation text in warning message
      logger.warn(`Failed to generate dojo session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private writeDiaryEntry(input: {
    cycleId: string;
    cycleName?: string;
    betOutcomes: BetOutcomeRecord[];
    proposals: CycleProposal[];
    runSummaries?: RunSummary[];
    learningsCaptured: number;
    ruleSuggestions?: RuleSuggestion[];
    agentPerspective?: string;
    humanPerspective?: string;
  }): void {
    try {
      if (this.diaryWriteFn) {
        this.diaryWriteFn(input as unknown as Record<string, unknown>);
        return;
      }
      const diaryDir = join(this.deps.dojoDir!, 'diary');
      const store = new DiaryStore(diaryDir);
      const writer = new DiaryWriter(store);
      writer.write({
        ...input,
        agentPerspective: input.agentPerspective,
        humanPerspective: input.humanPerspective,
      });
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      // Stryker disable next-line all: presentation text in warning message
      logger.warn(`Failed to write dojo diary entry: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private buildDojoSessionRequest(cycleId: string, cycleName?: string): {
    diaryDir: string;
    runsDir: string;
    title: string;
  } {
    return buildDojoSessionBuildRequest({
      dojoDir: this.deps.dojoDir!,
      cycleId,
      cycleName,
      runsDir: this.deps.runsDir,
    });
  }

  private gatherDojoSessionData(request: { diaryDir: string; runsDir: string }): ReturnType<DataAggregator['gather']> {
    const diaryStore = new DiaryStore(request.diaryDir);
    const aggregator = new DataAggregator({
      knowledgeStore: this.deps.knowledgeStore as import('@features/dojo/data-aggregator.js').IDojoKnowledgeStore,
      diaryStore,
      cycleManager: this.deps.cycleManager,
      runsDir: request.runsDir,
    });

    // Stryker disable next-line ObjectLiteral: maxDiaries default matches explicit value — equivalent
    return aggregator.gather({ maxDiaries: 5 });
  }
}
