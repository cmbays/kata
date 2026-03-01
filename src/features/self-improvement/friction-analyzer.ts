import { randomUUID } from 'node:crypto';
import {
  readObservations,
  appendReflection,
} from '@infra/persistence/run-store.js';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Learning } from '@domain/types/learning.js';
import type { Observation } from '@domain/types/observation.js';
import type { FrictionTaxonomy } from '@domain/types/observation.js';
import { ResolutionReflectionSchema } from '@domain/types/reflection.js';
import type { FrictionResolutionPath as FrictionResolutionPathType } from '@domain/types/reflection.js';

// ---------------------------------------------------------------------------
// Exported result types
// ---------------------------------------------------------------------------

export interface FrictionResolutionResult {
  frictionId: string;
  taxonomy: FrictionTaxonomy;
  path: FrictionResolutionPathType;
  diagnosticConfidence: number;
  summary: string;
  learningAffected?: string;
}

export interface FrictionAnalysisResult {
  runId: string;
  frictionCount: number;
  totalObservations: number;
  overrideThresholdMet: boolean;
  resolutions: FrictionResolutionResult[];
  reflectionsWritten: number;
}

// ---------------------------------------------------------------------------
// Keyword overlap helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'will', 'it', 'this',
  'that', 'of', 'in', 'to', 'for', 'with', 'by',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

function keywordOverlapRatio(a: string, b: string): number {
  const kw = extractKeywords(a);
  if (kw.length === 0) return 0;
  const bLower = b.toLowerCase();
  return kw.filter((k) => bLower.includes(k)).length / kw.length;
}

// ---------------------------------------------------------------------------
// FrictionAnalyzer
// ---------------------------------------------------------------------------

/**
 * FrictionAnalyzer — Workstream B of Wave H Intelligence.
 *
 * Scans all friction observations in a run and, when the override threshold is
 * met (3+ frictions OR friction rate > 30%), resolves each friction via one of
 * four paths:
 *  - invalidate: archive the contradicted learning
 *  - scope: archive old learning + capture a narrowed version
 *  - synthesize: capture a new learning combining friction + contradicted learning
 *  - escalate: write reflection only — no store mutation
 *
 * All resolutions are recorded as ResolutionReflections at the run level.
 */
export class FrictionAnalyzer {
  constructor(
    private readonly runsDir: string,
    private readonly store: IKnowledgeStore,
  ) {}

  // -------------------------------------------------------------------------
  // Private: observation collection
  // -------------------------------------------------------------------------

  private collectAllObservations(runId: string): Observation[] {
    const all: Observation[] = [];
    const categories = ['research', 'plan', 'build', 'review'] as const;

    // Run-level
    try {
      all.push(...readObservations(this.runsDir, runId, { level: 'run' }));
    } catch (err: unknown) {
      if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
        throw err;
      }
    }

    // Stage-level for each category
    for (const category of categories) {
      try {
        all.push(...readObservations(this.runsDir, runId, { level: 'stage', category }));
      } catch (err: unknown) {
        if (!(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')) {
          throw err;
        }
      }
    }

    return all;
  }

  // -------------------------------------------------------------------------
  // Private: diagnostic confidence
  // -------------------------------------------------------------------------

  private computeDiagnosticConfidence(
    friction: Observation & { type: 'friction' },
    taxonomyCounts: Map<FrictionTaxonomy, number>,
    activeLearnings: Learning[],
  ): number {
    let confidence = 0.5;

    const { contradicts } = friction;

    if (contradicts) {
      const contradicted = activeLearnings.find((l) => l.id === contradicts);
      if (contradicted) {
        confidence += 0.2; // +0.2 for known learning
        if (contradicted.permanence === 'operational') {
          confidence += 0.1; // +0.1 for operational permanence
        }
        if (keywordOverlapRatio(friction.content, contradicted.content) > 0.6) {
          confidence += 0.1; // +0.1 for content overlap
        }
      }
    }

    // +0.1 if same taxonomy appeared 3+ times
    const count = taxonomyCounts.get(friction.taxonomy) ?? 0;
    if (count >= 3) {
      confidence += 0.1;
    }

    return Math.min(1, Math.max(0, confidence));
  }

  // -------------------------------------------------------------------------
  // Private: path selection
  // -------------------------------------------------------------------------

  private selectPath(
    confidence: number,
    hasContradicts: boolean,
  ): FrictionResolutionPathType {
    if (!hasContradicts) return 'escalate';
    if (confidence >= 0.8) return 'invalidate';
    if (confidence >= 0.7) return 'scope';
    if (confidence >= 0.6) return 'synthesize';
    return 'escalate';
  }

  // -------------------------------------------------------------------------
  // Private: resolve and record
  // -------------------------------------------------------------------------

  private resolveAndRecord(
    runId: string,
    friction: Observation & { type: 'friction' },
    contradicts: string | undefined,
    path: FrictionResolutionPathType,
    diagnosticConfidence: number,
    activeLearnings: Learning[],
  ): FrictionResolutionResult {
    let summary: string;
    let learningAffected: string | undefined;

    switch (path) {
      case 'invalidate': {
        // Archive the contradicted learning
        if (contradicts) {
          this.store.archiveLearning(contradicts, 'friction-invalidated');
          summary = `Archived learning "${contradicts}" (invalidated by friction: ${friction.content.slice(0, 60)})`;
          learningAffected = contradicts;
        } else {
          summary = `Friction escalated for user review: ${friction.content.slice(0, 80)}`;
        }
        break;
      }

      case 'scope': {
        // Archive old learning + capture a narrowed version
        if (contradicts) {
          const existing = activeLearnings.find((l) => l.id === contradicts);
          if (existing) {
            // Archive the old learning
            this.store.archiveLearning(contradicts, 'scoped');
            // Create a new learning with narrowed content
            const newContent = existing.content.startsWith('In most cases:')
              ? existing.content
              : `In most cases: ${existing.content}`;
            const newLearning = this.store.capture({
              tier: existing.tier,
              category: existing.category,
              content: newContent,
              confidence: existing.confidence,
              source: 'extracted',
              derivedFrom: [friction.id, contradicts],
            });
            summary = `Scoped learning "${contradicts}" to add qualifier (narrowed by friction)`;
            learningAffected = newLearning.id;
          } else {
            summary = `Friction escalated for user review (contradicted learning not found): ${friction.content.slice(0, 60)}`;
          }
        } else {
          summary = `Friction escalated for user review: ${friction.content.slice(0, 80)}`;
        }
        break;
      }

      case 'synthesize': {
        // Create a new learning combining friction + contradicted learning
        const existing = contradicts
          ? activeLearnings.find((l) => l.id === contradicts)
          : undefined;
        const newContent = existing
          ? `Synthesized: ${friction.content} (reconciled with: ${existing.content.slice(0, 60)})`
          : `Synthesized from friction: ${friction.content}`;
        const derivedFrom: string[] = [friction.id, ...(contradicts ? [contradicts] : [])];
        const newLearning = this.store.capture({
          tier: existing?.tier ?? 'category',
          category: existing?.category ?? 'friction-synthesis',
          content: newContent,
          confidence: 0.6,
          source: 'extracted',
          derivedFrom,
        });
        summary = `Synthesized new learning from friction + contradicted learning`;
        learningAffected = newLearning.id;
        break;
      }

      case 'escalate': {
        // No store mutation — just write reflection for user review
        summary = `Friction escalated for user review: ${friction.content.slice(0, 80)}`;
        break;
      }
    }

    // Write ResolutionReflection
    const resolutionReflection = ResolutionReflectionSchema.parse({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      observationIds: [friction.id],
      type: 'resolution',
      frictionId: friction.id,
      path,
      summary,
    });
    appendReflection(this.runsDir, runId, resolutionReflection, { level: 'run' });

    return {
      frictionId: friction.id,
      taxonomy: friction.taxonomy,
      path,
      diagnosticConfidence,
      summary,
      ...(learningAffected !== undefined ? { learningAffected } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Public: analyze
  // -------------------------------------------------------------------------

  /**
   * Analyze a run's friction observations and attempt resolutions when the
   * override threshold is met.
   *
   * Threshold: 3+ friction observations OR friction rate > 30%.
   */
  analyze(runId: string): FrictionAnalysisResult {
    const observations = this.collectAllObservations(runId);
    const frictions = observations.filter(
      (o): o is Observation & { type: 'friction' } => o.type === 'friction',
    );

    const frictionCount = frictions.length;
    const totalObservations = observations.length;

    const countThreshold = frictionCount >= 3;
    const rateThreshold = totalObservations > 0 && frictionCount / totalObservations > 0.3;
    const overrideThresholdMet = countThreshold || rateThreshold;

    const resolutions: FrictionResolutionResult[] = [];

    if (overrideThresholdMet) {
      // Load learnings once to avoid repeated store scans (HIGH-2)
      const activeLearnings = this.store.query({ includeArchived: false });

      // Build taxonomy count map
      const taxonomyCounts = new Map<FrictionTaxonomy, number>();
      for (const f of frictions) {
        taxonomyCounts.set(f.taxonomy, (taxonomyCounts.get(f.taxonomy) ?? 0) + 1);
      }

      // Track already-processed learning IDs to prevent duplicate archive calls (WARN-3)
      const processedLearnings = new Set<string>();

      for (const friction of frictions) {
        const { contradicts } = friction;

        // Skip redundant archive/scope ops for the same learning (WARN-3)
        if (contradicts && processedLearnings.has(contradicts)) {
          continue;
        }
        if (contradicts) processedLearnings.add(contradicts);

        const diagnosticConfidence = this.computeDiagnosticConfidence(friction, taxonomyCounts, activeLearnings);
        const path = this.selectPath(diagnosticConfidence, !!contradicts);

        const result = this.resolveAndRecord(runId, friction, contradicts, path, diagnosticConfidence, activeLearnings);
        resolutions.push(result);
      }
    }

    return {
      runId,
      frictionCount,
      totalObservations,
      overrideThresholdMet,
      resolutions,
      reflectionsWritten: resolutions.length,
    };
  }
}
