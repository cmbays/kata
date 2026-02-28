import {
  DojoDiaryEntrySchema,
  DojoTopicSchema,
  DojoContentSectionSchema,
  DojoSourceSchema,
  DojoSourceRegistrySchema,
  DojoSessionSchema,
  DojoSessionMetaSchema,
  DojoSessionIndexSchema,
  DojoMood,
  DojoDirection,
  DojoPriority,
  DojoSectionType,
  DojoSourceReputation,
} from './dojo.js';

// ── Enums ────────────────────────────────────────────────────────────────────

describe('DojoMood', () => {
  it('accepts valid moods', () => {
    for (const mood of ['energized', 'steady', 'frustrated', 'reflective', 'uncertain']) {
      expect(DojoMood.parse(mood)).toBe(mood);
    }
  });
  it('rejects invalid mood', () => {
    expect(() => DojoMood.parse('bored')).toThrow();
  });
});

describe('DojoDirection', () => {
  it('accepts valid directions', () => {
    for (const d of ['backward', 'inward', 'outward', 'forward']) {
      expect(DojoDirection.parse(d)).toBe(d);
    }
  });
  it('rejects invalid direction', () => {
    expect(() => DojoDirection.parse('sideways')).toThrow();
  });
});

describe('DojoPriority', () => {
  it('accepts valid priorities', () => {
    for (const p of ['high', 'medium', 'low']) {
      expect(DojoPriority.parse(p)).toBe(p);
    }
  });
});

describe('DojoSectionType', () => {
  it('accepts all section types', () => {
    const types = ['narrative', 'checklist', 'comparison', 'timeline', 'diagram', 'chart', 'code', 'quiz', 'reference'];
    for (const t of types) {
      expect(DojoSectionType.parse(t)).toBe(t);
    }
  });
});

describe('DojoSourceReputation', () => {
  it('accepts valid reputations', () => {
    for (const r of ['official', 'authoritative', 'community', 'experimental']) {
      expect(DojoSourceReputation.parse(r)).toBe(r);
    }
  });
});

// ── DojoDiaryEntrySchema ─────────────────────────────────────────────────────

describe('DojoDiaryEntrySchema', () => {
  const validEntry = {
    id: crypto.randomUUID(),
    cycleId: crypto.randomUUID(),
    narrative: 'This cycle was productive. We shipped the auth feature.',
    createdAt: new Date().toISOString(),
  };

  it('parses minimal valid entry with defaults', () => {
    const result = DojoDiaryEntrySchema.parse(validEntry);
    expect(result.id).toBe(validEntry.id);
    expect(result.wins).toEqual([]);
    expect(result.painPoints).toEqual([]);
    expect(result.openQuestions).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.mood).toBeUndefined();
    expect(result.cycleName).toBeUndefined();
  });

  it('parses full entry with all optional fields', () => {
    const full = {
      ...validEntry,
      cycleName: 'Sprint 4',
      wins: ['Shipped auth', 'Fixed CI'],
      painPoints: ['Flaky tests', 'Slow builds'],
      openQuestions: ['Should we migrate to Bun?'],
      mood: 'energized' as const,
      tags: ['auth', 'ci'],
    };
    const result = DojoDiaryEntrySchema.parse(full);
    expect(result.cycleName).toBe('Sprint 4');
    expect(result.wins).toHaveLength(2);
    expect(result.mood).toBe('energized');
    expect(result.tags).toEqual(['auth', 'ci']);
  });

  it('rejects missing narrative', () => {
    const { narrative: _, ...noNarrative } = validEntry;
    expect(() => DojoDiaryEntrySchema.parse(noNarrative)).toThrow();
  });

  it('rejects empty narrative', () => {
    expect(() => DojoDiaryEntrySchema.parse({ ...validEntry, narrative: '' })).toThrow();
  });

  it('rejects invalid uuid for id', () => {
    expect(() => DojoDiaryEntrySchema.parse({ ...validEntry, id: 'not-a-uuid' })).toThrow();
  });

  it('rejects invalid mood', () => {
    expect(() => DojoDiaryEntrySchema.parse({ ...validEntry, mood: 'angry' })).toThrow();
  });

  it('rejects invalid datetime', () => {
    expect(() => DojoDiaryEntrySchema.parse({ ...validEntry, createdAt: 'yesterday' })).toThrow();
  });
});

// ── DojoTopicSchema ──────────────────────────────────────────────────────────

describe('DojoTopicSchema', () => {
  const validTopic = {
    title: 'Decision quality',
    direction: 'backward' as const,
    description: 'Review decision patterns from the last cycle',
    priority: 'high' as const,
  };

  it('parses valid topic with defaults', () => {
    const result = DojoTopicSchema.parse(validTopic);
    expect(result.title).toBe('Decision quality');
    expect(result.tags).toEqual([]);
  });

  it('parses topic with tags', () => {
    const result = DojoTopicSchema.parse({ ...validTopic, tags: ['decisions', 'quality'] });
    expect(result.tags).toEqual(['decisions', 'quality']);
  });

  it('rejects empty title', () => {
    expect(() => DojoTopicSchema.parse({ ...validTopic, title: '' })).toThrow();
  });

  it('rejects invalid direction', () => {
    expect(() => DojoTopicSchema.parse({ ...validTopic, direction: 'up' })).toThrow();
  });
});

// ── DojoContentSectionSchema ─────────────────────────────────────────────────

describe('DojoContentSectionSchema', () => {
  const validSection = {
    title: 'Decision Timeline',
    type: 'timeline' as const,
    topicTitle: 'Decision quality',
    content: '## Timeline\n\n1. First decision...',
  };

  it('parses valid section with defaults', () => {
    const result = DojoContentSectionSchema.parse(validSection);
    expect(result.collapsed).toBe(false);
    expect(result.depth).toBe(0);
  });

  it('parses section with all fields', () => {
    const result = DojoContentSectionSchema.parse({ ...validSection, collapsed: true, depth: 2 });
    expect(result.collapsed).toBe(true);
    expect(result.depth).toBe(2);
  });

  it('allows empty content', () => {
    const result = DojoContentSectionSchema.parse({ ...validSection, content: '' });
    expect(result.content).toBe('');
  });

  it('rejects negative depth', () => {
    expect(() => DojoContentSectionSchema.parse({ ...validSection, depth: -1 })).toThrow();
  });
});

// ── DojoSourceSchema ─────────────────────────────────────────────────────────

describe('DojoSourceSchema', () => {
  const validSource = {
    id: crypto.randomUUID(),
    name: 'MDN Web Docs',
    url: 'https://developer.mozilla.org',
    reputation: 'official' as const,
  };

  it('parses valid source with defaults', () => {
    const result = DojoSourceSchema.parse(validSource);
    expect(result.domains).toEqual([]);
    expect(result.active).toBe(true);
    expect(result.description).toBeUndefined();
  });

  it('parses source with all fields', () => {
    const full = {
      ...validSource,
      domains: ['javascript', 'css', 'html'],
      description: 'Mozilla Developer Network',
      active: false,
    };
    const result = DojoSourceSchema.parse(full);
    expect(result.domains).toHaveLength(3);
    expect(result.active).toBe(false);
  });

  it('rejects invalid url', () => {
    expect(() => DojoSourceSchema.parse({ ...validSource, url: 'not-a-url' })).toThrow();
  });

  it('rejects invalid reputation', () => {
    expect(() => DojoSourceSchema.parse({ ...validSource, reputation: 'unknown' })).toThrow();
  });
});

// ── DojoSourceRegistrySchema ─────────────────────────────────────────────────

describe('DojoSourceRegistrySchema', () => {
  it('parses empty registry', () => {
    const result = DojoSourceRegistrySchema.parse({ updatedAt: new Date().toISOString() });
    expect(result.sources).toEqual([]);
  });

  it('parses registry with sources', () => {
    const registry = {
      sources: [{
        id: crypto.randomUUID(),
        name: 'OWASP',
        url: 'https://owasp.org',
        reputation: 'authoritative' as const,
        domains: ['security'],
      }],
      updatedAt: new Date().toISOString(),
    };
    const result = DojoSourceRegistrySchema.parse(registry);
    expect(result.sources).toHaveLength(1);
  });
});

// ── DojoSessionSchema ────────────────────────────────────────────────────────

describe('DojoSessionSchema', () => {
  const validSession = {
    id: crypto.randomUUID(),
    title: 'Sprint 4 Training Session',
    summary: 'Reviewing decision patterns and preparing for auth migration.',
    topics: [{
      title: 'Decision quality',
      direction: 'backward' as const,
      description: 'Review decisions',
      priority: 'high' as const,
    }],
    sections: [{
      title: 'Decision Timeline',
      type: 'timeline' as const,
      topicTitle: 'Decision quality',
      content: '# Timeline',
    }],
    createdAt: new Date().toISOString(),
    version: 1 as const,
  };

  it('parses valid session with defaults', () => {
    const result = DojoSessionSchema.parse(validSession);
    expect(result.diaryEntryIds).toEqual([]);
    expect(result.runIds).toEqual([]);
    expect(result.cycleIds).toEqual([]);
    expect(result.sourceIds).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('parses session with all references', () => {
    const full = {
      ...validSession,
      diaryEntryIds: [crypto.randomUUID()],
      runIds: [crypto.randomUUID()],
      cycleIds: [crypto.randomUUID()],
      sourceIds: [crypto.randomUUID()],
      tags: ['auth', 'decisions'],
    };
    const result = DojoSessionSchema.parse(full);
    expect(result.diaryEntryIds).toHaveLength(1);
    expect(result.tags).toHaveLength(2);
  });

  it('rejects version != 1', () => {
    expect(() => DojoSessionSchema.parse({ ...validSession, version: 2 })).toThrow();
  });

  it('rejects empty title', () => {
    expect(() => DojoSessionSchema.parse({ ...validSession, title: '' })).toThrow();
  });
});

// ── DojoSessionMetaSchema ────────────────────────────────────────────────────

describe('DojoSessionMetaSchema', () => {
  const validMeta = {
    id: crypto.randomUUID(),
    title: 'Training Session',
    summary: 'Summary text.',
    topicCount: 3,
    sectionCount: 8,
    createdAt: new Date().toISOString(),
  };

  it('parses valid meta with defaults', () => {
    const result = DojoSessionMetaSchema.parse(validMeta);
    expect(result.tags).toEqual([]);
  });

  it('parses meta with tags', () => {
    const result = DojoSessionMetaSchema.parse({ ...validMeta, tags: ['auth'] });
    expect(result.tags).toEqual(['auth']);
  });

  it('rejects negative topicCount', () => {
    expect(() => DojoSessionMetaSchema.parse({ ...validMeta, topicCount: -1 })).toThrow();
  });
});

// ── DojoSessionIndexSchema ───────────────────────────────────────────────────

describe('DojoSessionIndexSchema', () => {
  it('parses empty index', () => {
    const result = DojoSessionIndexSchema.parse({ updatedAt: new Date().toISOString() });
    expect(result.sessions).toEqual([]);
  });

  it('parses index with sessions', () => {
    const index = {
      sessions: [{
        id: crypto.randomUUID(),
        title: 'Session 1',
        summary: 'First session.',
        topicCount: 2,
        sectionCount: 5,
        createdAt: new Date().toISOString(),
      }],
      updatedAt: new Date().toISOString(),
    };
    const result = DojoSessionIndexSchema.parse(index);
    expect(result.sessions).toHaveLength(1);
  });
});
