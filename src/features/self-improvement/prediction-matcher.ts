import { randomUUID } from 'node:crypto';
import {
  readObservations,
  appendReflection,
  readReflections,
  type ObservationTarget,
} from '@infra/persistence/run-store.js';
import type { Observation } from '@domain/types/observation.js';
import {
  ValidationReflectionSchema,
  UnmatchedReflectionSchema,
} from '@domain/types/reflection.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PredictionMatchResult {
  runId: string;
  matched: Array<{ predictionId: string; outcomeId: string; correct: boolean }>;
  unmatched: Array<{ predictionId: string; reason: string }>;
  reflectionsWritten: number;
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'will', 'it', 'this',
  'that', 'of', 'in', 'to', 'for', 'with', 'by',
]);

function extractKeywords(content: string): string[] {
  return content
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

function keywordOverlapRatio(predictionContent: string, outcomeContent: string): number {
  const keywords = extractKeywords(predictionContent);
  if (keywords.length === 0) return 0;
  const outcomeText = outcomeContent.toLowerCase();
  const matchCount = keywords.filter((kw) => outcomeText.includes(kw)).length;
  return matchCount / keywords.length;
}

// ---------------------------------------------------------------------------
// PredictionMatcher
// ---------------------------------------------------------------------------

export class PredictionMatcher {
  constructor(private readonly runsDir: string) {}

  /**
   * Collect all observations from the run tree at all levels.
   * Tries all 4 stage categories and known flavor/step patterns.
   * Missing paths return empty arrays (JsonlStore.readAll handles this).
   */
  private collectAllObservations(runId: string): Observation[] {
    const all: Observation[] = [];
    const categories = ['research', 'plan', 'build', 'review'] as const;

    // Run-level
    try {
      const runLevel = readObservations(this.runsDir, runId, { level: 'run' });
      all.push(...runLevel);
    } catch {
      // ignore missing
    }

    // Stage-level for each category
    for (const category of categories) {
      try {
        const stageObs = readObservations(this.runsDir, runId, { level: 'stage', category });
        all.push(...stageObs);
      } catch {
        // ignore missing stage dirs
      }
    }

    return all;
  }

  /**
   * Match prediction observations to outcome observations across a run.
   * Writes ValidationReflection for each match, UnmatchedReflection for each unmatched prediction.
   */
  match(runId: string): PredictionMatchResult {
    const observations = this.collectAllObservations(runId);

    const predictions = observations.filter((o) => o.type === 'prediction');
    const outcomes = observations.filter((o) => o.type === 'outcome');

    const matched: PredictionMatchResult['matched'] = [];
    const unmatched: PredictionMatchResult['unmatched'] = [];
    const usedOutcomeIds = new Set<string>();

    const runTarget: ObservationTarget = { level: 'run' };

    for (const prediction of predictions) {
      // Find best matching outcome (highest keyword overlap, not already used)
      let bestOutcome: Observation | null = null;
      let bestRatio = 0;

      for (const outcome of outcomes) {
        if (usedOutcomeIds.has(outcome.id)) continue;
        const ratio = keywordOverlapRatio(prediction.content, outcome.content);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          bestOutcome = outcome;
        }
      }

      const now = new Date().toISOString();

      if (bestOutcome !== null && bestRatio > 0) {
        // Match found (ratio > 0 means at least one keyword matched)
        const correct = bestRatio >= 0.6;
        usedOutcomeIds.add(bestOutcome.id);

        const validationReflection = ValidationReflectionSchema.parse({
          id: randomUUID(),
          timestamp: now,
          observationIds: [prediction.id, bestOutcome.id],
          type: 'validation',
          predictionId: prediction.id,
          outcomeId: bestOutcome.id,
          correct,
        });

        appendReflection(this.runsDir, runId, validationReflection, runTarget);

        matched.push({
          predictionId: prediction.id,
          outcomeId: bestOutcome.id,
          correct,
        });
      } else {
        // No matching outcome found
        const unmatchedReflection = UnmatchedReflectionSchema.parse({
          id: randomUUID(),
          timestamp: now,
          observationIds: [prediction.id],
          type: 'unmatched',
          predictionId: prediction.id,
          reason: 'no-outcome-found',
        });

        appendReflection(this.runsDir, runId, unmatchedReflection, runTarget);

        unmatched.push({
          predictionId: prediction.id,
          reason: 'no-outcome-found',
        });
      }
    }

    const reflectionsWritten = readReflections(this.runsDir, runId, runTarget).length;

    return {
      runId,
      matched,
      unmatched,
      reflectionsWritten,
    };
  }
}
