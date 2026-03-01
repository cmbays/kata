import {
  DomainArea,
  LanguageFamily,
  WorkType,
  WorkScope,
  WorkNovelty,
  DomainTagsSchema,
  DomainConfidenceScoreSchema,
} from './domain-tags.js';

// ---------------------------------------------------------------------------
// DomainArea
// ---------------------------------------------------------------------------

describe('DomainArea', () => {
  it('accepts all valid values', () => {
    const valid = [
      'web-backend', 'web-frontend', 'mobile-ios', 'mobile-android',
      'data-pipeline', 'ml-inference', 'devops', 'security',
      'database', 'api-design', 'developer-tooling', 'system-design',
      'testing', 'documentation', 'performance',
    ] as const;
    for (const v of valid) {
      expect(() => DomainArea.parse(v)).not.toThrow();
    }
  });

  it('rejects invalid values', () => {
    expect(() => DomainArea.parse('unknown-area')).toThrow();
    expect(() => DomainArea.parse('')).toThrow();
    expect(() => DomainArea.parse(123)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LanguageFamily
// ---------------------------------------------------------------------------

describe('LanguageFamily', () => {
  it('accepts all valid values', () => {
    const valid = [
      'typescript-js', 'python', 'rust', 'go', 'java-jvm',
      'csharp-dotnet', 'ruby', 'swift', 'kotlin', 'cpp',
      'haskell-fp', 'shell-scripting', 'sql',
    ] as const;
    for (const v of valid) {
      expect(() => LanguageFamily.parse(v)).not.toThrow();
    }
  });

  it('rejects invalid values', () => {
    expect(() => LanguageFamily.parse('javascript')).toThrow();
    expect(() => LanguageFamily.parse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkType
// ---------------------------------------------------------------------------

describe('WorkType', () => {
  it('accepts all valid values', () => {
    const valid = [
      'greenfield', 'legacy-migration', 'bug-fix', 'feature-addition',
      'refactor', 'optimization', 'integration', 'security-hardening',
      'compliance', 'documentation', 'research', 'prototype',
      'maintenance', 'incident-response',
    ] as const;
    for (const v of valid) {
      expect(() => WorkType.parse(v)).not.toThrow();
    }
  });

  it('rejects invalid values', () => {
    expect(() => WorkType.parse('new-feature')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkScope
// ---------------------------------------------------------------------------

describe('WorkScope', () => {
  it('accepts small, medium, large', () => {
    expect(() => WorkScope.parse('small')).not.toThrow();
    expect(() => WorkScope.parse('medium')).not.toThrow();
    expect(() => WorkScope.parse('large')).not.toThrow();
  });

  it('rejects invalid values', () => {
    expect(() => WorkScope.parse('xl')).toThrow();
    expect(() => WorkScope.parse('')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// WorkNovelty
// ---------------------------------------------------------------------------

describe('WorkNovelty', () => {
  it('accepts familiar, novel, experimental', () => {
    expect(() => WorkNovelty.parse('familiar')).not.toThrow();
    expect(() => WorkNovelty.parse('novel')).not.toThrow();
    expect(() => WorkNovelty.parse('experimental')).not.toThrow();
  });

  it('rejects invalid values', () => {
    expect(() => WorkNovelty.parse('unknown')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// DomainTagsSchema
// ---------------------------------------------------------------------------

describe('DomainTagsSchema', () => {
  it('accepts an empty object — all fields optional', () => {
    const result = DomainTagsSchema.parse({});
    expect(result).toEqual({});
  });

  it('accepts a fully populated object', () => {
    const result = DomainTagsSchema.parse({
      domain: 'web-frontend',
      language: 'typescript-js',
      framework: 'React',
      workType: 'feature-addition',
      scope: 'medium',
      novelty: 'familiar',
      source: 'user',
    });
    expect(result.domain).toBe('web-frontend');
    expect(result.language).toBe('typescript-js');
    expect(result.framework).toBe('React');
    expect(result.workType).toBe('feature-addition');
    expect(result.scope).toBe('medium');
    expect(result.novelty).toBe('familiar');
    expect(result.source).toBe('user');
  });

  it('accepts partial tags', () => {
    const result = DomainTagsSchema.parse({ domain: 'security', novelty: 'experimental' });
    expect(result.domain).toBe('security');
    expect(result.novelty).toBe('experimental');
    expect(result.language).toBeUndefined();
  });

  it('accepts all valid source values', () => {
    for (const source of ['user', 'auto-detected', 'llm-inferred'] as const) {
      const result = DomainTagsSchema.parse({ source });
      expect(result.source).toBe(source);
    }
  });

  it('rejects invalid domain value', () => {
    expect(() => DomainTagsSchema.parse({ domain: 'web-games' })).toThrow();
  });

  it('rejects invalid source value', () => {
    expect(() => DomainTagsSchema.parse({ source: 'human' })).toThrow();
  });

  it('accepts open-string framework', () => {
    const result = DomainTagsSchema.parse({ framework: 'Django' });
    expect(result.framework).toBe('Django');
  });
});

// ---------------------------------------------------------------------------
// DomainConfidenceScoreSchema
// ---------------------------------------------------------------------------

describe('DomainConfidenceScoreSchema', () => {
  const valid = {
    familiarity: 0.8,
    risk: 0.2,
    historical: 0.75,
    composite: 0.72,
    sampleSize: 10,
  };

  it('accepts a valid score', () => {
    expect(() => DomainConfidenceScoreSchema.parse(valid)).not.toThrow();
    const result = DomainConfidenceScoreSchema.parse(valid);
    expect(result.familiarity).toBe(0.8);
    expect(result.sampleSize).toBe(10);
  });

  it('accepts boundary values 0 and 1', () => {
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, familiarity: 0, risk: 0, historical: 0, composite: 0 })).not.toThrow();
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, familiarity: 1, risk: 1, historical: 1, composite: 1 })).not.toThrow();
  });

  it('rejects values out of [0,1] range', () => {
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, familiarity: 1.1 })).toThrow();
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, risk: -0.1 })).toThrow();
  });

  it('rejects non-integer sampleSize', () => {
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, sampleSize: 1.5 })).toThrow();
  });

  it('rejects negative sampleSize', () => {
    expect(() => DomainConfidenceScoreSchema.parse({ ...valid, sampleSize: -1 })).toThrow();
  });

  it('rejects missing required fields', () => {
    expect(() => DomainConfidenceScoreSchema.parse({ familiarity: 0.5 })).toThrow();
  });
});
