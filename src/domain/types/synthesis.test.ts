import {
  SynthesisProposalSchema,
  SynthesisInputSchema,
  SynthesisResultSchema,
  SynthesisDepth,
  SynthesisProposalType,
} from './synthesis.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseProposal(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    confidence: 0.8,
    citations: [crypto.randomUUID(), crypto.randomUUID()],
    reasoning: 'Test reasoning',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeLearning(overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    tier: 'stage' as const,
    category: 'testing',
    content: 'Test learning',
    evidence: [],
    confidence: 0.7,
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    usageCount: 0,
    versions: [],
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeObservation(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'insight' as const,
    timestamp: new Date().toISOString(),
    content: 'Test observation',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SynthesisDepth
// ---------------------------------------------------------------------------

describe('SynthesisDepth', () => {
  it('accepts valid depth values', () => {
    expect(SynthesisDepth.safeParse('quick').success).toBe(true);
    expect(SynthesisDepth.safeParse('standard').success).toBe(true);
    expect(SynthesisDepth.safeParse('thorough').success).toBe(true);
  });

  it('rejects invalid depth values', () => {
    expect(SynthesisDepth.safeParse('deep').success).toBe(false);
    expect(SynthesisDepth.safeParse('').success).toBe(false);
    expect(SynthesisDepth.safeParse(null).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SynthesisProposalType
// ---------------------------------------------------------------------------

describe('SynthesisProposalType', () => {
  it('accepts all valid proposal types', () => {
    const types = [
      'new-learning',
      'update-learning',
      'promote',
      'archive',
      'methodology-recommendation',
    ];
    for (const t of types) {
      expect(SynthesisProposalType.safeParse(t).success).toBe(true);
    }
  });

  it('rejects invalid types', () => {
    expect(SynthesisProposalType.safeParse('delete').success).toBe(false);
    expect(SynthesisProposalType.safeParse('').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SynthesisProposalSchema — discriminated union
// ---------------------------------------------------------------------------

describe('SynthesisProposalSchema', () => {
  describe('new-learning variant', () => {
    it('accepts a valid new-learning proposal', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'new-learning',
        proposedContent: 'Always prefer composition over inheritance',
        proposedTier: 'category',
        proposedCategory: 'architecture',
      };
      const result = SynthesisProposalSchema.safeParse(proposal);
      expect(result.success).toBe(true);
    });

    it('rejects missing proposedContent', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'new-learning',
        proposedTier: 'category',
        proposedCategory: 'architecture',
      };
      const result = SynthesisProposalSchema.safeParse(proposal);
      expect(result.success).toBe(false);
    });

    it('rejects invalid tier', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'new-learning',
        proposedContent: 'Some content',
        proposedTier: 'invalid-tier',
        proposedCategory: 'architecture',
      };
      const result = SynthesisProposalSchema.safeParse(proposal);
      expect(result.success).toBe(false);
    });

    it('allows all valid tiers', () => {
      const tiers = ['step', 'flavor', 'stage', 'category', 'agent'];
      for (const tier of tiers) {
        const proposal = {
          ...makeBaseProposal(),
          type: 'new-learning',
          proposedContent: 'Content',
          proposedTier: tier,
          proposedCategory: 'test',
        };
        expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
      }
    });
  });

  describe('update-learning variant', () => {
    it('accepts a valid update-learning proposal', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'update-learning',
        targetLearningId: crypto.randomUUID(),
        proposedContent: 'Updated content',
        confidenceDelta: 0.1,
      };
      const result = SynthesisProposalSchema.safeParse(proposal);
      expect(result.success).toBe(true);
    });

    it('accepts negative confidenceDelta', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'update-learning',
        targetLearningId: crypto.randomUUID(),
        proposedContent: 'Updated',
        confidenceDelta: -0.3,
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it('rejects confidenceDelta outside -1..1', () => {
      const base = makeBaseProposal();
      expect(SynthesisProposalSchema.safeParse({
        ...base, type: 'update-learning',
        targetLearningId: crypto.randomUUID(), proposedContent: 'x', confidenceDelta: 1.5,
      }).success).toBe(false);

      expect(SynthesisProposalSchema.safeParse({
        ...base, type: 'update-learning',
        targetLearningId: crypto.randomUUID(), proposedContent: 'x', confidenceDelta: -1.5,
      }).success).toBe(false);
    });

    it('requires targetLearningId to be a UUID', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'update-learning',
        targetLearningId: 'not-a-uuid',
        proposedContent: 'Updated',
        confidenceDelta: 0.1,
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(false);
    });
  });

  describe('promote variant', () => {
    it('accepts a valid promote proposal', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'promote',
        targetLearningId: crypto.randomUUID(),
        fromTier: 'step',
        toTier: 'flavor',
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it('requires both fromTier and toTier', () => {
      const base = makeBaseProposal();
      expect(SynthesisProposalSchema.safeParse({
        ...base, type: 'promote',
        targetLearningId: crypto.randomUUID(),
        fromTier: 'step',
      }).success).toBe(false);
    });
  });

  describe('archive variant', () => {
    it('accepts a valid archive proposal', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'archive',
        targetLearningId: crypto.randomUUID(),
        reason: 'No longer applicable after refactor',
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it('requires a reason string', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'archive',
        targetLearningId: crypto.randomUUID(),
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(false);
    });
  });

  describe('methodology-recommendation variant', () => {
    it('accepts a valid methodology-recommendation proposal', () => {
      const proposal = {
        ...makeBaseProposal(),
        type: 'methodology-recommendation',
        recommendation: 'Add a dedicated review stage for all features',
        area: 'process',
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
    });

    it('requires both recommendation and area', () => {
      const base = makeBaseProposal();
      expect(SynthesisProposalSchema.safeParse({
        ...base, type: 'methodology-recommendation',
        recommendation: 'Some recommendation',
      }).success).toBe(false);

      expect(SynthesisProposalSchema.safeParse({
        ...base, type: 'methodology-recommendation',
        area: 'process',
      }).success).toBe(false);
    });
  });

  describe('confidence validation', () => {
    it('rejects confidence below 0', () => {
      const proposal = {
        ...makeBaseProposal({ confidence: -0.1 }),
        type: 'new-learning',
        proposedContent: 'Content',
        proposedTier: 'stage',
        proposedCategory: 'test',
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(false);
    });

    it('rejects confidence above 1', () => {
      const proposal = {
        ...makeBaseProposal({ confidence: 1.1 }),
        type: 'new-learning',
        proposedContent: 'Content',
        proposedTier: 'stage',
        proposedCategory: 'test',
      };
      expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(false);
    });

    it('accepts confidence at boundaries 0 and 1', () => {
      for (const confidence of [0, 1]) {
        const proposal = {
          ...makeBaseProposal({ confidence }),
          type: 'new-learning',
          proposedContent: 'Content',
          proposedTier: 'stage',
          proposedCategory: 'test',
        };
        expect(SynthesisProposalSchema.safeParse(proposal).success).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// SynthesisInputSchema
// ---------------------------------------------------------------------------

describe('SynthesisInputSchema', () => {
  it('accepts a valid synthesis input', () => {
    const input = {
      id: crypto.randomUUID(),
      cycleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      depth: 'standard',
      observations: [makeObservation()],
      learnings: [makeLearning()],
      cycleName: 'Wave I',
      tokenBudget: 100000,
      tokensUsed: 50000,
    };
    expect(SynthesisInputSchema.safeParse(input).success).toBe(true);
  });

  it('accepts input without optional fields', () => {
    const input = {
      id: crypto.randomUUID(),
      cycleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      depth: 'quick',
      observations: [],
      learnings: [],
    };
    expect(SynthesisInputSchema.safeParse(input).success).toBe(true);
  });

  it('rejects invalid depth', () => {
    const input = {
      id: crypto.randomUUID(),
      cycleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      depth: 'extreme',
      observations: [],
      learnings: [],
    };
    expect(SynthesisInputSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-UUID id', () => {
    const input = {
      id: 'not-a-uuid',
      cycleId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      depth: 'standard',
      observations: [],
      learnings: [],
    };
    expect(SynthesisInputSchema.safeParse(input).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SynthesisResultSchema
// ---------------------------------------------------------------------------

describe('SynthesisResultSchema', () => {
  it('accepts a valid result with proposals', () => {
    const proposal = {
      ...makeBaseProposal(),
      type: 'new-learning',
      proposedContent: 'Content',
      proposedTier: 'stage',
      proposedCategory: 'testing',
    };
    const result = {
      inputId: crypto.randomUUID(),
      proposals: [proposal],
      appliedAt: new Date().toISOString(),
      appliedProposalIds: [proposal.id],
    };
    expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
  });

  it('accepts result without optional fields', () => {
    const result = {
      inputId: crypto.randomUUID(),
      proposals: [],
    };
    expect(SynthesisResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects non-UUID inputId', () => {
    const result = {
      inputId: 'not-a-uuid',
      proposals: [],
    };
    expect(SynthesisResultSchema.safeParse(result).success).toBe(false);
  });
});
