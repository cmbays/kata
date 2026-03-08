import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  NextKeikoProposalGenerator,
  buildProposalPrompt,
  type MilestoneIssue,
  type NextKeikoInput,
} from './next-keiko-proposal-generator.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { Observation } from '@domain/types/observation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: randomUUID(),
    name: 'Test Cycle',
    state: 'complete',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    bets: [],
    pipelineMappings: [],
    budget: {},
    ...overrides,
  } as Cycle;
}

function makeObs(type: Observation['type'], content: string): Observation {
  const base = { id: randomUUID(), timestamp: new Date().toISOString(), content };
  if (type === 'friction') {
    return { ...base, type: 'friction', taxonomy: 'tool-mismatch' };
  }
  if (type === 'gap') {
    return { ...base, type: 'gap', severity: 'minor' };
  }
  return { ...base, type } as Observation;
}

function writeObsFile(dir: string, observations: Observation[]): void {
  const lines = observations.map((o) => JSON.stringify(o)).join('\n');
  writeFileSync(join(dir, 'observations.jsonl'), lines + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// buildProposalPrompt — unit tests (no I/O)
// ---------------------------------------------------------------------------

describe('buildProposalPrompt', () => {
  it('includes cycle name in output', () => {
    const prompt = buildProposalPrompt({
      cycleName: 'Keiko 42',
      completedBets: [],
      frictionObservations: [],
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).toContain('Keiko 42');
    expect(prompt).toContain('kata-sensei');
    expect(prompt).toContain('=== Next Keiko Proposals ===');
  });

  it('lists completed bets', () => {
    const prompt = buildProposalPrompt({
      cycleName: 'Cycle X',
      completedBets: ['Build auth system', 'Fix CI pipeline'],
      frictionObservations: [],
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).toContain('Build auth system');
    expect(prompt).toContain('Fix CI pipeline');
    expect(prompt).toContain('Completed bets this cycle');
  });

  it('includes friction and gap observations', () => {
    const prompt = buildProposalPrompt({
      cycleName: 'Cycle Y',
      completedBets: [],
      frictionObservations: ['Tool X was slow', 'Config drift detected'],
      gapObservations: ['Missing test coverage for auth module'],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).toContain('Tool X was slow');
    expect(prompt).toContain('Config drift detected');
    expect(prompt).toContain('Missing test coverage for auth module');
    expect(prompt).toContain('Friction observations (2)');
    expect(prompt).toContain('Gap observations (1)');
  });

  it('includes milestone issues with numbers and labels', () => {
    const issues: MilestoneIssue[] = [
      { number: 42, title: 'feat: add belt system', labels: ['enhancement', 'priority: next'] },
      { number: 99, title: 'bug: cooldown crash', labels: ['bug'] },
    ];

    const prompt = buildProposalPrompt({
      cycleName: 'Cycle Z',
      completedBets: [],
      frictionObservations: [],
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: issues,
    });

    expect(prompt).toContain('#42');
    expect(prompt).toContain('feat: add belt system');
    expect(prompt).toContain('[enhancement, priority: next]');
    expect(prompt).toContain('#99');
    expect(prompt).toContain('bug: cooldown crash');
  });

  it('truncates long observation lists with ellipsis', () => {
    const many = Array.from({ length: 25 }, (_, i) => `Friction obs ${i}`);

    const prompt = buildProposalPrompt({
      cycleName: 'Cycle Long',
      completedBets: [],
      frictionObservations: many,
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).toContain('Friction observations (25)');
    // First 20 shown
    expect(prompt).toContain('Friction obs 0');
    expect(prompt).toContain('Friction obs 19');
    // Items 20-24 truncated
    expect(prompt).not.toContain('Friction obs 20');
    expect(prompt).toContain('(5 more)');
  });

  it('omits sections with no data', () => {
    const prompt = buildProposalPrompt({
      cycleName: 'Empty Cycle',
      completedBets: [],
      frictionObservations: [],
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).not.toContain('Completed bets');
    expect(prompt).not.toContain('Friction observations');
    expect(prompt).not.toContain('Gap observations');
    expect(prompt).not.toContain('Open milestone issues');
  });

  it('requests 6-8 bets with S/M/L appetite sizing', () => {
    const prompt = buildProposalPrompt({
      cycleName: 'Sizing Test',
      completedBets: [],
      frictionObservations: [],
      gapObservations: [],
      insightObservations: [],
      milestoneIssues: [],
    });

    expect(prompt).toContain('6-8');
    expect(prompt).toContain('S|M|L');
    expect(prompt).toContain('appetite');
  });
});

// ---------------------------------------------------------------------------
// NextKeikoProposalGenerator — integration tests with mock I/O
// ---------------------------------------------------------------------------

describe('NextKeikoProposalGenerator', () => {
  const baseDir = join(tmpdir(), `next-keiko-test-${Date.now()}`);
  const runsDir = join(baseDir, 'runs');

  beforeEach(() => {
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns formatted proposals from claude output', () => {
    const runId = randomUUID();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });

    writeObsFile(runDir, [
      makeObs('friction', 'Config drift in test env'),
      makeObs('gap', 'Missing auth coverage'),
      makeObs('insight', 'Decision confidence was high'),
    ]);

    const cycle = makeCycle({
      bets: [
        {
          id: randomUUID(),
          description: 'Build auth system',
          appetite: 40,
          outcome: 'complete',
          issueRefs: [],
          runId,
        } as Cycle['bets'][0],
      ],
    });

    const mockClaude = vi.fn().mockReturnValue(
      '=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. feat: add tests (#101)    appetite: S    signal: Gap in auth coverage\n',
    );

    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });
    const input: NextKeikoInput = {
      cycle,
      runsDir,
      completedBets: ['Build auth system'],
    };

    const result = gen.generate(input);

    expect(result.text).toContain('=== Next Keiko Proposals ===');
    expect(result.text).toContain('feat: add tests (#101)');
    expect(result.text).toContain('Based on:');
    expect(result.observationCounts.friction).toBe(1);
    expect(result.observationCounts.gap).toBe(1);
    expect(result.observationCounts.insight).toBe(1);
    expect(result.observationCounts.total).toBe(3);
    expect(mockClaude).toHaveBeenCalledOnce();
  });

  it('passes milestone issues to the prompt', () => {
    const cycle = makeCycle();

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. feat: foo (#1)    appetite: S    signal: important\n');
    const mockIssues = vi.fn().mockReturnValue([
      { number: 42, title: 'feat: some feature', labels: ['enhancement'] },
    ]);

    const gen = new NextKeikoProposalGenerator({
      invokeClaude: mockClaude,
      fetchMilestoneIssues: mockIssues,
    });

    const result = gen.generate({
      cycle,
      runsDir,
      milestoneName: 'Dogfooding & Stabilization',
      completedBets: [],
    });

    expect(mockIssues).toHaveBeenCalledWith('Dogfooding & Stabilization');
    expect(result.milestoneIssueCount).toBe(1);

    // The prompt passed to claude should contain the milestone issue
    const promptArg = mockClaude.mock.calls[0]![0] as string;
    expect(promptArg).toContain('#42');
    expect(promptArg).toContain('feat: some feature');
  });

  it('degrades gracefully when claude fails', () => {
    const cycle = makeCycle();

    const gen = new NextKeikoProposalGenerator({
      invokeClaude: () => { throw new Error('binary not found'); },
    });

    const result = gen.generate({
      cycle,
      runsDir,
      completedBets: [],
    });

    expect(result.text).toContain('=== Next Keiko Proposals ===');
    expect(result.text).toContain('LLM synthesis unavailable');
    expect(result.text).toContain('binary not found');
  });

  it('degrades gracefully when milestone issue fetch fails', () => {
    const cycle = makeCycle();

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. Some bet    appetite: S    signal: test\n');

    const gen = new NextKeikoProposalGenerator({
      invokeClaude: mockClaude,
      fetchMilestoneIssues: () => { throw new Error('gh not available'); },
    });

    // Should NOT throw — milestone fetch failure is non-critical
    expect(() => gen.generate({
      cycle,
      runsDir,
      milestoneName: 'some-milestone',
      completedBets: [],
    })).not.toThrow();

    // Claude was still called despite milestone failure
    expect(mockClaude).toHaveBeenCalledOnce();
  });

  it('collects observations from runs with no bets gracefully', () => {
    const cycle = makeCycle({ bets: [] });

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. Something    appetite: S    signal: test\n');

    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });
    const result = gen.generate({ cycle, runsDir, completedBets: [] });

    expect(result.observationCounts.total).toBe(0);
    expect(result.text).toContain('=== Next Keiko Proposals ===');
  });

  it('skips runs with missing run directories', () => {
    const cycle = makeCycle({
      bets: [
        {
          id: randomUUID(),
          description: 'Bet with missing run dir',
          appetite: 20,
          outcome: 'complete',
          issueRefs: [],
          runId: randomUUID(), // does NOT exist in runsDir
        } as Cycle['bets'][0],
      ],
    });

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. Something    appetite: S    signal: test\n');

    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });

    const result = gen.generate({ cycle, runsDir, completedBets: [] });
    expect(result).toBeDefined();
  });

  it('appends Based on footer with observation and issue counts', () => {
    const mockClaude = vi.fn().mockReturnValue(
      '=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. something    appetite: S    signal: test\n',
    );
    const mockIssues = vi.fn().mockReturnValue([
      { number: 1, title: 'Issue A', labels: [] },
      { number: 2, title: 'Issue B', labels: [] },
    ]);

    const runId = randomUUID();
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeObsFile(runDir, [
      makeObs('friction', 'friction 1'),
      makeObs('friction', 'friction 2'),
      makeObs('gap', 'gap 1'),
    ]);

    const cycleWithBet = makeCycle({
      bets: [
        {
          id: randomUUID(),
          description: 'a bet',
          appetite: 20,
          outcome: 'complete',
          issueRefs: [],
          runId,
        } as Cycle['bets'][0],
      ],
    });

    const gen = new NextKeikoProposalGenerator({
      invokeClaude: mockClaude,
      fetchMilestoneIssues: mockIssues,
    });

    const result = gen.generate({
      cycle: cycleWithBet,
      runsDir,
      milestoneName: 'M1',
      completedBets: [],
    });

    expect(result.text).toContain('2 friction observations');
    expect(result.text).toContain('1 gap observation');
    expect(result.text).toContain('2 open milestone issues');
  });
});

// ---------------------------------------------------------------------------
// Bridge-run fallback — collectObservations resolves runId via bridge-run file
// ---------------------------------------------------------------------------

describe('NextKeikoProposalGenerator — bridge-run fallback (#348)', () => {
  const baseDir = join(tmpdir(), `next-keiko-bridge-test-${Date.now()}`);
  const runsDir = join(baseDir, 'runs');
  const bridgeRunsDir = join(baseDir, 'bridge-runs');

  beforeEach(() => {
    mkdirSync(runsDir, { recursive: true });
    mkdirSync(bridgeRunsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('collects observations for bets with null runId via bridge-run lookup', () => {
    const cycleId = randomUUID();
    const betId = randomUUID();
    const runId = randomUUID();

    // Create run directory with observations
    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeObsFile(runDir, [
      makeObs('friction', 'Bridge fallback friction'),
      makeObs('gap', 'Bridge fallback gap'),
    ]);

    // Write bridge-run file (bet.runId is null — only the bridge-run file has the mapping)
    writeFileSync(
      join(bridgeRunsDir, `${runId}.json`),
      JSON.stringify({ cycleId, betId, runId, status: 'complete' }),
      'utf-8',
    );

    // Bet has NO runId — this is the bug scenario
    const cycle = {
      id: cycleId,
      name: 'Test Cycle',
      state: 'complete' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bets: [
        {
          id: betId,
          description: 'Bet without runId',
          appetite: 20,
          outcome: 'complete' as const,
          issueRefs: [],
          runId: undefined, // null — triggers the bug without the fix
        },
      ],
      pipelineMappings: [],
      budget: {},
    } as unknown as Cycle;

    const mockClaude = vi.fn().mockReturnValue(
      '=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. Fixed bet    appetite: S    signal: Bridge fallback worked\n',
    );

    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });

    // Without bridgeRunsDir — should find 0 observations (old broken behaviour)
    const resultWithout = gen.generate({ cycle, runsDir, completedBets: [] });
    expect(resultWithout.observationCounts.total).toBe(0);

    // With bridgeRunsDir — should resolve via bridge-run file and find 2 observations
    const resultWith = gen.generate({ cycle, runsDir, bridgeRunsDir, completedBets: [] });
    expect(resultWith.observationCounts.total).toBe(2);
    expect(resultWith.observationCounts.friction).toBe(1);
    expect(resultWith.observationCounts.gap).toBe(1);
  });

  it('ignores bridge-run files for other cycles', () => {
    const cycleId = randomUUID();
    const otherCycleId = randomUUID();
    const betId = randomUUID();
    const runId = randomUUID();

    const runDir = join(runsDir, runId);
    mkdirSync(runDir, { recursive: true });
    writeObsFile(runDir, [makeObs('friction', 'Should not appear')]);

    // Bridge-run belongs to a different cycle
    writeFileSync(
      join(bridgeRunsDir, `${runId}.json`),
      JSON.stringify({ cycleId: otherCycleId, betId, runId, status: 'complete' }),
      'utf-8',
    );

    const cycle = {
      id: cycleId,
      name: 'Test Cycle',
      state: 'complete' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bets: [
        {
          id: betId,
          description: 'Bet without runId',
          appetite: 20,
          outcome: 'complete' as const,
          issueRefs: [],
          runId: undefined,
        },
      ],
      pipelineMappings: [],
      budget: {},
    } as unknown as Cycle;

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. x    appetite: S    signal: y\n');
    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });

    const result = gen.generate({ cycle, runsDir, bridgeRunsDir, completedBets: [] });
    expect(result.observationCounts.total).toBe(0);
  });

  it('handles missing bridgeRunsDir gracefully', () => {
    const cycle = {
      id: randomUUID(),
      name: 'Test Cycle',
      state: 'complete' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bets: [
        {
          id: randomUUID(),
          description: 'Bet without runId',
          appetite: 20,
          outcome: 'complete' as const,
          issueRefs: [],
          runId: undefined,
        },
      ],
      pipelineMappings: [],
      budget: {},
    } as unknown as Cycle;

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. x    appetite: S    signal: y\n');
    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });

    // bridgeRunsDir points to non-existent path — should not throw
    expect(() =>
      gen.generate({ cycle, runsDir, bridgeRunsDir: join(baseDir, 'no-such-dir'), completedBets: [] }),
    ).not.toThrow();
  });

  it('prefers bet.runId over bridge-run lookup when both are present', () => {
    const cycleId = randomUUID();
    const betId = randomUUID();
    const directRunId = randomUUID(); // The one bet.runId points to
    const bridgeRunId = randomUUID(); // The one the bridge-run file points to

    // Create both run directories with different observations
    const directRunDir = join(runsDir, directRunId);
    mkdirSync(directRunDir, { recursive: true });
    writeObsFile(directRunDir, [makeObs('friction', 'From direct runId')]);

    const bridgeRunDir = join(runsDir, bridgeRunId);
    mkdirSync(bridgeRunDir, { recursive: true });
    writeObsFile(bridgeRunDir, [makeObs('gap', 'From bridge-run fallback')]);

    // Bridge-run file maps betId → bridgeRunId
    writeFileSync(
      join(bridgeRunsDir, `${bridgeRunId}.json`),
      JSON.stringify({ cycleId, betId, runId: bridgeRunId, status: 'complete' }),
      'utf-8',
    );

    const cycle = {
      id: cycleId,
      name: 'Test Cycle',
      state: 'complete' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bets: [
        {
          id: betId,
          description: 'Bet with explicit runId',
          appetite: 20,
          outcome: 'complete' as const,
          issueRefs: [],
          runId: directRunId, // bet.runId is set — should take priority
        },
      ],
      pipelineMappings: [],
      budget: {},
    } as unknown as Cycle;

    const mockClaude = vi.fn().mockReturnValue('=== Next Keiko Proposals ===\n\nRecommended bets (ranked):\n  1. x    appetite: S    signal: y\n');
    const gen = new NextKeikoProposalGenerator({ invokeClaude: mockClaude });

    const result = gen.generate({ cycle, runsDir, bridgeRunsDir, completedBets: [] });
    // Should read from directRunId only (friction) — NOT from bridgeRunId (gap)
    expect(result.observationCounts.friction).toBe(1);
    expect(result.observationCounts.gap).toBe(0);
    expect(result.observationCounts.total).toBe(1);
  });
});
