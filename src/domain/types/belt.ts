import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// BeltLevel — 7 levels from mukyu (unranked) through shodan (first degree)
// ---------------------------------------------------------------------------

export const BeltLevel = z.enum(['mukyu', 'go-kyu', 'yon-kyu', 'san-kyu', 'ni-kyu', 'ik-kyu', 'shodan']);
export type BeltLevel = z.infer<typeof BeltLevel>;

// ---------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------

export const BELT_KANJI: Record<BeltLevel, string> = {
  'mukyu':   '無級',
  'go-kyu':  '五級',
  'yon-kyu': '四級',
  'san-kyu': '三級',
  'ni-kyu':  '二級',
  'ik-kyu':  '一級',
  'shodan':  '初段',
};

export const BELT_HEADLINE: Record<BeltLevel, string> = {
  'mukyu':   "You've stepped onto the mat.",
  'go-kyu':  "You've explored the dojo and know where everything is.",
  'yon-kyu': "You're building a regular practice. Kata is learning from you.",
  'san-kyu': "The feedback loop is closing. Kata is starting to anticipate.",
  'ni-kyu':  "Your practice runs deep. Kata is refining itself around your work.",
  'ik-kyu':  "Your methodology is mature enough to share. Preparing for mastery.",
  'shodan':  "Kata is compounding. Your practice improves itself.",
};

export const BELT_COLOR: Record<BeltLevel, string> = {
  'mukyu':   '\x1b[37m',          // white
  'go-kyu':  '\x1b[33m',          // yellow
  'yon-kyu': '\x1b[32m',          // green
  'san-kyu': '\x1b[34m',          // blue
  'ni-kyu':  '\x1b[38;5;130m',    // brown
  'ik-kyu':  '\x1b[38;5;136m',    // dark gold
  'shodan':  '\x1b[1m\x1b[30m',   // bold black
};
export const ANSI_RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// BeltDiscoverySchema — binary feature-discovery flags
// ---------------------------------------------------------------------------

export const BeltDiscoverySchema = z.object({
  ranFirstExecution:           z.boolean().default(false),
  completedFirstCycleCooldown: z.boolean().default(false),
  savedKataSequence:           z.boolean().default(false),
  createdCustomStepOrFlavor:   z.boolean().default(false),
  launchedConfig:              z.boolean().default(false),
  launchedWatch:               z.boolean().default(false),
  launchedDojo:                z.boolean().default(false),
});
export type BeltDiscovery = z.infer<typeof BeltDiscoverySchema>;

// ---------------------------------------------------------------------------
// ProjectStateSchema — persisted belt progress
// ---------------------------------------------------------------------------

export const ProjectStateSchema = z.object({
  currentBelt:           BeltLevel.default('mukyu'),
  earnedAt:              z.string().datetime().optional(),
  synthesisAppliedCount: z.number().int().min(0).default(0),
  gapsClosedCount:       z.number().int().min(0).default(0),
  ranWithYolo:           z.boolean().default(false),
  discovery:             BeltDiscoverySchema.default(() => BeltDiscoverySchema.parse({})),
  checkHistory: z.array(z.object({
    checkedAt:        z.string().datetime(),
    computedLevel:    BeltLevel,
    cyclesCompleted:  z.number(),
    learningsTotal:   z.number(),
    synthesisApplied: z.number(),
  })).default([]),
});
export type ProjectState = z.infer<typeof ProjectStateSchema>;

// ---------------------------------------------------------------------------
// BeltSnapshot — point-in-time metrics used by computeBelt()
// ---------------------------------------------------------------------------

export interface BeltSnapshot {
  cyclesCompleted: number;
  betsCompleted: number;
  learningsTotal: number;
  strategicLearnings: number;
  constitutionalLearnings: number;
  userCreatedConstitutional: number;
  learningVersionCount: number;
  avgCitationsPerStrategic: number;
  predictionOutcomePairs: number;
  frictionObservations: number;
  frictionResolutionRate: number;
  gapsIdentified: number;
  calibrationAccuracy: number;
  synthesisApplied: number;
  gapsClosed: number;
  ranWithYolo: boolean;
  discovery: BeltDiscovery;
  flavorsTotal: number;
  decisionOutcomePairs: number;
  katasSaved: number;
  dojoSessionsGenerated: number;
  domainCategoryCount: number;
  crossCyclePatternsActive: boolean;
  methodologyRecommendationsApplied: number;
}

// ---------------------------------------------------------------------------
// BELT_LADDER — ordered descending (shodan first). computeBelt returns first match.
// ---------------------------------------------------------------------------

export interface BeltLadderEntry {
  level: BeltLevel;
  check: (s: BeltSnapshot) => boolean;
}

export const BELT_LADDER: readonly BeltLadderEntry[] = [
  {
    level: 'shodan',
    check: (s) =>
      s.cyclesCompleted >= 25 &&
      s.betsCompleted >= 50 &&
      s.learningsTotal >= 40 &&
      s.strategicLearnings >= 8 &&
      s.calibrationAccuracy >= 0.8 &&
      s.frictionResolutionRate >= 0.75 &&
      s.gapsClosed >= 10 &&
      s.avgCitationsPerStrategic >= 5 &&
      s.methodologyRecommendationsApplied >= 2 &&
      s.learningVersionCount >= 20 &&
      s.dojoSessionsGenerated >= 10,
  },
  {
    level: 'ik-kyu',
    check: (s) =>
      s.cyclesCompleted >= 15 &&
      s.betsCompleted >= 30 &&
      s.learningsTotal >= 30 &&
      s.strategicLearnings >= 5 &&
      s.userCreatedConstitutional >= 1 &&
      s.domainCategoryCount >= 2 &&
      s.methodologyRecommendationsApplied >= 2 &&
      s.learningVersionCount >= 10 &&
      s.avgCitationsPerStrategic >= 3,
  },
  {
    level: 'ni-kyu',
    check: (s) =>
      s.cyclesCompleted >= 10 &&
      s.betsCompleted >= 20 &&
      s.learningsTotal >= 20 &&
      s.strategicLearnings >= 3 &&
      s.frictionObservations >= 5 &&
      s.frictionResolutionRate >= 0.6 &&
      s.crossCyclePatternsActive &&
      s.avgCitationsPerStrategic >= 2 &&
      s.dojoSessionsGenerated >= 5,
  },
  {
    level: 'san-kyu',
    check: (s) =>
      s.cyclesCompleted >= 6 &&
      s.betsCompleted >= 12 &&
      s.learningsTotal >= 15 &&
      s.strategicLearnings >= 1 &&
      s.predictionOutcomePairs >= 5 &&
      s.gapsIdentified >= 3 &&
      s.synthesisApplied >= 1 &&
      s.katasSaved >= 1 &&
      s.dojoSessionsGenerated >= 3,
  },
  {
    level: 'yon-kyu',
    check: (s) =>
      s.cyclesCompleted >= 3 &&
      s.betsCompleted >= 6 &&
      s.learningsTotal >= 10 &&
      s.constitutionalLearnings >= 1 &&
      s.ranWithYolo &&
      s.decisionOutcomePairs >= 5 &&
      s.flavorsTotal >= 2 &&
      s.dojoSessionsGenerated >= 1,
  },
  {
    level: 'go-kyu',
    check: (s) =>
      s.discovery.ranFirstExecution &&
      s.discovery.completedFirstCycleCooldown &&
      s.discovery.createdCustomStepOrFlavor &&
      s.discovery.savedKataSequence,
  },
  {
    level: 'mukyu',
    check: () => true,
  },
];

// ---------------------------------------------------------------------------
// computeBelt — pure function, iterates BELT_LADDER top-down
// ---------------------------------------------------------------------------

export function computeBelt(snapshot: BeltSnapshot): BeltLevel {
  for (const entry of BELT_LADDER) {
    if (entry.check(snapshot)) {
      return entry.level;
    }
  }
  return 'mukyu';
}
