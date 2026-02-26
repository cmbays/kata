import { join } from 'node:path';
import type { Cycle } from '@domain/types/cycle.js';
import type { CycleManager } from '@domain/services/cycle-manager.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { IPersistence } from '@domain/ports/persistence.js';
import type { Pipeline } from '@domain/types/pipeline.js';
import { PipelineSchema } from '@domain/types/pipeline.js';
import { logger } from '@shared/lib/logger.js';
import type { RunSummary } from './types.js';
import { analyzeFlavorFrequency, analyzeRecurringGaps } from './cross-run-analyzer.js';

/**
 * A proposal for the next development cycle, derived from analysis
 * of the current cycle's outcomes, learnings, and dependencies.
 */
export interface CycleProposal {
  id: string;
  description: string;
  rationale: string;
  suggestedAppetite: number; // 1-100
  priority: 'high' | 'medium' | 'low';
  source: 'unfinished' | 'unblocked' | 'learning' | 'dependency' | 'run-gap' | 'low-confidence' | 'cross-gap' | 'unused-flavor';
  relatedBetIds?: string[];
  relatedLearningIds?: string[];
}

/**
 * Dependencies injected into the ProposalGenerator for testability.
 */
export interface ProposalGeneratorDeps {
  cycleManager: CycleManager;
  knowledgeStore: IKnowledgeStore;
  persistence: IPersistence;
  pipelineDir: string;
}

/**
 * Generates next-cycle proposals based on what was completed,
 * what was learned, and what is unblocked.
 */
export class ProposalGenerator {
  constructor(private readonly deps: ProposalGeneratorDeps) {}

  /**
   * Generate prioritized proposals for the next cycle.
   *
   * 1. Unfinished work (partial/abandoned bets) -> carry forward
   * 2. Run-gap proposals (high/medium severity gaps from run data)
   * 3. Learning-driven (high-confidence learnings that suggest new work)
   * 4. Dependency-based (completed bets that unblock new work)
   * 5. Low-confidence proposals (avgConfidence < 0.6, non-null)
   *
   * Priority order: unfinished > dependency > learning (see sourceOrder in prioritize()).
   *
   * @param cycleId - ID of the cycle to analyze
   * @param runSummaries - Optional run summaries from .kata/runs/ for richer proposals
   */
  generate(cycleId: string, runSummaries?: RunSummary[]): CycleProposal[] {
    const cycle = this.deps.cycleManager.get(cycleId);

    const unfinished = this.analyzeUnfinishedWork(cycle);
    const learningProposals = this.analyzeLearnings(cycleId);
    const dependencyProposals = this.analyzeDependencies(cycle);
    const runProposals = runSummaries ? this.analyzeRunData(runSummaries) : [];
    const crossRunProposals = runSummaries && runSummaries.length >= 2
      ? this.analyzeCrossRunPatterns(runSummaries)
      : [];

    const all = [...unfinished, ...dependencyProposals, ...crossRunProposals, ...learningProposals, ...runProposals];
    return this.prioritize(all);
  }

  /**
   * Produce proposals from run execution data.
   *
   * Rules (applied per RunSummary):
   * - gapsBySeverity.high > 0 → high-priority 'run-gap' proposal
   * - other gapCount > 0 (low/medium gaps only) → medium-priority 'run-gap' proposal
   * - avgConfidence !== null && avgConfidence < 0.6 → low-priority 'low-confidence' proposal
   *   (null means no decisions recorded; skip to avoid false alarms)
   */
  analyzeRunData(summaries: RunSummary[]): CycleProposal[] {
    const proposals: CycleProposal[] = [];

    for (const summary of summaries) {
      if (summary.gapsBySeverity.high > 0) {
        proposals.push({
          id: crypto.randomUUID(),
          description: `Address coverage gaps: ${summary.gapsBySeverity.high} high-severity gap(s) in run ${summary.runId.slice(0, 8)}`,
          rationale: `Run for bet "${summary.betId}" had ${summary.gapsBySeverity.high} high-severity orchestration gap(s) (${summary.gapsBySeverity.medium} medium, ${summary.gapsBySeverity.low} low). High-severity gaps indicate missing flavor coverage.`,
          suggestedAppetite: 20,
          priority: 'high',
          source: 'run-gap',
          relatedBetIds: [summary.betId],
        });
      } else if (summary.gapCount > 0) {
        proposals.push({
          id: crypto.randomUUID(),
          description: `Review flavor coverage: ${summary.gapCount} gap(s) in run ${summary.runId.slice(0, 8)}`,
          rationale: `Run for bet "${summary.betId}" had ${summary.gapCount} orchestration gap(s) (${summary.gapsBySeverity.medium} medium, ${summary.gapsBySeverity.low} low). Consider adding flavors to improve coverage.`,
          suggestedAppetite: 10,
          priority: 'medium',
          source: 'run-gap',
          relatedBetIds: [summary.betId],
        });
      }

      if (summary.avgConfidence !== null && summary.avgConfidence < 0.6) {
        proposals.push({
          id: crypto.randomUUID(),
          description: `Improve decision confidence: avg ${(summary.avgConfidence * 100).toFixed(0)}% in run ${summary.runId.slice(0, 8)}`,
          rationale: `Run for bet "${summary.betId}" had low average decision confidence (${(summary.avgConfidence * 100).toFixed(0)}%). Adding rules or vocabulary may help the orchestrator make higher-confidence selections.`,
          suggestedAppetite: 10,
          priority: 'low',
          source: 'low-confidence',
          relatedBetIds: [summary.betId],
        });
      }
    }

    // Yolo surfacing: emit a single proposal when any runs had --yolo decisions
    const totalYolo = summaries.reduce((sum, s) => sum + s.yoloDecisionCount, 0);
    if (totalYolo > 0) {
      const involvedBetIds = summaries
        .filter((s) => s.yoloDecisionCount > 0)
        .map((s) => s.betId);
      proposals.push({
        id: crypto.randomUUID(),
        description: `Review ${totalYolo} --yolo decision(s) that bypassed confidence gates`,
        rationale: `${totalYolo} decision(s) bypassed confidence gates with --yolo across ${involvedBetIds.length} bet(s) (${involvedBetIds.map((id) => id.slice(0, 8)).join(', ')}). Reviewing these may reveal areas where better rules or vocabulary would help.`,
        suggestedAppetite: 10,
        priority: 'medium',
        source: 'low-confidence',
        relatedBetIds: involvedBetIds,
      });
    }

    return proposals;
  }

  /**
   * Produce proposals from cross-run pattern analysis.
   * Requires at least 2 run summaries to be meaningful.
   *
   * - Recurring gaps (same description in 2+ bets) → high-priority 'cross-gap' proposals
   * - Under-used flavors (appear in only 1 run) → low-priority 'unused-flavor' proposals (max 3)
   */
  analyzeCrossRunPatterns(summaries: RunSummary[]): CycleProposal[] {
    const proposals: CycleProposal[] = [];

    // Recurring gaps
    const recurringGaps = analyzeRecurringGaps(summaries);
    for (const gap of recurringGaps) {
      const relatedBetIds = summaries
        .filter((s) => s.stageDetails.some((stage) => stage.gaps.some((g) => g.description === gap.description)))
        .map((s) => s.betId);
      proposals.push({
        id: crypto.randomUUID(),
        description: `Address recurring gap: ${gap.description}`,
        rationale: `This gap appeared in ${gap.betCount} bet(s) across multiple runs, suggesting a systematic coverage issue.`,
        suggestedAppetite: 15,
        priority: 'high',
        source: 'cross-gap',
        relatedBetIds,
      });
    }

    // Under-used flavors (appear in exactly 1 run out of 2+ — potentially valuable but under-adopted)
    const flavorFreq = analyzeFlavorFrequency(summaries);
    let unusedFlavorCount = 0;
    for (const [flavorName, count] of flavorFreq.entries()) {
      if (summaries.length >= 2 && count === 1 && unusedFlavorCount < 3) {
        proposals.push({
          id: crypto.randomUUID(),
          description: `Consider using unused flavor: ${flavorName}`,
          rationale: `Flavor "${flavorName}" was used in only 1 of ${summaries.length} runs. Consider whether it should be applied more broadly.`,
          suggestedAppetite: 5,
          priority: 'low',
          source: 'unused-flavor',
        });
        unusedFlavorCount++;
      }
    }

    return proposals;
  }

  /**
   * Extract proposals from incomplete bets (partial or abandoned).
   * These are the highest priority — work already scoped but not finished.
   */
  analyzeUnfinishedWork(cycle: Cycle): CycleProposal[] {
    const proposals: CycleProposal[] = [];

    for (const bet of cycle.bets) {
      if (bet.outcome === 'partial') {
        // Partial work: reduce appetite (some work done), high priority
        const adjustedAppetite = Math.max(1, Math.round(bet.appetite * 0.6));
        proposals.push({
          id: crypto.randomUUID(),
          description: `Continue: ${bet.description}`,
          rationale: `Bet was partially completed in cycle "${cycle.name ?? cycle.id}". Carrying forward with reduced appetite since some work is done.${bet.outcomeNotes ? ` Notes: ${bet.outcomeNotes}` : ''}`,
          suggestedAppetite: adjustedAppetite,
          priority: 'high',
          source: 'unfinished',
          relatedBetIds: [bet.id],
        });
      } else if (bet.outcome === 'abandoned') {
        // Abandoned work: keep same appetite (no progress), medium priority
        proposals.push({
          id: crypto.randomUUID(),
          description: `Retry: ${bet.description}`,
          rationale: `Bet was abandoned in cycle "${cycle.name ?? cycle.id}". Consider re-scoping or breaking into smaller bets.${bet.outcomeNotes ? ` Notes: ${bet.outcomeNotes}` : ''}`,
          suggestedAppetite: bet.appetite,
          priority: 'medium',
          source: 'unfinished',
          relatedBetIds: [bet.id],
        });
      }
    }

    return proposals;
  }

  /**
   * Extract proposals from recent high-confidence learnings.
   * Learnings with confidence >= 0.7 that suggest process improvements
   * or new capabilities are converted to proposals.
   */
  analyzeLearnings(_cycleId: string): CycleProposal[] {
    const proposals: CycleProposal[] = [];

    // Query high-confidence learnings
    const learnings = this.deps.knowledgeStore.query({
      minConfidence: 0.7,
    });

    if (learnings.length === 0) {
      return proposals;
    }

    // Group learnings by category to avoid redundant proposals
    const byCategory = new Map<string, typeof learnings>();
    for (const learning of learnings) {
      const existing = byCategory.get(learning.category) ?? [];
      existing.push(learning);
      byCategory.set(learning.category, existing);
    }

    for (const [category, categoryLearnings] of byCategory) {
      // Take the highest-confidence learning in each category
      const best = categoryLearnings.sort((a, b) => b.confidence - a.confidence)[0];
      if (!best) continue;

      proposals.push({
        id: crypto.randomUUID(),
        description: `Learning-driven: ${best.content.slice(0, 80)}${best.content.length > 80 ? '...' : ''}`,
        rationale: `High-confidence learning (${(best.confidence * 100).toFixed(0)}%) in category "${category}" suggests process improvement. Based on ${best.evidence.length} evidence point(s).`,
        suggestedAppetite: 10, // Learnings typically suggest small improvements
        priority: 'low',
        source: 'learning',
        relatedLearningIds: categoryLearnings.map((l) => l.id),
      });
    }

    return proposals;
  }

  /**
   * Analyze completed bets to identify dependency-based proposals.
   * When bets complete successfully and had pipeline mappings,
   * check if their completion might unblock follow-up work.
   */
  analyzeDependencies(cycle: Cycle): CycleProposal[] {
    const proposals: CycleProposal[] = [];
    const completedBets = cycle.bets.filter((b) => b.outcome === 'complete');

    if (completedBets.length === 0) {
      return proposals;
    }

    // Load pipelines for this cycle to find dependency patterns
    const pipelines = this.loadCyclePipelines(cycle);
    const completedPipelineIds = new Set(
      cycle.pipelineMappings
        .filter((m) => completedBets.some((b) => b.id === m.betId))
        .map((m) => m.pipelineId),
    );

    // Check for pipelines that completed with artifacts suggesting next steps
    for (const pipeline of pipelines) {
      if (!completedPipelineIds.has(pipeline.id)) continue;
      if (pipeline.state !== 'complete') continue;

      // Look for research or spike pipelines — they typically unblock implementation
      if (pipeline.type === 'spike' || pipeline.type === 'vertical') {
        const relatedBet = cycle.bets.find(
          (b) => cycle.pipelineMappings.some((m) => m.pipelineId === pipeline.id && m.betId === b.id),
        );

        if (relatedBet) {
          proposals.push({
            id: crypto.randomUUID(),
            description: `Follow-up: Implementation from "${pipeline.name}"`,
            rationale: `Pipeline "${pipeline.name}" (${pipeline.type}) completed successfully. This may unblock follow-up implementation work.`,
            suggestedAppetite: Math.min(100, Math.round(relatedBet.appetite * 1.5)),
            priority: 'medium',
            source: 'dependency',
            relatedBetIds: [relatedBet.id],
          });
        }
      }
    }

    return proposals;
  }

  /**
   * Sort and deduplicate proposals.
   * Priority order: high > medium > low.
   * Within the same priority, unfinished > dependency > learning.
   */
  prioritize(proposals: CycleProposal[]): CycleProposal[] {
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const sourceOrder: Record<string, number> = {
      unfinished: 0,
      dependency: 1,
      'cross-gap': 1.5,
      'run-gap': 2,
      unblocked: 3,
      'unused-flavor': 3.5,
      learning: 4,
      'low-confidence': 5,
    };

    // Deduplicate by description similarity (exact match after trimming)
    const seen = new Set<string>();
    const unique: CycleProposal[] = [];
    for (const proposal of proposals) {
      const key = proposal.description.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(proposal);
      }
    }

    return unique.sort((a, b) => {
      const priorityDiff = (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2);
      if (priorityDiff !== 0) return priorityDiff;
      return (sourceOrder[a.source] ?? 3) - (sourceOrder[b.source] ?? 3);
    });
  }

  /**
   * Load all pipelines associated with a cycle via pipelineMappings.
   */
  private loadCyclePipelines(cycle: Cycle): Pipeline[] {
    const pipelineIds = new Set(cycle.pipelineMappings.map((m) => m.pipelineId));
    const pipelines: Pipeline[] = [];

    for (const id of pipelineIds) {
      const path = join(this.deps.pipelineDir, `${id}.json`);
      if (this.deps.persistence.exists(path)) {
        try {
          pipelines.push(this.deps.persistence.read(path, PipelineSchema));
        } catch (error) {
          logger.warn(`Skipping unreadable pipeline file: ${id}.json — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    return pipelines;
  }
}
