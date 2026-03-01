import type { Bet } from '@domain/types/bet.js';
import type { DomainTags, DomainConfidenceScore } from '@domain/types/domain-tags.js';

/**
 * DomainConfidenceCalculator
 *
 * Computes a domain confidence score for a proposed bet based on historical outcomes
 * in matching domains.
 */

/**
 * Compute a DomainConfidenceScore for a bet with the given tags, using
 * historical bets to inform the score.
 *
 * Algorithm:
 * 1. Filter historicalBets to those with matching domain tags (same domain OR same language).
 * 2. familiarity = matching bets with outcome 'complete' / total matching (or 0 if none).
 * 3. historical = matching bets with outcome 'complete' or 'partial' / total matching (or 0).
 * 4. noveltyPenalty = experimental → 0.3, novel → 0.15, familiar/undefined → 0.
 * 5. risk = Math.min(1, (1 - familiarity) + noveltyPenalty).
 * 6. composite = (familiarity * 0.5) + (historical * 0.3) + ((1 - risk) * 0.2).
 * 7. sampleSize = count of matching bets.
 */
export function computeConfidence(
  currentTags: DomainTags,
  historicalBets: Bet[],
): DomainConfidenceScore {
  // 1. Filter to matching bets — same domain OR same language
  const matching = historicalBets.filter((bet) => {
    if (!bet.domainTags) return false;
    const sameDomain = currentTags.domain !== undefined && bet.domainTags.domain === currentTags.domain;
    const sameLanguage = currentTags.language !== undefined && bet.domainTags.language === currentTags.language;
    return sameDomain || sameLanguage;
  });

  const sampleSize = matching.length;

  // 2. familiarity
  const familiarity =
    sampleSize === 0
      ? 0
      : matching.filter((b) => b.outcome === 'complete').length / sampleSize;

  // 3. historical (complete or partial)
  const historical =
    sampleSize === 0
      ? 0
      : matching.filter((b) => b.outcome === 'complete' || b.outcome === 'partial').length / sampleSize;

  // 4. noveltyPenalty
  let noveltyPenalty = 0;
  if (currentTags.novelty === 'experimental') {
    noveltyPenalty = 0.3;
  } else if (currentTags.novelty === 'novel') {
    noveltyPenalty = 0.15;
  }

  // 5. risk
  const risk = Math.min(1, (1 - familiarity) + noveltyPenalty);

  // 6. composite
  const composite = (familiarity * 0.5) + (historical * 0.3) + ((1 - risk) * 0.2);

  return {
    familiarity,
    risk,
    historical,
    composite,
    sampleSize,
  };
}

/**
 * Generate a human-readable hint describing the confidence score.
 *
 * Examples:
 *   "High confidence (0.82) in typescript-js/web-frontend work based on 7 historical bets."
 *   "Low confidence (0.23) in rust/system-design — consider extra planning time."
 *   "No historical data for web-backend work — confidence score is based on novelty only."
 */
export function generatePromptHint(score: DomainConfidenceScore, tags: DomainTags): string {
  const tagParts: string[] = [];
  if (tags.language) tagParts.push(tags.language);
  if (tags.domain) tagParts.push(tags.domain);
  const tagLabel = tagParts.length > 0 ? tagParts.join('/') : 'this area';

  const compositeStr = score.composite.toFixed(2);

  if (score.sampleSize === 0) {
    return `No historical data for ${tagLabel} work — confidence score is based on novelty only.`;
  }

  const level = score.composite >= 0.6 ? 'High' : score.composite >= 0.35 ? 'Moderate' : 'Low';
  const betWord = score.sampleSize === 1 ? 'historical bet' : 'historical bets';

  if (level === 'Low') {
    return `Low confidence (${compositeStr}) in ${tagLabel} — consider extra planning time. Based on ${score.sampleSize} ${betWord}.`;
  }

  return `${level} confidence (${compositeStr}) in ${tagLabel} work based on ${score.sampleSize} ${betWord}.`;
}
