import { join } from 'node:path';
import { LearningSchema } from '@domain/types/learning.js';
import type { Learning, LearningFilter, LearningInput, LearningPermanence, LearningTier } from '@domain/types/learning.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { logger } from '@shared/lib/logger.js';
import { SubscriptionManager } from './subscription-manager.js';

// Re-export KnowledgeStats from the domain port for backward compatibility
import type { KnowledgeStats } from '@domain/ports/knowledge-store.js';
export type { KnowledgeStats } from '@domain/ports/knowledge-store.js';

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
    learning: Omit<LearningInput, 'id' | 'createdAt' | 'updatedAt'>,
  ): Learning {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const validated = LearningSchema.parse({ ...learning, id, createdAt: now, updatedAt: now });

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
   * By default, archived learnings are excluded. Set `includeArchived: true` to include them.
   */
  query(filter: LearningFilter): Learning[] {
    const all = JsonStore.list(this.learningsDir, LearningSchema);

    return all.filter((learning) => {
      if (!filter.includeArchived && learning.archived) return false;
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
      if (filter.permanence !== undefined && learning.permanence !== filter.permanence) {
        return false;
      }
      if (filter.source !== undefined && learning.source !== filter.source) {
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
   * Step-tier (waza): return all learnings where tier='step' and category=stepId and !archived.
   */
  loadForStep(stepId: string): Learning[] {
    return this.query({ tier: 'step', category: stepId });
  }

  /**
   * Flavor-tier (ryu): return all learnings where tier='flavor' and category=flavorId and !archived.
   */
  loadForFlavor(flavorId: string): Learning[] {
    return this.query({ tier: 'flavor', category: flavorId });
  }

  /**
   * Soft-delete a learning by setting archived=true.
   * Pushes current state snapshot to versions[] before archiving.
   * Constitutional learnings CAN be archived (but not content-modified).
   * Idempotent: if already archived, returns the learning unchanged.
   */
  archiveLearning(id: string, reason?: string): Learning {
    const existing = this.get(id);

    if (existing.archived) {
      return existing;
    }

    const now = new Date().toISOString();

    const versionSnapshot = {
      content: existing.content,
      confidence: existing.confidence,
      updatedAt: now,
      changeReason: reason ?? 'archived',
    };

    const updated: Learning = {
      ...existing,
      archived: true,
      updatedAt: now,
      versions: [...(existing.versions ?? []), versionSnapshot],
    };

    const validated = LearningSchema.parse(updated);
    const filePath = join(this.learningsDir, `${id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Un-archive a learning (resurrection) and record the resurrection observation as a new citation.
   * Pushes current state snapshot to versions[] with changeReason='resurrected'.
   */
  resurrectedBy(id: string, observationId: string, citedAt: string): Learning {
    const existing = this.get(id);
    const now = new Date().toISOString();

    const versionSnapshot = {
      content: existing.content,
      confidence: existing.confidence,
      updatedAt: now,
      changeReason: 'resurrected',
    };

    const newCitation = { observationId, path: undefined, citedAt };

    const updated: Learning = {
      ...existing,
      archived: false,
      updatedAt: now,
      versions: [...(existing.versions ?? []), versionSnapshot],
      citations: [...(existing.citations ?? []), newCitation],
    };

    const validated = LearningSchema.parse(updated);
    const filePath = join(this.learningsDir, `${id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Promote a learning to a higher permanence tier.
   * Tier order (ascending): operational < strategic < constitutional.
   * Downgrades and changes to/from constitutional are rejected.
   * When promoting to strategic: sets refreshBy to 90 days from now, clears expiresAt.
   * When promoting to constitutional: clears both refreshBy and expiresAt.
   */
  promote(id: string, toPermanence: LearningPermanence): Learning {
    const existing = this.get(id);

    if (existing.permanence === 'constitutional') {
      throw new Error('INVALID_PROMOTION: Cannot change permanence of a constitutional learning');
    }

    const tierOrder: Record<LearningPermanence, number> = {
      operational: 0,
      strategic: 1,
      constitutional: 2,
    };

    const currentTier = existing.permanence !== undefined ? tierOrder[existing.permanence] : -1;
    const targetTier = tierOrder[toPermanence];

    if (currentTier !== -1 && targetTier < currentTier) {
      throw new Error('INVALID_PROMOTION: Downgrade not allowed — archive and create a new learning instead');
    }

    const now = new Date().toISOString();

    const versionSnapshot = {
      content: existing.content,
      confidence: existing.confidence,
      updatedAt: now,
      changeReason: 'promoted',
    };

    let refreshBy: string | undefined = existing.refreshBy;
    let expiresAt: string | undefined = existing.expiresAt;

    if (toPermanence === 'strategic') {
      const ninetyDaysFromNow = new Date();
      ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);
      refreshBy = ninetyDaysFromNow.toISOString();
      expiresAt = undefined;
    } else if (toPermanence === 'constitutional') {
      refreshBy = undefined;
      expiresAt = undefined;
    }

    const updated: Learning = {
      ...existing,
      permanence: toPermanence,
      refreshBy,
      expiresAt,
      updatedAt: now,
      versions: [...(existing.versions ?? []), versionSnapshot],
    };

    const validated = LearningSchema.parse(updated);
    const filePath = join(this.learningsDir, `${id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Promote a learning to a higher tier in the learning hierarchy.
   * Tier order (ascending): step < flavor < stage < category < agent.
   * Downgrades are rejected.
   * Pushes current state snapshot to versions[] with changeReason='tier-promoted'.
   * Returns the updated Learning.
   */
  promoteTier(id: string, toTier: LearningTier, newCategory?: string): Learning {
    const existing = this.get(id);

    const tierOrder: Record<LearningTier, number> = {
      step: 0,
      flavor: 1,
      stage: 2,
      category: 3,
      agent: 4,
    };

    const currentTierRank = tierOrder[existing.tier];
    const targetTierRank = tierOrder[toTier];

    if (targetTierRank <= currentTierRank) {
      throw new Error(
        `INVALID_TIER_PROMOTION: Cannot promote from tier "${existing.tier}" to "${toTier}". Target tier must be higher in the hierarchy (step < flavor < stage < category < agent).`,
      );
    }

    const now = new Date().toISOString();

    const versionSnapshot = {
      content: existing.content,
      confidence: existing.confidence,
      updatedAt: now,
      changeReason: 'tier-promoted',
    };

    const updated: Learning = {
      ...existing,
      tier: toTier,
      ...(newCategory !== undefined ? { category: newCategory } : {}),
      updatedAt: now,
      versions: [...(existing.versions ?? []), versionSnapshot],
    };

    const validated = LearningSchema.parse(updated);
    const filePath = join(this.learningsDir, `${id}.json`);
    JsonStore.write(filePath, validated, LearningSchema);

    return validated;
  }

  /**
   * Pure function: compute confidence with time-based decay applied.
   * Constitutional learnings: no decay.
   * Operational: 50% decay per 30 days.
   * Strategic: 20% decay per 90 days.
   * Undefined permanence: 30% decay per 60 days.
   * Reference date: lastUsedAt ?? createdAt.
   */
  computeDecayedConfidence(learning: Learning): number {
    if (learning.permanence === 'constitutional') {
      return learning.confidence;
    }

    const referenceDate = new Date(learning.lastUsedAt ?? learning.createdAt);
    const now = new Date();
    const daysElapsed = (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);

    let decayRate: number;
    let decayWindow: number;

    if (learning.permanence === 'operational') {
      decayRate = 0.5;
      decayWindow = 30;
    } else if (learning.permanence === 'strategic') {
      decayRate = 0.2;
      decayWindow = 90;
    } else {
      // undefined permanence
      decayRate = 0.3;
      decayWindow = 60;
    }

    const decayed = learning.confidence * Math.max(0, 1 - (decayRate * daysElapsed / decayWindow));
    return Math.min(1, Math.max(0, decayed));
  }

  /**
   * Scan all learnings (including archived) and:
   * - Auto-archive expired operational learnings (expiresAt < now).
   * - Flag stale strategic learnings (refreshBy < now) without archiving.
   * Returns lists of archived and flaggedStale learnings.
   */
  checkExpiry(now: Date = new Date()): { archived: Learning[]; flaggedStale: Learning[] } {
    const all = JsonStore.list(this.learningsDir, LearningSchema);
    const archived: Learning[] = [];
    const flaggedStale: Learning[] = [];

    for (const learning of all) {
      if (
        learning.permanence === 'operational' &&
        learning.expiresAt !== undefined &&
        new Date(learning.expiresAt) < now &&
        !learning.archived
      ) {
        try {
          const archivedLearning = this.archiveLearning(learning.id, 'ttl-expired');
          archived.push(archivedLearning);
        } catch (err) {
          logger.warn(`Failed to auto-archive expired learning ${learning.id}`, {
            id: learning.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else if (
        learning.permanence === 'strategic' &&
        learning.refreshBy !== undefined &&
        new Date(learning.refreshBy) < now &&
        !learning.archived
      ) {
        flaggedStale.push(learning);
      }
    }

    return { archived, flaggedStale };
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

    const byTier = { step: 0, flavor: 0, stage: 0, category: 0, agent: 0 };
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
