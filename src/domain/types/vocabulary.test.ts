import { describe, it, expect } from 'vitest';
import { StageVocabularySchema, BoostRuleSchema } from './vocabulary.js';

describe('BoostRuleSchema', () => {
  it('parses a valid boost rule', () => {
    const result = BoostRuleSchema.parse({ artifactPattern: 'research', magnitude: 0.1 });
    expect(result.artifactPattern).toBe('research');
    expect(result.magnitude).toBe(0.1);
  });

  it('rejects empty artifact pattern', () => {
    expect(() => BoostRuleSchema.parse({ artifactPattern: '', magnitude: 0.1 })).toThrow();
  });

  it('rejects magnitude above 1', () => {
    expect(() => BoostRuleSchema.parse({ artifactPattern: 'test', magnitude: 1.5 })).toThrow();
  });

  it('rejects negative magnitude', () => {
    expect(() => BoostRuleSchema.parse({ artifactPattern: 'test', magnitude: -0.1 })).toThrow();
  });
});

describe('StageVocabularySchema', () => {
  const minimal = {
    category: 'build',
    keywords: ['typescript', 'implement'],
  };

  it('parses minimal vocabulary with defaults', () => {
    const result = StageVocabularySchema.parse(minimal);
    expect(result.category).toBe('build');
    expect(result.keywords).toEqual(['typescript', 'implement']);
    expect(result.boostRules).toEqual([]);
    expect(result.synthesisPreference).toBe('merge-all');
    expect(result.synthesisAlternatives).toEqual(['merge-all', 'first-wins', 'cascade']);
    expect(result.reasoningTemplate).toBeUndefined();
  });

  it('accepts all four valid categories', () => {
    for (const cat of ['research', 'plan', 'build', 'review']) {
      const result = StageVocabularySchema.parse({ ...minimal, category: cat });
      expect(result.category).toBe(cat);
    }
  });

  it('rejects wrapup category', () => {
    expect(() => StageVocabularySchema.parse({ ...minimal, category: 'wrapup' })).toThrow();
  });

  it('rejects unknown category', () => {
    expect(() => StageVocabularySchema.parse({ ...minimal, category: 'deploy' })).toThrow();
  });

  it('parses full vocabulary with all fields', () => {
    const result = StageVocabularySchema.parse({
      category: 'review',
      keywords: ['security', 'quality', 'audit'],
      boostRules: [
        { artifactPattern: 'build', magnitude: 0.1 },
        { artifactPattern: 'implementation', magnitude: 0.1 },
      ],
      synthesisPreference: 'cascade',
      synthesisAlternatives: ['merge-all', 'first-wins', 'cascade'],
      reasoningTemplate: 'Using cascade for {count} flavors.',
    });
    expect(result.synthesisPreference).toBe('cascade');
    expect(result.boostRules).toHaveLength(2);
    expect(result.reasoningTemplate).toContain('{count}');
  });

  it('accepts all valid synthesis preferences', () => {
    for (const pref of ['merge-all', 'cascade', 'first-wins'] as const) {
      const result = StageVocabularySchema.parse({ ...minimal, synthesisPreference: pref });
      expect(result.synthesisPreference).toBe(pref);
    }
  });

  it('rejects empty keywords array', () => {
    expect(() => StageVocabularySchema.parse({ ...minimal, keywords: [] })).toThrow();
  });

  it('rejects empty keyword string', () => {
    expect(() => StageVocabularySchema.parse({ ...minimal, keywords: [''] })).toThrow();
  });

  it('rejects invalid synthesis preference', () => {
    expect(() =>
      StageVocabularySchema.parse({ ...minimal, synthesisPreference: 'unknown' })
    ).toThrow();
  });
});
