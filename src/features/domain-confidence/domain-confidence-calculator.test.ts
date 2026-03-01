import { computeConfidence, generatePromptHint } from './domain-confidence-calculator.js';
import type { Bet } from '@domain/types/bet.js';
import type { DomainTags, DomainConfidenceScore } from '@domain/types/domain-tags.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBet(
  overrides: Partial<Bet> & { outcome: Bet['outcome'] },
): Bet {
  return {
    id: crypto.randomUUID(),
    description: 'Test bet',
    appetite: 20,
    issueRefs: [],
    outcome: overrides.outcome,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// computeConfidence
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('returns all zeros with sampleSize 0 when no historical bets', () => {
    const tags: DomainTags = { domain: 'web-frontend', language: 'typescript-js' };
    const score = computeConfidence(tags, []);
    expect(score.sampleSize).toBe(0);
    expect(score.familiarity).toBe(0);
    expect(score.historical).toBe(0);
  });

  it('returns all zeros with sampleSize 0 when no bets match domain or language', () => {
    const tags: DomainTags = { domain: 'web-frontend', language: 'typescript-js' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'database', language: 'python' } }),
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(0);
    expect(score.familiarity).toBe(0);
  });

  it('matches bets by domain', () => {
    const tags: DomainTags = { domain: 'web-frontend' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'web-frontend' } }),
      makeBet({ outcome: 'partial', domainTags: { domain: 'web-frontend' } }),
      makeBet({ outcome: 'abandoned', domainTags: { domain: 'web-frontend' } }),
      makeBet({ outcome: 'complete', domainTags: { domain: 'database' } }), // no match
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(3);
  });

  it('matches bets by language (even if domain differs)', () => {
    const tags: DomainTags = { language: 'python' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'data-pipeline', language: 'python' } }),
      makeBet({ outcome: 'complete', domainTags: { domain: 'ml-inference', language: 'python' } }),
      makeBet({ outcome: 'complete', domainTags: { domain: 'web-backend', language: 'go' } }), // no match
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(2);
  });

  it('matches bets by EITHER domain OR language (union)', () => {
    const tags: DomainTags = { domain: 'web-frontend', language: 'typescript-js' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'web-frontend', language: 'python' } }), // domain match
      makeBet({ outcome: 'complete', domainTags: { domain: 'devops', language: 'typescript-js' } }), // language match
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(2);
  });

  it('computes familiarity as complete-only ratio', () => {
    const tags: DomainTags = { domain: 'security' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'security' } }),
      makeBet({ outcome: 'complete', domainTags: { domain: 'security' } }),
      makeBet({ outcome: 'partial', domainTags: { domain: 'security' } }),
      makeBet({ outcome: 'abandoned', domainTags: { domain: 'security' } }),
    ];
    const score = computeConfidence(tags, bets);
    // 2 complete out of 4
    expect(score.familiarity).toBeCloseTo(0.5);
  });

  it('computes historical as complete+partial ratio', () => {
    const tags: DomainTags = { domain: 'security' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'security' } }),
      makeBet({ outcome: 'partial', domainTags: { domain: 'security' } }),
      makeBet({ outcome: 'abandoned', domainTags: { domain: 'security' } }),
    ];
    const score = computeConfidence(tags, bets);
    // 2 (complete+partial) out of 3
    expect(score.historical).toBeCloseTo(2 / 3);
  });

  describe('novelty penalty', () => {
    it('applies 0.30 penalty for experimental novelty', () => {
      const tags: DomainTags = { domain: 'ml-inference', novelty: 'experimental' };
      const bets: Bet[] = [
        makeBet({ outcome: 'complete', domainTags: { domain: 'ml-inference' } }),
      ];
      const score = computeConfidence(tags, bets);
      // familiarity = 1.0
      // risk = min(1, (1 - 1.0) + 0.3) = 0.3
      expect(score.risk).toBeCloseTo(0.3);
    });

    it('applies 0.15 penalty for novel novelty', () => {
      const tags: DomainTags = { domain: 'ml-inference', novelty: 'novel' };
      const bets: Bet[] = [
        makeBet({ outcome: 'complete', domainTags: { domain: 'ml-inference' } }),
      ];
      const score = computeConfidence(tags, bets);
      // familiarity = 1.0, risk = min(1, 0 + 0.15) = 0.15
      expect(score.risk).toBeCloseTo(0.15);
    });

    it('applies 0 penalty for familiar novelty', () => {
      const tags: DomainTags = { domain: 'ml-inference', novelty: 'familiar' };
      const bets: Bet[] = [
        makeBet({ outcome: 'complete', domainTags: { domain: 'ml-inference' } }),
      ];
      const score = computeConfidence(tags, bets);
      // familiarity = 1.0, risk = min(1, 0 + 0) = 0
      expect(score.risk).toBeCloseTo(0);
    });

    it('applies 0 penalty when novelty is undefined', () => {
      const tags: DomainTags = { domain: 'ml-inference' };
      const bets: Bet[] = [
        makeBet({ outcome: 'complete', domainTags: { domain: 'ml-inference' } }),
      ];
      const score = computeConfidence(tags, bets);
      expect(score.risk).toBeCloseTo(0);
    });

    it('clamps risk to 1.0 when unfamiliarity + penalty exceeds 1', () => {
      const tags: DomainTags = { domain: 'devops', novelty: 'experimental' };
      const bets: Bet[] = [
        makeBet({ outcome: 'abandoned', domainTags: { domain: 'devops' } }),
      ];
      const score = computeConfidence(tags, bets);
      // familiarity = 0, risk = min(1, 1.0 + 0.3) = 1.0
      expect(score.risk).toBeCloseTo(1.0);
    });
  });

  describe('composite calculation', () => {
    it('computes composite as weighted average', () => {
      const tags: DomainTags = { domain: 'web-backend', novelty: 'familiar' };
      const bets: Bet[] = [
        makeBet({ outcome: 'complete', domainTags: { domain: 'web-backend' } }),
        makeBet({ outcome: 'complete', domainTags: { domain: 'web-backend' } }),
        makeBet({ outcome: 'partial', domainTags: { domain: 'web-backend' } }),
        makeBet({ outcome: 'partial', domainTags: { domain: 'web-backend' } }),
      ];
      const score = computeConfidence(tags, bets);
      // familiarity = 2/4 = 0.5, historical = 4/4 = 1.0
      // noveltyPenalty = 0, risk = min(1, 0.5 + 0) = 0.5
      // composite = 0.5*0.5 + 1.0*0.3 + (1-0.5)*0.2 = 0.25 + 0.30 + 0.10 = 0.65
      expect(score.familiarity).toBeCloseTo(0.5);
      expect(score.historical).toBeCloseTo(1.0);
      expect(score.risk).toBeCloseTo(0.5);
      expect(score.composite).toBeCloseTo(0.65);
    });

    it('returns composite 0 with no data and no novelty', () => {
      const tags: DomainTags = { domain: 'web-backend' };
      const score = computeConfidence(tags, []);
      // familiarity=0, historical=0, risk=min(1, 1+0)=1
      // composite = 0*0.5 + 0*0.3 + (1-1)*0.2 = 0
      expect(score.composite).toBeCloseTo(0);
    });

    it('composite is in [0,1] for all valid inputs', () => {
      const tags: DomainTags = { domain: 'rust' as never, language: 'rust', novelty: 'experimental' };
      const bets: Bet[] = Array.from({ length: 5 }, (_, i) =>
        makeBet({
          outcome: i < 3 ? 'complete' : 'abandoned',
          domainTags: { language: 'rust' },
        }),
      );
      const score = computeConfidence(tags, bets);
      expect(score.composite).toBeGreaterThanOrEqual(0);
      expect(score.composite).toBeLessThanOrEqual(1);
    });
  });

  it('ignores historical bets with no domainTags', () => {
    const tags: DomainTags = { domain: 'web-frontend' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete' }), // no domainTags
      makeBet({ outcome: 'complete', domainTags: { domain: 'web-frontend' } }),
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(1);
  });

  it('ignores bets where currentTags has no domain or language', () => {
    // If currentTags has neither domain nor language, nothing matches
    const tags: DomainTags = { scope: 'small', novelty: 'familiar' };
    const bets: Bet[] = [
      makeBet({ outcome: 'complete', domainTags: { domain: 'web-backend' } }),
    ];
    const score = computeConfidence(tags, bets);
    expect(score.sampleSize).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// generatePromptHint
// ---------------------------------------------------------------------------

describe('generatePromptHint', () => {
  const baseScore: DomainConfidenceScore = {
    familiarity: 0.82,
    risk: 0.18,
    historical: 0.90,
    composite: 0.82,
    sampleSize: 7,
  };

  it('produces high confidence hint with language and domain', () => {
    const tags: DomainTags = { language: 'typescript-js', domain: 'web-frontend' };
    const hint = generatePromptHint(baseScore, tags);
    expect(hint).toContain('High confidence');
    expect(hint).toContain('0.82');
    expect(hint).toContain('typescript-js/web-frontend');
    expect(hint).toContain('7');
  });

  it('produces low confidence hint', () => {
    const lowScore: DomainConfidenceScore = { ...baseScore, composite: 0.23, sampleSize: 3 };
    const tags: DomainTags = { language: 'rust', domain: 'system-design' };
    const hint = generatePromptHint(lowScore, tags);
    expect(hint).toContain('Low confidence');
    expect(hint).toContain('0.23');
    expect(hint).toContain('extra planning');
    expect(hint).toContain('3');
  });

  it('produces moderate confidence hint', () => {
    const moderateScore: DomainConfidenceScore = { ...baseScore, composite: 0.50, sampleSize: 2 };
    const tags: DomainTags = { domain: 'devops' };
    const hint = generatePromptHint(moderateScore, tags);
    expect(hint).toContain('Moderate confidence');
  });

  it('produces no-data hint when sampleSize is 0', () => {
    const noDataScore: DomainConfidenceScore = { ...baseScore, sampleSize: 0 };
    const tags: DomainTags = { domain: 'web-frontend' };
    const hint = generatePromptHint(noDataScore, tags);
    expect(hint).toContain('No historical data');
    expect(hint).toContain('novelty only');
  });

  it('uses "this area" when neither language nor domain is set', () => {
    const tags: DomainTags = { scope: 'small' };
    const hint = generatePromptHint(baseScore, tags);
    expect(hint).toContain('this area');
  });

  it('uses singular "historical bet" when sampleSize is 1', () => {
    const oneScore: DomainConfidenceScore = { ...baseScore, sampleSize: 1, composite: 0.70 };
    const tags: DomainTags = { domain: 'database' };
    const hint = generatePromptHint(oneScore, tags);
    expect(hint).toContain('1 historical bet');
    expect(hint).not.toContain('1 historical bets');
  });
});
