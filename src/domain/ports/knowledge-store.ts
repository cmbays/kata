import type { Learning, LearningFilter, LearningInput } from '@domain/types/learning.js';

/**
 * Summary statistics for the knowledge store.
 * Defined here in the port layer so feature-layer consumers don't depend on infra.
 */
export interface KnowledgeStats {
  /** Total number of learnings */
  total: number;
  /** Count of learnings per tier */
  byTier: {
    step: number;
    flavor: number;
    stage: number;
    category: number;
    agent: number;
  };
  /** Top categories ranked by learning count */
  topCategories: Array<{ category: string; count: number }>;
  /** Average confidence score across all learnings */
  averageConfidence: number;
}

/**
 * Port interface for the knowledge/learning store.
 * Used by PipelineRunner, CooldownSession, and ProposalGenerator to load and
 * capture learnings without depending on the concrete KnowledgeStore class.
 */
export interface IKnowledgeStore {
  /** Tier 1: load all stage-level learnings for a given stage type. */
  loadForStage(stageType: string): Learning[];
  /** Tier 2: load category learnings for an agent's subscriptions. */
  loadForSubscriptions(agentId: string): Learning[];
  /** Persist a new learning (timestamps and ID are generated automatically). */
  capture(learning: Omit<LearningInput, 'id' | 'createdAt' | 'updatedAt'>): Learning;
  /** Query learnings with filters. Returns all learnings if filter is empty. */
  query(filter: LearningFilter): Learning[];
}
