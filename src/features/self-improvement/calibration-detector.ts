import { randomUUID } from 'node:crypto';
import {
  readObservations,
  appendReflection,
  readReflections,
  type ObservationTarget,
} from '@infra/persistence/run-store.js';
import type { Observation } from '@domain/types/observation.js';
import type { Reflection } from '@domain/types/reflection.js';
import {
  CalibrationReflectionSchema,
  SynthesisReflectionSchema,
} from '@domain/types/reflection.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalibrationResult {
  biasesDetected: string[];
  calibrationsWritten: number;
  synthesisWritten: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIDENT_WORDS = new Set(['will', 'definitely', 'certainly', 'always', 'guaranteed']);

function hasConfidentLanguage(content: string): boolean {
  const words = content.toLowerCase().split(/\s+/);
  return words.some((w) => CONFIDENT_WORDS.has(w.replace(/[^a-z]/g, '')));
}

// ---------------------------------------------------------------------------
// CalibrationDetector
// ---------------------------------------------------------------------------

export class CalibrationDetector {
  constructor(private readonly runsDir: string) {}

  /**
   * Collect all observations from the run tree at all levels.
   */
  private collectAllObservations(runId: string): Observation[] {
    const all: Observation[] = [];
    const categories = ['research', 'plan', 'build', 'review'] as const;

    try {
      all.push(...readObservations(this.runsDir, runId, { level: 'run' }));
    } catch {
      // missing — ok
    }

    for (const category of categories) {
      try {
        all.push(...readObservations(this.runsDir, runId, { level: 'stage', category }));
      } catch {
        // missing — ok
      }
    }

    return all;
  }

  /**
   * Read all ValidationReflections from a run (run-level only).
   */
  private readValidations(runId: string): Array<Extract<Reflection, { type: 'validation' }>> {
    const reflections = readReflections(this.runsDir, runId, { level: 'run' });
    return reflections.filter(
      (r): r is Extract<Reflection, { type: 'validation' }> => r.type === 'validation',
    );
  }

  /**
   * Reads ValidationReflections from a run, detects systematic biases,
   * writes CalibrationReflections (and optionally a SynthesisReflection).
   */
  detect(runId: string): CalibrationResult {
    const runTarget: ObservationTarget = { level: 'run' };
    const validations = this.readValidations(runId);
    const allObservations = this.collectAllObservations(runId);

    const biasesDetected: string[] = [];
    const calibrationIds: string[] = [];
    const now = () => new Date().toISOString();

    // -------------------------------------------------------------------------
    // 1. Overconfidence
    // -------------------------------------------------------------------------
    if (validations.length >= 5) {
      const incorrectCount = validations.filter((v) => !v.correct).length;
      const incorrectRate = incorrectCount / validations.length;

      if (incorrectRate > 0.7) {
        // Check if >50% of prediction observations contain confident words
        const predictionObs = allObservations.filter((o) => o.type === 'prediction');
        const confidentPredictions = predictionObs.filter((p) => hasConfidentLanguage(p.content));
        const confidentRate = predictionObs.length > 0
          ? confidentPredictions.length / predictionObs.length
          : 0;

        if (confidentRate > 0.5) {
          const calibration = CalibrationReflectionSchema.parse({
            id: randomUUID(),
            timestamp: now(),
            observationIds: validations.map((v) => v.predictionId),
            type: 'calibration',
            domain: 'global',
            totalPredictions: validations.length,
            correctPredictions: validations.length - incorrectCount,
            accuracyRate: (validations.length - incorrectCount) / validations.length,
            bias: 'overconfidence',
          });
          appendReflection(this.runsDir, runId, calibration, runTarget);
          biasesDetected.push('overconfidence');
          calibrationIds.push(calibration.id);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 2. Estimation drift
    // -------------------------------------------------------------------------
    // Find predictions with quantitative fields
    const quantitativePredictions = allObservations.filter(
      (o): o is Extract<Observation, { type: 'prediction' }> =>
        o.type === 'prediction' && o.quantitative !== undefined,
    );

    if (quantitativePredictions.length >= 3) {
      // Map predictionId → validation result
      const validationById = new Map(validations.map((v) => [v.predictionId, v]));

      let missCount = 0;
      let matchedQuantCount = 0;

      for (const pred of quantitativePredictions) {
        const validation = validationById.get(pred.id);
        if (validation !== undefined) {
          matchedQuantCount++;
          if (!validation.correct) missCount++;
        }
      }

      const missRate = matchedQuantCount > 0 ? missCount / matchedQuantCount : 0;

      if (matchedQuantCount > 0 && missRate > 0.25) {
        const calibration = CalibrationReflectionSchema.parse({
          id: randomUUID(),
          timestamp: now(),
          observationIds: quantitativePredictions.map((p) => p.id),
          type: 'calibration',
          domain: 'quantitative',
          totalPredictions: matchedQuantCount,
          correctPredictions: matchedQuantCount - missCount,
          accuracyRate: (matchedQuantCount - missCount) / matchedQuantCount,
          bias: 'estimation-drift',
        });
        appendReflection(this.runsDir, runId, calibration, runTarget);
        biasesDetected.push('estimation-drift');
        calibrationIds.push(calibration.id);
      }
    }

    // -------------------------------------------------------------------------
    // 3. Predictor divergence
    // -------------------------------------------------------------------------
    const agentObservations = allObservations.filter(
      (o) => o.katakaId !== undefined && o.katakaId !== '',
    );

    if (agentObservations.length >= 8) {
      // Map predictionId → katakaId for prediction observations
      const predictionKatakaMap = new Map<string, string>();
      for (const obs of agentObservations) {
        if (obs.type === 'prediction' && obs.katakaId) {
          predictionKatakaMap.set(obs.id, obs.katakaId);
        }
      }

      // Group validations by the katakaId of the originating prediction
      const agentValidations = new Map<string, Array<Extract<Reflection, { type: 'validation' }>>>();
      for (const v of validations) {
        const katakaId = predictionKatakaMap.get(v.predictionId);
        if (katakaId) {
          const existing = agentValidations.get(katakaId) ?? [];
          existing.push(v);
          agentValidations.set(katakaId, existing);
        }
      }

      // Compute accuracy per agent
      const agentAccuracy = new Map<string, number>();
      for (const [agentId, agentVals] of agentValidations) {
        if (agentVals.length > 0) {
          const correctCount = agentVals.filter((v) => v.correct).length;
          agentAccuracy.set(agentId, correctCount / agentVals.length);
        }
      }

      if (agentAccuracy.size >= 2) {
        const accuracyValues = Array.from(agentAccuracy.entries());
        const maxAccuracy = Math.max(...accuracyValues.map(([, acc]) => acc));
        const minAccuracy = Math.min(...accuracyValues.map(([, acc]) => acc));

        if (maxAccuracy - minAccuracy > 0.4) {
          // Find lower-accuracy agent
          const [lowerAgentId] = accuracyValues.find(([, acc]) => acc === minAccuracy)!;
          const lowerValidations = agentValidations.get(lowerAgentId)!;

          const calibration = CalibrationReflectionSchema.parse({
            id: randomUUID(),
            timestamp: now(),
            observationIds: lowerValidations.map((v) => v.predictionId),
            type: 'calibration',
            domain: 'agent',
            katakaId: lowerAgentId,
            totalPredictions: lowerValidations.length,
            correctPredictions: lowerValidations.filter((v) => v.correct).length,
            accuracyRate: minAccuracy,
            bias: 'predictor-divergence',
          });
          appendReflection(this.runsDir, runId, calibration, runTarget);
          biasesDetected.push('predictor-divergence');
          calibrationIds.push(calibration.id);
        }
      }
    }

    // -------------------------------------------------------------------------
    // 4. Domain bias
    // -------------------------------------------------------------------------
    if (validations.length >= 5) {
      // Map predictionId → stage category (from observations)
      const categoryObservations = new Map<string, string>();
      for (const category of ['research', 'plan', 'build', 'review'] as const) {
        try {
          const stagePreds = readObservations(this.runsDir, runId, { level: 'stage', category });
          for (const obs of stagePreds) {
            if (obs.type === 'prediction') {
              categoryObservations.set(obs.id, category);
            }
          }
        } catch {
          // missing stage — ok
        }
      }

      // Group validations by category
      const categoryValidations = new Map<string, Array<Extract<Reflection, { type: 'validation' }>>>();
      for (const v of validations) {
        const cat = categoryObservations.get(v.predictionId);
        if (cat) {
          const existing = categoryValidations.get(cat) ?? [];
          existing.push(v);
          categoryValidations.set(cat, existing);
        }
      }

      if (categoryValidations.size >= 2) {
        const categoryAccuracy = new Map<string, number>();
        for (const [cat, catVals] of categoryValidations) {
          if (catVals.length > 0) {
            const correctCount = catVals.filter((v) => v.correct).length;
            categoryAccuracy.set(cat, correctCount / catVals.length);
          }
        }

        if (categoryAccuracy.size >= 2) {
          const accuracyValues = Array.from(categoryAccuracy.entries());
          const maxAccuracy = Math.max(...accuracyValues.map(([, acc]) => acc));
          const minAccuracy = Math.min(...accuracyValues.map(([, acc]) => acc));

          if (maxAccuracy - minAccuracy > 0.4) {
            const [lowerCat, lowerAcc] = accuracyValues.find(([, acc]) => acc === minAccuracy)!;
            const lowerValidations = categoryValidations.get(lowerCat)!;

            const calibration = CalibrationReflectionSchema.parse({
              id: randomUUID(),
              timestamp: now(),
              observationIds: lowerValidations.map((v) => v.predictionId),
              type: 'calibration',
              domain: lowerCat,
              totalPredictions: lowerValidations.length,
              correctPredictions: lowerValidations.filter((v) => v.correct).length,
              accuracyRate: lowerAcc,
              bias: 'domain-bias',
            });
            appendReflection(this.runsDir, runId, calibration, runTarget);
            biasesDetected.push('domain-bias');
            calibrationIds.push(calibration.id);
          }
        }
      }
    }

    // -------------------------------------------------------------------------
    // Synthesis — when 2+ calibrations written in this call
    // -------------------------------------------------------------------------
    let synthesisWritten = false;
    if (calibrationIds.length >= 2) {
      const synthesis = SynthesisReflectionSchema.parse({
        id: randomUUID(),
        timestamp: now(),
        observationIds: [],
        type: 'synthesis',
        sourceReflectionIds: calibrationIds,
        insight: 'Multiple calibration biases detected — review prediction discipline before next run',
      });
      appendReflection(this.runsDir, runId, synthesis, runTarget);
      synthesisWritten = true;
    }

    return {
      biasesDetected,
      calibrationsWritten: calibrationIds.length,
      synthesisWritten,
    };
  }
}
