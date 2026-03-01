import type { SynthesisDepth } from '@domain/types/synthesis.js';
import type { SynthesisInput } from '@domain/types/synthesis.js';
import type { Observation } from '@domain/types/observation.js';
import type { Learning } from '@domain/types/learning.js';

/**
 * Result of filtering synthesis input data.
 */
export interface FilteredSynthesisData {
  observations: Observation[];
  learnings: Learning[];
}

/**
 * filterForSynthesis — pure function, no LLM involved.
 *
 * Applies depth-based filtering rules to the synthesis input:
 * - 'quick':    top 10 observations by recency; learnings with confidence > 0.5; excludes archived
 * - 'standard': all observations; learnings with confidence > 0.3; excludes archived
 * - 'thorough': all observations; all learnings including archived
 */
export function filterForSynthesis(input: SynthesisInput): FilteredSynthesisData {
  const depth: SynthesisDepth = input.depth;

  switch (depth) {
    case 'quick':
      return filterQuick(input.observations, input.learnings);
    case 'standard':
      return filterStandard(input.observations, input.learnings);
    case 'thorough':
      return filterThorough(input.observations, input.learnings);
  }
}

/**
 * Quick depth: top 10 observations by recency, learnings with confidence > 0.5, no archived.
 */
function filterQuick(observations: Observation[], learnings: Learning[]): FilteredSynthesisData {
  // Sort by timestamp descending (most recent first), take top 10
  const sortedObs = [...observations].sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return tb - ta;
  });
  const filteredObs = sortedObs.slice(0, 10);

  // Exclude archived and require confidence > 0.5
  const filteredLearnings = learnings.filter(
    (l) => !l.archived && l.confidence > 0.5,
  );

  return { observations: filteredObs, learnings: filteredLearnings };
}

/**
 * Standard depth: all observations, learnings with confidence > 0.3, no archived.
 */
function filterStandard(observations: Observation[], learnings: Learning[]): FilteredSynthesisData {
  const filteredLearnings = learnings.filter(
    (l) => !l.archived && l.confidence > 0.3,
  );

  return { observations, learnings: filteredLearnings };
}

/**
 * Thorough depth: all observations including archived learnings.
 */
function filterThorough(observations: Observation[], learnings: Learning[]): FilteredSynthesisData {
  // All observations, all learnings (including archived)
  return { observations, learnings };
}
