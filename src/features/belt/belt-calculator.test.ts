import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { JsonStore } from '@infra/persistence/json-store.js';
import { CycleSchema } from '@domain/types/cycle.js';
import { LearningSchema } from '@domain/types/learning.js';
import { ProjectStateSchema, type ProjectState } from '@domain/types/belt.js';
import {
  BeltCalculator,
  ProjectStateUpdater,
  loadProjectState,
} from './belt-calculator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpBase(): string {
  const dir = join(tmpdir(), `kata-belt-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCycle(cyclesDir: string, overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const cycle = {
    id,
    name: 'Test Cycle',
    budget: { tokenBudget: 50000 },
    bets: [],
    state: 'planning',
    pipelineMappings: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  JsonStore.write(join(cyclesDir, `${id}.json`), cycle, CycleSchema);
  return id;
}

function writeLearning(knowledgeDir: string, overrides: Record<string, unknown> = {}): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  const learning = {
    id,
    tier: 'category',
    category: 'test',
    content: 'Test learning content',
    confidence: 0.7,
    evidence: [],
    citations: [],
    derivedFrom: [],
    reinforcedBy: [],
    versions: [],
    usageCount: 0,
    archived: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  // KnowledgeStore writes to knowledgeDir/learnings/ — mirror that structure here.
  const learningsDir = join(knowledgeDir, 'learnings');
  mkdirSync(learningsDir, { recursive: true });
  JsonStore.write(join(learningsDir, `${id}.json`), learning, LearningSchema);
  return id;
}

function defaultProjectState(): ProjectState {
  return ProjectStateSchema.parse({});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BeltCalculator', () => {
  let base: string;
  let cyclesDir: string;
  let knowledgeDir: string;

  beforeEach(() => {
    base = tmpBase();
    cyclesDir = join(base, 'cycles');
    knowledgeDir = join(base, 'knowledge');
    mkdirSync(cyclesDir, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe('computeSnapshot', () => {
    it('returns valid BeltSnapshot with zeros when dirs are empty', () => {
      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.cyclesCompleted).toBe(0);
      expect(snap.betsCompleted).toBe(0);
      expect(snap.learningsTotal).toBe(0);
      expect(snap.strategicLearnings).toBe(0);
      expect(snap.constitutionalLearnings).toBe(0);
      expect(snap.flavorsTotal).toBe(0);
      expect(snap.dojoSessionsGenerated).toBe(0);
    });

    it('returns zeros when dirs do not exist', () => {
      const calc = new BeltCalculator({
        cyclesDir: join(base, 'nonexistent-cycles'),
        knowledgeDir: join(base, 'nonexistent-knowledge'),
      });
      const snap = calc.computeSnapshot();
      expect(snap.cyclesCompleted).toBe(0);
      expect(snap.learningsTotal).toBe(0);
    });

    it('reads cycles correctly — counts completed cycles', () => {
      writeCycle(cyclesDir, { state: 'complete' });
      writeCycle(cyclesDir, { state: 'complete' });
      writeCycle(cyclesDir, { state: 'active' });

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.cyclesCompleted).toBe(2);
    });

    it('reads cycles correctly — counts completed bets', () => {
      const now = new Date().toISOString();
      writeCycle(cyclesDir, {
        state: 'complete',
        bets: [
          { id: randomUUID(), description: 'Bet 1', appetite: 30, outcome: 'complete', issueRefs: [], createdAt: now, updatedAt: now },
          { id: randomUUID(), description: 'Bet 2', appetite: 20, outcome: 'pending', issueRefs: [], createdAt: now, updatedAt: now },
          { id: randomUUID(), description: 'Bet 3', appetite: 50, outcome: 'partial', issueRefs: [], createdAt: now, updatedAt: now },
        ],
      });

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.betsCompleted).toBe(2); // complete + partial (not pending)
    });

    it('reads learnings correctly — counts active non-archived', () => {
      writeLearning(knowledgeDir, { permanence: 'strategic' });
      writeLearning(knowledgeDir, { permanence: 'constitutional' });
      writeLearning(knowledgeDir, { archived: true });

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.learningsTotal).toBe(2);
      expect(snap.strategicLearnings).toBe(1);
      expect(snap.constitutionalLearnings).toBe(1);
    });

    it('counts user-created constitutional learnings', () => {
      writeLearning(knowledgeDir, { permanence: 'constitutional', source: 'user' });
      writeLearning(knowledgeDir, { permanence: 'constitutional', source: 'imported' });

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.userCreatedConstitutional).toBe(1);
    });

    it('counts learnings with version history', () => {
      const now = new Date().toISOString();
      writeLearning(knowledgeDir, {
        versions: [
          { content: 'v1', confidence: 0.5, updatedAt: now },
          { content: 'v2', confidence: 0.7, updatedAt: now },
        ],
      });
      writeLearning(knowledgeDir, { versions: [] });

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.learningVersionCount).toBe(1);
    });

    it('counts flavors from flavorsDir', () => {
      const flavorsDir = join(base, 'flavors');
      mkdirSync(flavorsDir, { recursive: true });
      writeFileSync(join(flavorsDir, 'custom-1.json'), '{}');
      writeFileSync(join(flavorsDir, 'custom-2.json'), '{}');

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, flavorsDir });
      const snap = calc.computeSnapshot();
      expect(snap.flavorsTotal).toBe(2);
    });

    it('counts dojo sessions', () => {
      const dojoSessionsDir = join(base, 'dojo', 'sessions');
      mkdirSync(dojoSessionsDir, { recursive: true });
      writeFileSync(join(dojoSessionsDir, 's1.json'), '{}');
      writeFileSync(join(dojoSessionsDir, 's2.json'), '{}');
      writeFileSync(join(dojoSessionsDir, 's3.json'), '{}');

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, dojoSessionsDir });
      const snap = calc.computeSnapshot();
      expect(snap.dojoSessionsGenerated).toBe(3);
    });

    it('reads run observations for friction and gap counts', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });

      const obsLines = [
        JSON.stringify({ id: randomUUID(), type: 'friction', content: 'Slow build', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'friction', content: 'Flaky test', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'gap', content: 'Missing docs', observedAt: new Date().toISOString() }),
      ];
      writeFileSync(join(runDir, 'observations.jsonl'), obsLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.frictionObservations).toBe(2);
      expect(snap.gapsIdentified).toBe(1);
    });

    it('reads calibration accuracyRate from reflections.jsonl', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });

      // Two calibration reflections with accuracyRate (not 'accurate')
      const refLines = [
        JSON.stringify({ type: 'calibration', accuracyRate: 0.8, domain: 'global' }),
        JSON.stringify({ type: 'calibration', accuracyRate: 0.6, domain: 'quantitative' }),
      ];
      writeFileSync(join(runDir, 'reflections.jsonl'), refLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      // Average of 0.8 and 0.6 = 0.7
      expect(snap.calibrationAccuracy).toBeCloseTo(0.7, 5);
    });

    it('calibrationAccuracy is 0 when no calibration reflections exist', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      const runDir = join(runsDir, runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, 'reflections.jsonl'), '');

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.calibrationAccuracy).toBe(0);
    });

    it('counts decision-outcomes.jsonl entries as decisionOutcomePairs', () => {
      const runsDir = join(base, 'runs');
      const runId1 = randomUUID();
      const runId2 = randomUUID();
      mkdirSync(join(runsDir, runId1), { recursive: true });
      mkdirSync(join(runsDir, runId2), { recursive: true });

      // run1 has 2 outcome entries, run2 has 1
      const entry = (decisionId: string) =>
        JSON.stringify({ decisionId, runId: runId1, outcome: { notes: 'ok' }, recordedAt: new Date().toISOString() });
      writeFileSync(join(runsDir, runId1, 'decision-outcomes.jsonl'), [entry(randomUUID()), entry(randomUUID())].join('\n'));
      writeFileSync(join(runsDir, runId2, 'decision-outcomes.jsonl'), entry(randomUUID()));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(3);
    });

    it('decisionOutcomePairs is 0 when no runsDir configured', () => {
      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(0);
    });

    it('counts kansatsu decision+outcome observation pairs from observations.jsonl', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      mkdirSync(join(runsDir, runId), { recursive: true });

      // 2 decision observations + 2 outcome observations → 2 pairs
      const obsLines = [
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'Chose approach A', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'Chose approach B', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'Approach A worked well', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'Approach B was partial', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'friction', content: 'Some friction', observedAt: new Date().toISOString(), taxonomy: 'tool-mismatch' }),
      ];
      writeFileSync(join(runsDir, runId, 'observations.jsonl'), obsLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(2);
    });

    it('counts kansatsu pairs as min(decisions, outcomes) to avoid inflating count with orphans', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      mkdirSync(join(runsDir, runId), { recursive: true });

      // 3 decisions, 1 outcome → only 1 matched pair
      const obsLines = [
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D1', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D2', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D3', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O1', observedAt: new Date().toISOString() }),
      ];
      writeFileSync(join(runsDir, runId, 'observations.jsonl'), obsLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(1);
    });

    it('adds kime pairs and kansatsu pairs together across runs', () => {
      const runsDir = join(base, 'runs');
      const runId1 = randomUUID();
      const runId2 = randomUUID();
      mkdirSync(join(runsDir, runId1), { recursive: true });
      mkdirSync(join(runsDir, runId2), { recursive: true });

      // run1: 2 kime pairs (decision-outcomes.jsonl)
      const kimeEntry = (decisionId: string) =>
        JSON.stringify({ decisionId, runId: runId1, outcome: { notes: 'ok' }, recordedAt: new Date().toISOString() });
      writeFileSync(join(runsDir, runId1, 'decision-outcomes.jsonl'), [kimeEntry(randomUUID()), kimeEntry(randomUUID())].join('\n'));

      // run2: 3 kansatsu pairs (observations.jsonl: 3 decisions, 3 outcomes)
      const kansatsuLines = [
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D1', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D2', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D3', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O1', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O2', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O3', observedAt: new Date().toISOString() }),
      ];
      writeFileSync(join(runsDir, runId2, 'observations.jsonl'), kansatsuLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(5); // 2 kime + 3 kansatsu
    });

    it('handles run with both kime and kansatsu pairs in same run', () => {
      const runsDir = join(base, 'runs');
      const runId = randomUUID();
      mkdirSync(join(runsDir, runId), { recursive: true });

      // 1 kime pair
      const kimeEntry = JSON.stringify({ decisionId: randomUUID(), runId, outcome: { notes: 'ok' }, recordedAt: new Date().toISOString() });
      writeFileSync(join(runsDir, runId, 'decision-outcomes.jsonl'), kimeEntry);

      // 2 kansatsu pairs
      const obsLines = [
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D1', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'decision', content: 'D2', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O1', observedAt: new Date().toISOString() }),
        JSON.stringify({ id: randomUUID(), type: 'outcome', content: 'O2', observedAt: new Date().toISOString() }),
      ];
      writeFileSync(join(runsDir, runId, 'observations.jsonl'), obsLines.join('\n'));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, runsDir });
      const snap = calc.computeSnapshot();
      expect(snap.decisionOutcomePairs).toBe(3); // 1 kime + 2 kansatsu
    });

    it('reads synthesisApplied and methodologyRecommendationsApplied from result-*.json files', () => {
      const synthesisDir = join(base, 'synthesis');
      mkdirSync(synthesisDir, { recursive: true });

      const inputId1 = randomUUID();
      const inputId2 = randomUUID();

      const result1 = {
        inputId: inputId1,
        proposals: [
          { id: randomUUID(), type: 'new-learning', confidence: 0.8, citations: [randomUUID(), randomUUID()], reasoning: 'r', createdAt: new Date().toISOString(), proposedContent: 'c', proposedTier: 'category', proposedCategory: 'test' },
          { id: randomUUID(), type: 'methodology-recommendation', confidence: 0.9, citations: [randomUUID(), randomUUID()], reasoning: 'r', createdAt: new Date().toISOString(), recommendation: 'Do X', area: 'testing' },
        ],
      };
      const result2 = {
        inputId: inputId2,
        proposals: [
          { id: randomUUID(), type: 'methodology-recommendation', confidence: 0.7, citations: [randomUUID(), randomUUID()], reasoning: 'r', createdAt: new Date().toISOString(), recommendation: 'Do Y', area: 'process' },
        ],
      };
      writeFileSync(join(synthesisDir, `result-${inputId1}.json`), JSON.stringify(result1));
      writeFileSync(join(synthesisDir, `result-${inputId2}.json`), JSON.stringify(result2));

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir, synthesisDir });
      const snap = calc.computeSnapshot();
      expect(snap.synthesisApplied).toBe(3);                  // 2 + 1 proposals total
      expect(snap.methodologyRecommendationsApplied).toBe(2); // 1 + 1 methodology-recommendation
    });

    it('synthesisApplied is 0 when synthesisDir not configured', () => {
      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const snap = calc.computeSnapshot();
      expect(snap.synthesisApplied).toBe(0);
      expect(snap.methodologyRecommendationsApplied).toBe(0);
    });
  });

  describe('computeAndStore', () => {
    it('advances belt when criteria met', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();
      state.discovery = {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      };

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const result = calc.computeAndStore(projectStateFile, state);

      expect(result.belt).toBe('go-kyu');
      expect(result.leveledUp).toBe(true);
      expect(result.previous).toBe('mukyu');
    });

    it('does NOT downgrade belt', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();
      state.currentBelt = 'yon-kyu';

      // Empty snapshot → computeBelt returns mukyu or go-kyu, but state should keep yon-kyu
      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const result = calc.computeAndStore(projectStateFile, state);

      expect(result.belt).toBe('yon-kyu');
      expect(result.leveledUp).toBe(false);
      expect(result.previous).toBe('yon-kyu');
    });

    it('returns leveledUp=true when belt advances', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();
      state.discovery = {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      };

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const result = calc.computeAndStore(projectStateFile, state);

      expect(result.leveledUp).toBe(true);
    });

    it('returns leveledUp=false when belt stays same', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const result = calc.computeAndStore(projectStateFile, state);

      expect(result.leveledUp).toBe(false);
      expect(result.belt).toBe('mukyu');
    });

    it('persists state to file', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();
      state.discovery = {
        ranFirstExecution: true,
        completedFirstCycleCooldown: true,
        savedKataSequence: true,
        createdCustomStepOrFlavor: true,
        launchedConfig: false,
        launchedWatch: false,
        launchedDojo: false,
      };

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      calc.computeAndStore(projectStateFile, state);

      const persisted = loadProjectState(projectStateFile);
      expect(persisted.currentBelt).toBe('go-kyu');
      expect(persisted.earnedAt).toBeDefined();
      expect(persisted.checkHistory).toHaveLength(1);
    });

    it('appends to checkHistory on every call', () => {
      const projectStateFile = join(base, 'project-state.json');
      const state = defaultProjectState();

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      calc.computeAndStore(projectStateFile, state);
      const s2 = loadProjectState(projectStateFile);
      calc.computeAndStore(projectStateFile, s2);

      const final = loadProjectState(projectStateFile);
      expect(final.checkHistory).toHaveLength(2);
    });

    it('creates parent directory if missing', () => {
      const projectStateFile = join(base, 'nested', 'deep', 'project-state.json');
      const state = defaultProjectState();

      const calc = new BeltCalculator({ cyclesDir, knowledgeDir });
      const result = calc.computeAndStore(projectStateFile, state);
      expect(result.belt).toBe('mukyu');

      const persisted = loadProjectState(projectStateFile);
      expect(persisted.currentBelt).toBe('mukyu');
    });
  });
});

// ---------------------------------------------------------------------------
// ProjectStateUpdater
// ---------------------------------------------------------------------------

describe('ProjectStateUpdater', () => {
  let base: string;
  let projectStateFile: string;

  beforeEach(() => {
    base = tmpBase();
    projectStateFile = join(base, 'project-state.json');
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe('markDiscovery', () => {
    it('sets flag correctly', () => {
      ProjectStateUpdater.markDiscovery(projectStateFile, 'ranFirstExecution');
      const state = loadProjectState(projectStateFile);
      expect(state.discovery.ranFirstExecution).toBe(true);
    });

    it('creates state file if missing', () => {
      const newFile = join(base, 'new-state.json');
      ProjectStateUpdater.markDiscovery(newFile, 'launchedDojo');
      const state = loadProjectState(newFile);
      expect(state.discovery.launchedDojo).toBe(true);
      expect(state.currentBelt).toBe('mukyu');
    });

    it('preserves other flags when setting one', () => {
      ProjectStateUpdater.markDiscovery(projectStateFile, 'ranFirstExecution');
      ProjectStateUpdater.markDiscovery(projectStateFile, 'launchedWatch');
      const state = loadProjectState(projectStateFile);
      expect(state.discovery.ranFirstExecution).toBe(true);
      expect(state.discovery.launchedWatch).toBe(true);
      expect(state.discovery.launchedDojo).toBe(false);
    });
  });

  describe('incrementSynthesisApplied', () => {
    it('increments counter', () => {
      ProjectStateUpdater.incrementSynthesisApplied(projectStateFile, 3);
      const state = loadProjectState(projectStateFile);
      expect(state.synthesisAppliedCount).toBe(3);
    });

    it('accumulates across calls', () => {
      ProjectStateUpdater.incrementSynthesisApplied(projectStateFile, 2);
      ProjectStateUpdater.incrementSynthesisApplied(projectStateFile, 5);
      const state = loadProjectState(projectStateFile);
      expect(state.synthesisAppliedCount).toBe(7);
    });
  });

  describe('incrementGapsClosed', () => {
    it('increments counter', () => {
      ProjectStateUpdater.incrementGapsClosed(projectStateFile, 4);
      const state = loadProjectState(projectStateFile);
      expect(state.gapsClosedCount).toBe(4);
    });
  });

  describe('markRanWithYolo', () => {
    it('sets ranWithYolo=true', () => {
      ProjectStateUpdater.markRanWithYolo(projectStateFile);
      const state = loadProjectState(projectStateFile);
      expect(state.ranWithYolo).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// loadProjectState
// ---------------------------------------------------------------------------

describe('loadProjectState', () => {
  let base: string;

  beforeEach(() => { base = tmpBase(); });
  afterEach(() => { rmSync(base, { recursive: true, force: true }); });

  it('returns default if file missing', () => {
    const state = loadProjectState(join(base, 'missing.json'));
    expect(state.currentBelt).toBe('mukyu');
    expect(state.checkHistory).toEqual([]);
  });

  it('reads existing file', () => {
    const file = join(base, 'state.json');
    const data: ProjectState = {
      ...ProjectStateSchema.parse({}),
      currentBelt: 'san-kyu',
    };
    JsonStore.write(file, data, ProjectStateSchema);

    const state = loadProjectState(file);
    expect(state.currentBelt).toBe('san-kyu');
  });
});
