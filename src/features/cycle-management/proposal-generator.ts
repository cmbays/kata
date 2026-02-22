import { join } from 'node:path';
import type { Cycle } from '@domain/types/cycle.js';
import type { CycleManager } from '@domain/services/cycle-manager.js';
import type { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import type { Pipeline } from '@domain/types/pipeline.js';
import { PipelineSchema } from '@domain/types/pipeline.js';
import { JsonStore } from '@infra/persistence/json-store.js';

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
  source: 'unfinished' | 'unblocked' | 'learning' | 'dependency';
  relatedBetIds?: string[];
  relatedLearningIds?: string[];
}

/**
 * Dependencies injected into the ProposalGenerator for testability.
 */
export interface ProposalGeneratorDeps {
  cycleManager: CycleManager;
  knowledgeStore: KnowledgeStore;
  pipelineDir: string;
  historyDir: string;
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
   * 2. Learning-driven (high-confidence learnings that suggest new work)
   * 3. Dependency-based (completed bets that unblock new work)
   *
   * Priority order: unfinished > dependency > learning
   */
  generate(cycleId: string): CycleProposal[] {
    const cycle = this.deps.cycleManager.get(cycleId);

    const unfinished = this.analyzeUnfinishedWork(cycle);
    const learningProposals = this.analyzeLearnings(cycleId);
    const dependencyProposals = this.analyzeDependencies(cycle);

    const all = [...unfinished, ...dependencyProposals, ...learningProposals];
    return this.prioritize(all);
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
    const sourceOrder: Record<string, number> = { unfinished: 0, dependency: 1, unblocked: 2, learning: 3 };

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
      if (JsonStore.exists(path)) {
        try {
          pipelines.push(JsonStore.read(path, PipelineSchema));
        } catch {
          // Skip invalid pipeline files
        }
      }
    }

    return pipelines;
  }
}
