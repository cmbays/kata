import { join } from 'node:path';
import { LearningSchema } from '@domain/types/learning.js';
import type { Learning, LearningFilter } from '@domain/types/learning.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { SubscriptionManager } from './subscription-manager.js';

/**
 * Summary statistics for the knowledge store.
 */
export interface KnowledgeStats {
  /** Total number of learnings */
  total: number;
  /** Count of learnings per tier */
  byTier: {
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
 * Three-tier learning storage and retrieval system.
 *
 * - Tier 1 (Stage-level): Applies to all instances of a stage type. Auto-loaded whenever that stage runs.
 * - Tier 2 (Category): Applies within a domain category. Loaded via subscriptions.
 * - Tier 3 (Agent-specific): Personal behavioral patterns. Always loaded for that specific agent.
 *
 * Learnings are stored as individual JSON files in `.kata/knowledge/learnings/`,
 * one file per learning, named by ID.
 */
export class KnowledgeStore {
  private readonly learningsDir: string;
  private readonly subscriptionManager: SubscriptionManager;

  constructor(basePath: string) {
    this.learningsDir = join(basePath, 'learnings');
    this.subscriptionManager = new SubscriptionManager(basePath);
  }

  /**
   * Persist a new learning. Generates UUID and timestamps automatically.
   */
  capture(
    learning: Omit<Learning, 'id' | 'createdAt' | 'updatedAt'>,
  ): Learning {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const full: Learning = {
      ...learning,
      id,
      createdAt: now,
      updatedAt: now,
    };

    // Validate against schema
    const validated = LearningSchema.parse(full);

    const filePath = join(this.learningsDir, `${validated.id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Retrieve a single learning by ID.
   * @throws JsonStoreError if learning not found
   */
  get(id: string): Learning {
    const filePath = join(this.learningsDir, `${id}.json`);
    return JsonStore.read(filePath, LearningSchema);
  }

  /**
   * Query learnings with filters. All filter fields are optional.
   * Returns all learnings if no filter fields are set.
   */
  query(filter: LearningFilter): Learning[] {
    const all = JsonStore.list(this.learningsDir, LearningSchema);

    return all.filter((learning) => {
      if (filter.tier !== undefined && learning.tier !== filter.tier) {
        return false;
      }
      if (filter.category !== undefined && learning.category !== filter.category) {
        return false;
      }
      if (filter.stageType !== undefined && learning.stageType !== filter.stageType) {
        return false;
      }
      if (filter.agentId !== undefined && learning.agentId !== filter.agentId) {
        return false;
      }
      if (filter.minConfidence !== undefined && learning.confidence < filter.minConfidence) {
        return false;
      }
      return true;
    });
  }

  /**
   * Tier 1 auto-load: return all learnings where tier='stage' and stageType matches.
   */
  loadForStage(stageType: string): Learning[] {
    return this.query({ tier: 'stage', stageType });
  }

  /**
   * Tier 2 subscription-based: use SubscriptionManager to get agent's subscribed
   * categories, then query learnings matching those categories with tier='category'.
   */
  loadForSubscriptions(agentId: string): Learning[] {
    const categories = this.subscriptionManager.getSubscriptions(agentId);
    if (categories.length === 0) {
      return [];
    }

    // Query all category-tier learnings, then filter to subscribed categories
    const allCategoryLearnings = this.query({ tier: 'category' });
    return allCategoryLearnings.filter((l) => categories.includes(l.category));
  }

  /**
   * Tier 3 agent-specific: return all learnings where tier='agent' and agentId matches.
   */
  loadForAgent(agentId: string): Learning[] {
    return this.query({ tier: 'agent', agentId });
  }

  /**
   * Update a learning's content, confidence, or evidence array.
   * Returns the updated learning.
   * @throws JsonStoreError if learning not found
   */
  update(
    id: string,
    updates: Partial<Pick<Learning, 'content' | 'confidence' | 'evidence'>>,
  ): Learning {
    const existing = this.get(id);
    const now = new Date().toISOString();

    const updated: Learning = {
      ...existing,
      ...updates,
      updatedAt: now,
    };

    const validated = LearningSchema.parse(updated);
    const filePath = join(this.learningsDir, `${id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Return summary statistics: total count, count by tier, top categories, average confidence.
   */
  stats(): KnowledgeStats {
    const all = JsonStore.list(this.learningsDir, LearningSchema);

    const byTier = { stage: 0, category: 0, agent: 0 };
    const categoryCount = new Map<string, number>();
    let totalConfidence = 0;

    for (const learning of all) {
      byTier[learning.tier]++;
      totalConfidence += learning.confidence;

      const count = categoryCount.get(learning.category) ?? 0;
      categoryCount.set(learning.category, count + 1);
    }

    const topCategories = [...categoryCount.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    return {
      total: all.length,
      byTier,
      topCategories,
      averageConfidence: all.length > 0 ? totalConfidence / all.length : 0,
    };
  }

  /**
   * Expose the subscription manager for external subscription management.
   */
  get subscriptions(): SubscriptionManager {
    return this.subscriptionManager;
  }
}
