import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Learning } from '@domain/types/learning.js';
import type { Observation } from '@domain/types/observation.js';
import { PromotionEventSchema, type PromotionEvent } from '@domain/types/learning.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'will', 'it', 'this',
    'that', 'of', 'in', 'to', 'for', 'with', 'by', 'be', 'been', 'has', 'have', 'had',
    'not', 'but', 'and', 'or', 'so', 'if', 'as', 'at', 'on', 'from', 'into', 'about',
  ]);
  return new Set(
    text.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w)),
  );
}

function similarityScore(a: string, b: string): number {
  const kA = extractKeywords(a);
  const kB = extractKeywords(b);
  if (kA.size === 0 || kB.size === 0) return 0;
  let overlap = 0;
  for (const k of kA) if (kB.has(k)) overlap++;
  return overlap / Math.max(kA.size, kB.size);
}

/** Two items are "similar" when similarityScore >= 0.5 */
const SIMILARITY_THRESHOLD = 0.5;

/**
 * Group an array of items into clusters where all members are mutually similar
 * (pairwise similarity >= threshold) to at least one other cluster member.
 * Uses a greedy single-linkage approach: an item joins a cluster if it is
 * similar to any existing member.
 */
function clusterBySimilarity<T>(
  items: T[],
  getText: (item: T) => string,
): T[][] {
  const clusters: T[][] = [];

  for (const item of items) {
    let placed = false;
    for (const cluster of clusters) {
      const isClose = cluster.some(
        (c) => similarityScore(getText(c), getText(item)) >= SIMILARITY_THRESHOLD,
      );
      if (isClose) {
        cluster.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push([item]);
    }
  }

  return clusters;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PromotionSummary {
  stepLearningsCreated: number;
  flavorLearningsCreated: number;
  stageLearningsCreated: number;
  categoryLearningsCreated: number;
  promotionEvents: PromotionEvent[];
}

// ---------------------------------------------------------------------------
// HierarchicalPromoter
// ---------------------------------------------------------------------------

/**
 * Promotes learnings through the tier hierarchy:
 *   observation → step → flavor → stage → category
 *
 * Accepts IKnowledgeStore as a constructor dependency for testability.
 * Never modifies observation JSONL.
 */
export class HierarchicalPromoter {
  constructor(private readonly store: IKnowledgeStore) {}

  // ---- Tier 1: observations → step learnings --------------------------------

  /**
   * Scan a batch of observations for the same step and create step-tier learnings
   * for recurring patterns (3+ observations of the same type with high content
   * similarity).
   *
   * If an archived learning with similar content already exists, it is
   * resurrected instead of creating a duplicate (requires `store.resurrectedBy`).
   */
  promoteObservationsToStepLearnings(
    observations: Observation[],
    stepId: string,
  ): Learning[] {
    if (observations.length === 0) return [];

    const created: Learning[] = [];
    const now = new Date().toISOString();

    // Group by observation type
    const byType = new Map<string, Observation[]>();
    for (const obs of observations) {
      const list = byType.get(obs.type) ?? [];
      list.push(obs);
      byType.set(obs.type, list);
    }

    for (const [, typeGroup] of byType) {
      if (typeGroup.length < 3) continue;

      // Cluster observations within this type by content similarity
      const clusters = clusterBySimilarity(typeGroup, (o) => o.content);

      for (const cluster of clusters) {
        if (cluster.length < 3) continue;

        // Check if at least 3 pairs are similar (pairwise verification)
        let similarPairs = 0;
        for (let i = 0; i < cluster.length && similarPairs < 3; i++) {
          for (let j = i + 1; j < cluster.length; j++) {
            if (similarityScore(cluster[i]!.content, cluster[j]!.content) >= SIMILARITY_THRESHOLD) {
              similarPairs++;
            }
          }
        }
        if (similarPairs < 3) continue;

        // Representative observation — use the first one (cluster.length >= 3 is guaranteed above)
        const rep = cluster[0]!;
        const content = `Recurring pattern: ${rep.content}`;

        // Try to resurrect an archived learning with similar content
        let learning: Learning | undefined;

        const archivedCandidates = this.store.query({
          category: stepId,
          tier: 'step',
          includeArchived: true,
        }).filter((l) => l.archived && similarityScore(l.content, content) >= SIMILARITY_THRESHOLD);

        if (archivedCandidates.length > 0) {
          learning = this.store.resurrectedBy(archivedCandidates[0]!.id, rep.id, now);
        } else {
          learning = this.store.capture({
            tier: 'step',
            category: stepId,
            content,
            confidence: 0.6,
            source: 'extracted',
          });
        }

        created.push(learning);
      }
    }

    return created;
  }

  // ---- Tier 2: step learnings → flavor learnings ---------------------------

  /**
   * Promote step-tier learnings to a flavor-tier learning when 3+ learnings
   * from *different* step IDs (category field) share similar content.
   */
  promoteStepToFlavor(
    stepLearnings: Learning[],
    flavorId: string,
  ): { learnings: Learning[]; events: PromotionEvent[] } {
    return this.promoteByTier(
      stepLearnings,
      'flavor',
      flavorId,
      3,
      0.7,
      (l) => l.category, // uniqueness key: step ID stored in category
    );
  }

  // ---- Tier 3: flavor learnings → stage learnings --------------------------

  /**
   * Promote flavor-tier learnings to a stage-tier learning when 2+ learnings
   * from *different* flavor IDs share similar content.
   */
  promoteFlavorToStage(
    flavorLearnings: Learning[],
    stageCategory: string,
  ): { learnings: Learning[]; events: PromotionEvent[] } {
    return this.promoteByTier(
      flavorLearnings,
      'stage',
      stageCategory,
      2,
      0.75,
      (l) => l.category, // uniqueness key: flavor ID stored in category
    );
  }

  // ---- Tier 4: stage learnings → category learnings ------------------------

  /**
   * Promote stage-tier learnings to a category-tier learning when 2+ learnings
   * from *different* stage categories share similar content.
   */
  promoteStageToCategory(
    stageLearnings: Learning[],
  ): { learnings: Learning[]; events: PromotionEvent[] } {
    return this.promoteByTier(
      stageLearnings,
      'category',
      'cross-stage',
      2,
      0.8,
      (l) => l.category, // uniqueness key: stage category stored in category
    );
  }

  // ---- Shared promotion logic -----------------------------------------------

  private promoteByTier(
    sourceLearnings: Learning[],
    toTier: 'flavor' | 'stage' | 'category',
    newCategory: string,
    minClusterSize: number,
    confidence: number,
    getUniqueKey: (l: Learning) => string,
  ): { learnings: Learning[]; events: PromotionEvent[] } {
    const newLearnings: Learning[] = [];
    const events: PromotionEvent[] = [];

    if (sourceLearnings.length < minClusterSize) {
      return { learnings: newLearnings, events };
    }

    const clusters = clusterBySimilarity(sourceLearnings, (l) => l.content);

    for (const cluster of clusters) {
      if (cluster.length < minClusterSize) continue;

      // Require members from distinct source IDs (step IDs, flavor IDs, etc.)
      const distinctKeys = new Set(cluster.map(getUniqueKey));
      if (distinctKeys.size < minClusterSize) continue;

      // Summarize: use the longest content string from the cluster
      const summary = cluster.reduce(
        (longest, l) => (l.content.length > longest.length ? l.content : longest),
        '',
      );

      const newLearning = this.store.capture({
        tier: toTier,
        category: newCategory,
        content: summary,
        confidence,
        source: 'extracted',
      });

      newLearnings.push(newLearning);

      // Create a PromotionEvent for each source learning in the cluster
      for (const sourceLearning of cluster) {
        const event = PromotionEventSchema.parse({
          id: crypto.randomUUID(),
          fromLearningId: sourceLearning.id,
          toLearningId: newLearning.id,
          fromTier: sourceLearning.tier,
          toTier: newLearning.tier,
          promotedAt: new Date().toISOString(),
          evidenceCount: cluster.length,
          reason: `${cluster.length} similar ${sourceLearning.tier}-tier learnings promoted`,
        });
        events.push(event);
      }
    }

    return { learnings: newLearnings, events };
  }
}
