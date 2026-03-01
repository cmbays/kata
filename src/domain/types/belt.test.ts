import {
  BeltLevel,
  BeltDiscoverySchema,
  ProjectStateSchema,
  BELT_KANJI,
  BELT_HEADLINE,
  BELT_COLOR,
  BELT_LADDER,
  computeBelt,
  type BeltSnapshot,
  type BeltDiscovery,
} from './belt.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyDiscovery(): BeltDiscovery {
  return BeltDiscoverySchema.parse({});
}

function emptySnapshot(overrides: Partial<BeltSnapshot> = {}): BeltSnapshot {
  return {
    cyclesCompleted: 0,
    betsCompleted: 0,
    learningsTotal: 0,
    strategicLearnings: 0,
    constitutionalLearnings: 0,
    userCreatedConstitutional: 0,
    learningVersionCount: 0,
    avgCitationsPerStrategic: 0,
    predictionOutcomePairs: 0,
    frictionObservations: 0,
    frictionResolutionRate: 0,
    gapsIdentified: 0,
    calibrationAccuracy: 0,
    synthesisApplied: 0,
    gapsClosed: 0,
    ranWithYolo: false,
    discovery: emptyDiscovery(),
    flavorsTotal: 0,
    decisionOutcomePairs: 0,
    katasSaved: 0,
    dojoSessionsGenerated: 0,
    domainCategoryCount: 0,
    crossCyclePatternsActive: false,
    methodologyRecommendationsApplied: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema tests
// ---------------------------------------------------------------------------

describe('ProjectStateSchema', () => {
  it('parses with defaults', () => {
    const state = ProjectStateSchema.parse({});
    expect(state.currentBelt).toBe('mukyu');
    expect(state.synthesisAppliedCount).toBe(0);
    expect(state.gapsClosedCount).toBe(0);
    expect(state.ranWithYolo).toBe(false);
    expect(state.discovery.ranFirstExecution).toBe(false);
    expect(state.checkHistory).toEqual([]);
  });

  it('accepts a fully populated state', () => {
    const state = ProjectStateSchema.parse({
      currentBelt: 'san-kyu',
      earnedAt: '2026-01-15T12:00:00.000Z',
      synthesisAppliedCount: 3,
      gapsClosedCount: 5,
      ranWithYolo: true,
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: true,
        launchedWatch: true,
        launchedDojo: true,
      },
      checkHistory: [{
        checkedAt: '2026-01-15T12:00:00.000Z',
        computedLevel: 'san-kyu',
        cyclesCompleted: 6,
        learningsTotal: 15,
        synthesisApplied: 1,
      }],
    });
    expect(state.currentBelt).toBe('san-kyu');
    expect(state.checkHistory).toHaveLength(1);
  });

  it('rejects invalid belt level', () => {
    const result = ProjectStateSchema.safeParse({ currentBelt: 'ultra-dan' });
    expect(result.success).toBe(false);
  });
});

describe('BeltDiscoverySchema', () => {
  it('parses with all false defaults', () => {
    const discovery = BeltDiscoverySchema.parse({});
    expect(discovery.ranFirstExecution).toBe(false);
    expect(discovery.completedFirstCycleCooldown).toBe(false);
    expect(discovery.savedKataSequence).toBe(false);
    expect(discovery.createdCustomStepOrFlavor).toBe(false);
    expect(discovery.launchedConfig).toBe(false);
    expect(discovery.launchedWatch).toBe(false);
    expect(discovery.launchedDojo).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computeBelt tests
// ---------------------------------------------------------------------------

describe('computeBelt', () => {
  it('returns mukyu for empty snapshot', () => {
    expect(computeBelt(emptySnapshot())).toBe('mukyu');
  });

  it('returns go-kyu when all discovery flags set', () => {
    const snap = emptySnapshot({
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
    });
    expect(computeBelt(snap)).toBe('go-kyu');
  });

  it('requires ALL go-kyu criteria — missing savedKataSequence stays mukyu', () => {
    const snap = emptySnapshot({
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: false,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
    });
    expect(computeBelt(snap)).toBe('mukyu');
  });

  it('returns yon-kyu when all yon-kyu criteria met', () => {
    const snap = emptySnapshot({
      cyclesCompleted: 3,
      betsCompleted: 6,
      learningsTotal: 10,
      constitutionalLearnings: 1,
      ranWithYolo: true,
      decisionOutcomePairs: 5,
      flavorsTotal: 2,
      dojoSessionsGenerated: 1,
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
    });
    expect(computeBelt(snap)).toBe('yon-kyu');
  });

  it('returns san-kyu when all san-kyu criteria met', () => {
    const snap = emptySnapshot({
      cyclesCompleted: 6,
      betsCompleted: 12,
      learningsTotal: 15,
      strategicLearnings: 1,
      constitutionalLearnings: 1,
      predictionOutcomePairs: 5,
      gapsIdentified: 3,
      synthesisApplied: 1,
      ranWithYolo: true,
      decisionOutcomePairs: 5,
      flavorsTotal: 2,
      katasSaved: 1,
      dojoSessionsGenerated: 3,
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
    });
    expect(computeBelt(snap)).toBe('san-kyu');
  });

  it('does NOT return higher level than criteria allow', () => {
    // Has yon-kyu but NOT san-kyu (missing strategicLearnings, predictions, katas)
    const snap = emptySnapshot({
      cyclesCompleted: 10,
      betsCompleted: 20,
      learningsTotal: 25,
      constitutionalLearnings: 1,
      ranWithYolo: true,
      decisionOutcomePairs: 10,
      flavorsTotal: 5,
      dojoSessionsGenerated: 1,
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      },
    });
    expect(computeBelt(snap)).toBe('yon-kyu');
  });

  it('returns shodan for a fully maxed-out snapshot', () => {
    const snap = emptySnapshot({
      cyclesCompleted: 30,
      betsCompleted: 60,
      learningsTotal: 50,
      strategicLearnings: 10,
      constitutionalLearnings: 5,
      userCreatedConstitutional: 3,
      learningVersionCount: 25,
      avgCitationsPerStrategic: 6,
      predictionOutcomePairs: 20,
      frictionObservations: 15,
      frictionResolutionRate: 0.9,
      gapsIdentified: 20,
      calibrationAccuracy: 0.85,
      synthesisApplied: 5,
      gapsClosed: 15,
      ranWithYolo: true,
      domainCategoryCount: 4,
      crossCyclePatternsActive: true,
      methodologyRecommendationsApplied: 5,
      flavorsTotal: 10,
      decisionOutcomePairs: 30,
      katasSaved: 5,
      dojoSessionsGenerated: 12,
      discovery: {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: true,
        launchedWatch: true,
        launchedDojo: true,
      },
    });
    expect(computeBelt(snap)).toBe('shodan');
  });
});

// ---------------------------------------------------------------------------
// Constant completeness
// ---------------------------------------------------------------------------

describe('Belt display constants', () => {
  const allLevels = BeltLevel.options;

  it('BELT_KANJI has entries for all 7 belt levels', () => {
    for (const level of allLevels) {
      expect(BELT_KANJI[level]).toBeDefined();
      expect(BELT_KANJI[level].length).toBeGreaterThan(0);
    }
  });

  it('BELT_HEADLINE has entries for all 7 belt levels', () => {
    for (const level of allLevels) {
      expect(BELT_HEADLINE[level]).toBeDefined();
      expect(BELT_HEADLINE[level].length).toBeGreaterThan(0);
    }
  });

  it('BELT_COLOR has entries for all 7 belt levels', () => {
    for (const level of allLevels) {
      expect(BELT_COLOR[level]).toBeDefined();
    }
  });

  it('BELT_LADDER has entries for all 7 belt levels', () => {
    const ladderLevels = BELT_LADDER.map((e) => e.level);
    for (const level of allLevels) {
      expect(ladderLevels).toContain(level);
    }
  });

  it('BELT_LADDER is ordered descending (shodan first, mukyu last)', () => {
    expect(BELT_LADDER[0]!.level).toBe('shodan');
    expect(BELT_LADDER[BELT_LADDER.length - 1]!.level).toBe('mukyu');
  });
});
