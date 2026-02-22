import type { Learning, LearningFilter } from '@domain/types/learning.js';

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
  capture(learning: Omit<Learning, 'id' | 'createdAt' | 'updatedAt'>): Learning;
  /** Query learnings with filters. Returns all learnings if filter is empty. */
  query(filter: LearningFilter): Learning[];
}
