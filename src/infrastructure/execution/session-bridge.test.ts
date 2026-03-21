import { join } from 'node:path';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { SessionExecutionBridge } from './session-bridge.js';
import type { AgentCompletionResult } from '@domain/ports/session-bridge.js';
import { CycleSchema } from '@domain/types/cycle.js';
import { RunSchema } from '@domain/types/run-state.js';
import * as sessionContext from '@shared/lib/session-context.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createTestDir(): string {
  const dir = join(tmpdir(), `kata-bridge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createCycle(kataDir: string, overrides: Partial<{ id: string; name: string; state: string; bets: unknown[] }> = {}): ReturnType<typeof CycleSchema.parse> {
  const id = overrides.id ?? randomUUID();
  const now = new Date().toISOString();
  const cycle = CycleSchema.parse({
    id,
    name: overrides.name ?? 'Test Cycle',
    budget: { tokenBudget: 100000 },
    bets: overrides.bets ?? [
      {
        id: randomUUID(),
        description: 'Fix the login bug',
        appetite: 30,
        outcome: 'pending',
      },
      {
        id: randomUUID(),
        description: 'Add search feature',
        appetite: 40,
        outcome: 'pending',
      },
    ],
    state: overrides.state ?? 'active',
    createdAt: now,
    updatedAt: now,
  });

  const cyclesDir = join(kataDir, 'cycles');
  mkdirSync(cyclesDir, { recursive: true });
  writeFileSync(join(cyclesDir, `${id}.json`), JSON.stringify(cycle, null, 2));

  return cycle;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionExecutionBridge', () => {
  let kataDir: string;

  beforeEach(() => {
    kataDir = createTestDir();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(kataDir, { recursive: true, force: true });
  });

  describe('prepare()', () => {
    it('should prepare a run for a bet in an active cycle', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      expect(prepared.runId).toBeTruthy();
      expect(prepared.betId).toBe(betId);
      expect(prepared.betName).toBe('Fix the login bug');
      expect(prepared.cycleId).toBe(cycle.id);
      expect(prepared.cycleName).toBe('Test Cycle');
      expect(prepared.kataDir).toBe(kataDir);
      expect(prepared.stages).toEqual(['research', 'plan', 'build', 'review']);
      expect(prepared.isolation).toBe('worktree'); // build stage → worktree
      expect(prepared.startedAt).toBeTruthy();
      // agentContext is NOT baked in at prepare time (#243 — late-bind)
      expect((prepared as Record<string, unknown>).agentContext).toBeUndefined();
    });

    it('should write bridge-run metadata', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      expect(existsSync(metaPath)).toBe(true);

      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.status).toBe('in-progress');
      expect(meta.betId).toBe(betId);
      expect(meta.cycleId).toBe(cycle.id);
    });

    it('should persist canonical agent attribution when prepare() receives an agent ID', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const agentId = randomUUID();
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId, agentId);

      expect(prepared.agentId).toBe(agentId);
      expect(prepared.katakaId).toBe(agentId);

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.agentId).toBe(agentId);
      expect(meta.katakaId).toBe(agentId);

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.agentId).toBe(agentId);
      expect(run.katakaId).toBe(agentId);
    });

    it('should build manifest prompt and metadata with cycle ID fallback when the cycle name is absent', () => {
      const cycle = createCycle(kataDir);
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const stored = JSON.parse(readFileSync(cyclePath, 'utf-8')) as Record<string, unknown>;
      delete stored['name'];
      writeFileSync(cyclePath, JSON.stringify(stored, null, 2));

      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      expect(prepared.manifest.stageType).toBe('research,plan,build,review');
      expect(prepared.manifest.prompt).toContain(`Cycle "${cycle.id}"`);
      expect(prepared.manifest.prompt).toContain(`run ${prepared.runId}`);
      expect(prepared.manifest.context.metadata).toEqual({
        betId: cycle.bets[0]!.id,
        cycleId: cycle.id,
        cycleName: cycle.id,
        runId: prepared.runId,
        adapter: 'claude-native',
      });
      expect(prepared.manifest.artifacts).toEqual([]);
      expect(prepared.manifest.learnings).toEqual([]);
    });

    it('should backfill bet.runId in cycle JSON after prepare() (#337)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      // The cycle JSON should now have the runId on the bet
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      const updatedBet = updatedCycle.bets.find((b) => b.id === betId);
      expect(updatedBet?.runId).toBe(prepared.runId);
    });

    it('should not affect other bets when backfilling runId (#337)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const otherBetId = cycle.bets[1]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepare(betId);

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      const otherBet = updatedCycle.bets.find((b) => b.id === otherBetId);
      // The other bet should still have no runId
      expect(otherBet?.runId).toBeUndefined();
    });

    it('prepareCycle() should backfill runId on all bet records (#337)', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));

      expect(prepared.preparedRuns).toHaveLength(2);
      for (const run of prepared.preparedRuns) {
        const updatedBet = updatedCycle.bets.find((b) => b.id === run.betId);
        expect(updatedBet?.runId).toBe(run.runId);
      }
    });

    it('should throw for unknown bet ID', () => {
      createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepare(randomUUID())).toThrow(/No cycle found/);
    });

    it('should throw when no cycles exist', () => {
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepare(randomUUID())).toThrow(/No cycle found containing bet/);
    });

    it('should use ad-hoc stages from bet kata assignment', () => {
      const betId = randomUUID();
      createCycle(kataDir, {
        bets: [{
          id: betId,
          description: 'Research-only bet',
          appetite: 15,
          outcome: 'pending',
          kata: { type: 'ad-hoc', stages: ['research'] },
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      expect(prepared.stages).toEqual(['research']);
      expect(prepared.isolation).toBe('shared'); // no build stage → shared
    });

    it('should write run.json to runs/<run-id>/run.json (#234)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      expect(existsSync(runJsonPath)).toBe(true);

      const raw = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
      // Must parse against RunSchema without throwing
      const run = RunSchema.parse(raw);
      expect(run.id).toBe(prepared.runId);
      expect(run.betId).toBe(betId);
      expect(run.cycleId).toBe(cycle.id);
      expect(run.betPrompt).toBe('Fix the login bug');
      expect(run.stageSequence).toEqual(['research', 'plan', 'build', 'review']);
      expect(run.currentStage).toBe('research');
    });

    it('run.json status should be "running", not "in-progress" (#234)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const raw = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
      expect(raw.status).toBe('running');
    });

    it('run.json stageSequence should reflect ad-hoc stages (#234)', () => {
      const betId = randomUUID();
      createCycle(kataDir, {
        bets: [{
          id: betId,
          description: 'Research-only bet',
          appetite: 15,
          outcome: 'pending',
          kata: { type: 'ad-hoc', stages: ['research'] },
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.stageSequence).toEqual(['research']);
      expect(run.currentStage).toBe('research');
    });

    it('run.json falls back to the default stage sequence when all ad-hoc stages are invalid', () => {
      const betId = randomUUID();
      mkdirSync(join(kataDir, 'katas'), { recursive: true });
      writeFileSync(
        join(kataDir, 'katas', 'broken-sequence.json'),
        JSON.stringify({ stages: ['custom-stage'] }, null, 2),
      );
      createCycle(kataDir, {
        bets: [{
          id: betId,
          description: 'Custom-stage bet',
          appetite: 15,
          outcome: 'pending',
          kata: { type: 'named', pattern: 'broken-sequence' },
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.stageSequence).toEqual(['research', 'plan', 'build', 'review']);
      expect(run.currentStage).toBe('research');
    });

    it('run.json should be discoverable by listActiveRuns (#234)', () => {
      // Simulate what kata watch does: list run directories, read run.json,
      // filter by status === "running". Bridge-prepared runs must be visible.
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);

      const runsDir = join(kataDir, 'runs');
      const runDirs = readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(runDirs.length).toBe(2); // one per bet

      const activeRuns = runDirs.filter((runId) => {
        const runJsonPath = join(runsDir, runId, 'run.json');
        if (!existsSync(runJsonPath)) return false;
        try {
          const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
          return run.status === 'running';
        } catch {
          return false;
        }
      });

      expect(activeRuns.length).toBe(2);
    });

    it('run.json stage directories should be created for each stage (#234)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      // createRunTree creates stage directories with state.json files
      const stagesDir = join(kataDir, 'runs', prepared.runId, 'stages');
      expect(existsSync(stagesDir)).toBe(true);
      for (const stage of ['research', 'plan', 'build', 'review']) {
        const stateJson = join(stagesDir, stage, 'state.json');
        expect(existsSync(stateJson)).toBe(true);
      }
    });

    it('should write katakaId to run.json when provided (#kataka-attribution)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);
      const katakaId = randomUUID();

      const prepared = bridge.prepare(betId, katakaId);

      // katakaId should be on the PreparedRun
      expect(prepared.katakaId).toBe(katakaId);

      // katakaId should be written to run.json
      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.katakaId).toBe(katakaId);
    });

    it('should write katakaId to bridge-run metadata when provided (#kataka-attribution)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);
      const katakaId = randomUUID();

      const prepared = bridge.prepare(betId, katakaId);

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.katakaId).toBe(katakaId);
    });

    it('should omit katakaId from run.json when not provided (#kataka-attribution)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(betId);

      // katakaId should be absent when not provided
      expect(prepared.katakaId).toBeUndefined();

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.katakaId).toBeUndefined();
    });

    it('prepareCycle() should propagate katakaId to all prepared runs (#kataka-attribution)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const katakaId = randomUUID();

      const prepared = bridge.prepareCycle(cycle.id, katakaId);

      expect(prepared.preparedRuns).toHaveLength(2);
      for (const run of prepared.preparedRuns) {
        expect(run.katakaId).toBe(katakaId);
        const runJsonPath = join(kataDir, 'runs', run.runId, 'run.json');
        const runJson = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
        expect(runJson.katakaId).toBe(katakaId);
      }
    });
  });

  describe('formatAgentContext()', () => {
    it('should generate a well-structured agent context block', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const context = bridge.formatAgentContext(prepared);

      expect(context).toContain('## Kata Run Context');
      expect(context).toContain(`- **Run ID**: ${prepared.runId}`);
      expect(context).toContain(`- **Bet ID**: ${prepared.betId}`);
      expect(context).toContain(`- **Kata dir**: ${kataDir}`);
      expect(context).toContain('### Record as you work');
      // kansatsu: --cwd pre-filled + positional type + content + --run flag
      expect(context).toContain(`kata --cwd `);
      expect(context).toContain(`kansatsu record <type> "..." --run ${prepared.runId}`);
      // observation types and quality guide present
      expect(context).toContain('**Observation types**');
      expect(context).toContain('**Friction taxonomy**');
      expect(context).toContain('**Quality bar**');
      // maki: --cwd pre-filled + positional name + path + --run flag
      expect(context).toContain(`maki record <name> <path> --run ${prepared.runId}`);
      // kime: --cwd pre-filled + named flags + --run flag
      expect(context).toContain(`kime record --decision "..." --rationale "..." --run ${prepared.runId}`);
      // friction urgency block
      expect(context).toContain('**FRICTION — record immediately, before continuing:**');
      expect(context).toContain('record it as friction BEFORE resuming work');
      // concrete friction example with full command
      expect(context).toContain(`kansatsu record friction`);
      expect(context).toContain('--taxonomy tool-mismatch');
      // pre-reporting checklist in "When you're done"
      expect(context).toContain("### When you're done");
      expect(context).toContain('did you record all friction events?');
      expect(context).toContain('Do NOT close the run yourself');
    });

    it('should include git workflow instructions (#237)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const context = bridge.formatAgentContext(prepared);

      expect(context).toContain('### Git workflow');
      expect(context).toContain('NEVER commit directly to the `main` branch');
      expect(context).toContain('git checkout -b');
      expect(context).toContain(`keiko-${prepared.runId.slice(0, 8)}/`);
      expect(context).toContain('The sensei will merge');
    });

    it('should include KATA_RUN_ID export instruction for hook detection (#237)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const context = bridge.formatAgentContext(prepared);

      expect(context).toContain(`export KATA_RUN_ID=${prepared.runId}`);
    });

    it('clarifies kime vs kansatsu for decision recording (#347)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const context = bridge.formatAgentContext(prepared);

      // kime vs kansatsu guidance must be present
      expect(context).toContain('kime vs kansatsu');
      // kime is the primary belt metric
      expect(context).toContain('Belt advancement tracks these directly');
      // kansatsu decision/outcome is the secondary signal
      expect(context).toContain('secondary signal');
      // clear recommendation to prefer kime
      expect(context).toContain('Prefer `kime record`');
    });

    it('should slugify bet name in branch suggestion (#237)', () => {
      const betId = randomUUID();
      createCycle(kataDir, {
        bets: [{
          id: betId,
          description: 'Fix the Login Bug #42',
          appetite: 30,
          outcome: 'pending',
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(betId);

      const context = bridge.formatAgentContext(prepared);

      // Bet name should be slugified: spaces → dashes, special chars removed, lowercase
      expect(context).toContain('fix-the-login-bug-42');
    });

    it('includes the non-worktree launch note and falls back to the prepared kata dir', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);
      const launchSpy = vi.spyOn(sessionContext, 'detectLaunchMode').mockReturnValue('agent');
      const contextSpy = vi.spyOn(sessionContext, 'detectSessionContext').mockReturnValue({
        kataInitialized: false,
        kataDir: null,
        inWorktree: false,
        activeCycle: null,
        launchMode: 'agent',
      });

      try {
        const context = bridge.formatAgentContext(prepared);

        expect(context).toContain('- **Launch mode**: agent');
        expect(context).toContain('- **In worktree**: no');
        expect(context).toContain(`- **Kata dir resolved**: ${prepared.kataDir}`);
        expect(context).toContain('outside a git worktree');
      } finally {
        launchSpy.mockRestore();
        contextSpy.mockRestore();
      }
    });

    it('omits the non-worktree launch note when already inside a worktree', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);
      const launchSpy = vi.spyOn(sessionContext, 'detectLaunchMode').mockReturnValue('interactive');
      const contextSpy = vi.spyOn(sessionContext, 'detectSessionContext').mockReturnValue({
        kataInitialized: true,
        kataDir,
        inWorktree: true,
        activeCycle: null,
        launchMode: 'interactive',
      });

      try {
        const context = bridge.formatAgentContext(prepared);

        expect(context).toContain('- **In worktree**: yes');
        expect(context).not.toContain('outside a git worktree');
      } finally {
        launchSpy.mockRestore();
        contextSpy.mockRestore();
      }
    });
  });

  describe('getAgentContext()', () => {
    it('should return a non-empty agent context string with the run ID embedded (#243)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      // getAgentContext() reads stored bridge-run metadata and generates fresh context
      const context = bridge.getAgentContext(prepared.runId);

      expect(context).toBeTruthy();
      expect(context).toContain('## Kata Run Context');
      expect(context).toContain(prepared.runId);
      expect(context).toContain(prepared.betId);
      expect(context).toContain(kataDir);
      expect(context).toContain('### Record as you work');
    });

    it('should produce equivalent output to formatAgentContext() (#243)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const viaGet = bridge.getAgentContext(prepared.runId);
      const viaDirect = bridge.formatAgentContext(prepared);

      // Both should contain the same key identifiers
      expect(viaGet).toContain(prepared.runId);
      expect(viaGet).toContain(prepared.betId);
      expect(viaDirect).toContain(prepared.runId);
      expect(viaDirect).toContain(prepared.betId);
    });

    it('should throw for unknown run ID (#243)', () => {
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.getAgentContext(randomUUID())).toThrow(/No bridge run found/);
    });

    it.each([
      { success: true as const, terminalState: 'complete' },
      { success: false as const, terminalState: 'failed' },
    ])('should reject dispatch for %s bridge runs', ({ success, terminalState }) => {
      const cycle = createCycle(kataDir, {
        bets: [{
          id: randomUUID(),
          description: 'Terminal bet',
          appetite: 15,
          outcome: 'pending',
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success });

      expect(() => bridge.getAgentContext(prepared.runId)).toThrow(
        `Run "${prepared.runId}" is in terminal state "${terminalState}" and cannot be dispatched.`,
      );
    });

    it('agentContext should NOT be present on PreparedRun returned by prepare() (#243)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepare(cycle.bets[0]!.id);

      // Confirm agentContext is not a property of the returned object at all
      expect(Object.prototype.hasOwnProperty.call(prepared, 'agentContext')).toBe(false);
    });
  });

  describe('complete()', () => {
    it('should complete a run and write a history entry', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, {
        success: true,
        artifacts: [{ name: 'fix.ts', path: 'src/fix.ts' }],
        notes: 'Fixed the bug',
      });

      // Check bridge-run metadata updated
      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.status).toBe('complete');
      expect(meta.completedAt).toBeTruthy();

      // Check history entry written
      const historyDir = join(kataDir, 'history');
      expect(existsSync(historyDir)).toBe(true);
      const historyFiles = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
      expect(historyFiles.length).toBe(1);

      const entry = JSON.parse(readFileSync(join(historyDir, historyFiles[0]), 'utf-8'));
      expect(entry.adapter).toBe('claude-native');
      expect(entry.cycleId).toBe(cycle.id);
      expect(entry.betId).toBe(cycle.bets[0]!.id);
      expect(entry.artifactNames).toEqual(['fix.ts']);
    });

    it('should record the exact completion duration in the history entry', () => {
      vi.useFakeTimers();
      const startedAt = new Date('2026-03-12T12:00:00.000Z');
      vi.setSystemTime(startedAt);

      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      vi.setSystemTime(new Date(startedAt.getTime() + 90_000));
      bridge.complete(prepared.runId, { success: true });

      const historyDir = join(kataDir, 'history');
      const [file] = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
      const entry = JSON.parse(readFileSync(join(historyDir, file!), 'utf-8'));
      expect(entry.durationMs).toBe(90_000);
    });

    it('should mark failed runs', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: false, notes: 'Build failed' });

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.status).toBe('failed');
    });

    it('should throw for unknown run ID', () => {
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.complete(randomUUID(), { success: true })).toThrow(/No bridge run found/);
    });

    it('should update bet outcome to "complete" in cycle JSON when success is true (#216)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(betId);

      bridge.complete(prepared.runId, { success: true });

      // Read cycle JSON directly and verify bet outcome was updated
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = JSON.parse(readFileSync(cyclePath, 'utf-8'));
      const updatedBet = updatedCycle.bets.find((b: { id: string }) => b.id === betId);
      expect(updatedBet.outcome).toBe('complete');
    });

    it('should update bet outcome to "partial" in cycle JSON when success is false (#216)', () => {
      const cycle = createCycle(kataDir);
      const betId = cycle.bets[0]!.id;
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(betId);

      bridge.complete(prepared.runId, { success: false, notes: 'Build failed' });

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = JSON.parse(readFileSync(cyclePath, 'utf-8'));
      const updatedBet = updatedCycle.bets.find((b: { id: string }) => b.id === betId);
      expect(updatedBet.outcome).toBe('partial');
    });

    it('should not overwrite a manually-set bet outcome (#216)', () => {
      // If a user already ran kata cooldown and manually set the outcome,
      // completing the bridge run should NOT revert it.
      const betId = randomUUID();
      const cycle = createCycle(kataDir, {
        bets: [{
          id: betId,
          description: 'Already resolved bet',
          appetite: 30,
          outcome: 'abandoned', // manually set before bridge complete()
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(betId);

      bridge.complete(prepared.runId, { success: true });

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = JSON.parse(readFileSync(cyclePath, 'utf-8'));
      const updatedBet = updatedCycle.bets.find((b: { id: string }) => b.id === betId);
      // outcome should remain 'abandoned', not overwritten to 'complete'
      expect(updatedBet.outcome).toBe('abandoned');
    });

    it('should leave other bets untouched in cycle JSON (#216)', () => {
      const cycle = createCycle(kataDir);
      const bet1Id = cycle.bets[0]!.id;
      const bet2Id = cycle.bets[1]!.id;
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(bet1Id);

      bridge.complete(prepared.runId, { success: true });

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = JSON.parse(readFileSync(cyclePath, 'utf-8'));
      const bet1 = updatedCycle.bets.find((b: { id: string }) => b.id === bet1Id);
      const bet2 = updatedCycle.bets.find((b: { id: string }) => b.id === bet2Id);
      expect(bet1.outcome).toBe('complete');
      // Bet 2 was not completed — should remain pending
      expect(bet2.outcome).toBe('pending');
    });

    it('should update run.json status to "completed" on success (#254)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: true });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.status).toBe('completed');
      expect(run.completedAt).toBeTruthy();
    });

    it('should update run.json status to "failed" on failure (#254)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: false, notes: 'Build failed' });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.status).toBe('failed');
      expect(run.completedAt).toBeTruthy();
    });

    it('completed run should NOT appear in listActiveRuns (kata watch drops off) (#254)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      // Before complete: run should be visible as running
      const runsDir = join(kataDir, 'runs');
      const activeBeforeComplete = readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => {
          try {
            const run = RunSchema.parse(JSON.parse(readFileSync(join(runsDir, e.name, 'run.json'), 'utf-8')));
            return run.status === 'running';
          } catch { return false; }
        });
      expect(activeBeforeComplete.length).toBe(1);

      bridge.complete(prepared.runId, { success: true });

      // After complete: no running runs remain
      const activeAfterComplete = readdirSync(runsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .filter((e) => {
          try {
            const run = RunSchema.parse(JSON.parse(readFileSync(join(runsDir, e.name, 'run.json'), 'utf-8')));
            return run.status === 'running';
          } catch { return false; }
        });
      expect(activeAfterComplete.length).toBe(0);
    });

    it('should record token usage in history entry', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, {
        success: true,
        tokenUsage: { inputTokens: 5000, outputTokens: 2000, total: 7000 },
      });

      const historyDir = join(kataDir, 'history');
      const historyFiles = readdirSync(historyDir).filter((f) => f.endsWith('.json'));
      const entry = JSON.parse(readFileSync(join(historyDir, historyFiles[0]), 'utf-8'));
      expect(entry.tokenUsage.total).toBe(7000);
      expect(entry.tokenUsage.inputTokens).toBe(5000);
      expect(entry.tokenUsage.outputTokens).toBe(2000);
    });

    it('should persist tokenUsage to bridge-run metadata (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, {
        success: true,
        tokenUsage: { inputTokens: 3000, outputTokens: 1500, total: 4500 },
      });

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.tokenUsage).toBeDefined();
      expect(meta.tokenUsage.inputTokens).toBe(3000);
      expect(meta.tokenUsage.outputTokens).toBe(1500);
      expect(meta.tokenUsage.totalTokens).toBe(4500);
    });

    it('should not write tokenUsage to bridge-run metadata when not provided (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: true });

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      expect(meta.tokenUsage).toBeUndefined();
    });

    it('should update run.json status to "completed" on success (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: true });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.status).toBe('completed');
      expect(run.completedAt).toBeTruthy();
    });

    it('should update run.json status to "failed" on failure (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: false });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.status).toBe('failed');
    });

    it('should write tokenUsage to run.json when tokens are provided (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, {
        success: true,
        tokenUsage: { inputTokens: 8000, outputTokens: 3000, total: 11000 },
      });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.tokenUsage).toBeDefined();
      expect(run.tokenUsage!.inputTokens).toBe(8000);
      expect(run.tokenUsage!.outputTokens).toBe(3000);
      expect(run.tokenUsage!.totalTokens).toBe(11000);
    });

    it('should not write tokenUsage to run.json when not provided (#312)', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      bridge.complete(prepared.runId, { success: true });

      const runJsonPath = join(kataDir, 'runs', prepared.runId, 'run.json');
      const run = RunSchema.parse(JSON.parse(readFileSync(runJsonPath, 'utf-8')));
      expect(run.tokenUsage).toBeUndefined();
    });
  });

  describe('prepareCycle()', () => {
    it('should prepare all pending bets', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id);

      expect(result.cycleId).toBe(cycle.id);
      expect(result.cycleName).toBe('Test Cycle');
      expect(result.preparedRuns.length).toBe(2);
      expect(result.preparedRuns[0]!.betName).toBe('Fix the login bug');
      expect(result.preparedRuns[1]!.betName).toBe('Add search feature');
    });

    it('should skip non-pending bets', () => {
      const cycle = createCycle(kataDir, {
        bets: [
          { id: randomUUID(), description: 'Done bet', appetite: 30, outcome: 'complete' },
          { id: randomUUID(), description: 'Pending bet', appetite: 40, outcome: 'pending' },
        ],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id);
      expect(result.preparedRuns.length).toBe(1);
      expect(result.preparedRuns[0]!.betName).toBe('Pending bet');
    });

    it('should throw when no pending bets remain', () => {
      const cycle = createCycle(kataDir, {
        bets: [
          { id: randomUUID(), description: 'Done', appetite: 100, outcome: 'complete' },
        ],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepareCycle(cycle.id)).toThrow(/No pending bets/);
    });

    it('should mention the cycle ID when no pending bets remain and the cycle has no name', () => {
      const cycle = createCycle(kataDir, {
        bets: [
          { id: randomUUID(), description: 'Done', appetite: 100, outcome: 'complete' },
        ],
      });
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const stored = JSON.parse(readFileSync(cyclePath, 'utf-8')) as Record<string, unknown>;
      delete stored['name'];
      writeFileSync(cyclePath, JSON.stringify(stored, null, 2));
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepareCycle(cycle.id)).toThrow(cycle.id);
    });

    it('should reject preparing a planning cycle without a name', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const stored = JSON.parse(readFileSync(cyclePath, 'utf-8')) as Record<string, unknown>;
      delete stored['name'];
      writeFileSync(cyclePath, JSON.stringify(stored, null, 2));
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepareCycle(cycle.id)).toThrow(/must have a non-empty name/);
    });

    it('should resolve cycle by name', () => {
      const cycle = createCycle(kataDir, { name: 'My Cycle' });
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id);
      expect(result.cycleName).toBe('My Cycle');
    });

    it('should transition cycle state from planning to active (#322)', () => {
      // Regression test: prepareCycle() must write state="active" to the cycle
      // JSON so that `kata cycle status` shows "active" after staged launch.
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);

      // Read cycle JSON directly to verify the state was persisted
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      expect(updatedCycle.state).toBe('active');
    });

    it('should write name to cycle record when name param provided (#346)', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id, undefined, 'Keiko 10 — Belt & Self-Improvement');

      expect(result.cycleName).toBe('Keiko 10 — Belt & Self-Improvement');

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      expect(updatedCycle.name).toBe('Keiko 10 — Belt & Self-Improvement');
    });

    it('should use name param in cycleName overriding existing name (#346)', () => {
      const cycle = createCycle(kataDir, { state: 'planning', name: 'Old Name' });
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id, undefined, 'New Name At Launch');
      expect(result.cycleName).toBe('New Name At Launch');
    });

    it('should preserve existing cycle name when name param not provided (#346)', () => {
      const cycle = createCycle(kataDir, { name: 'My Cycle' });
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      expect(updatedCycle.name).toBe('My Cycle');
    });

    it('should reuse existing in-progress bridge runs when the same cycle is prepared twice', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      const first = bridge.prepareCycle(cycle.id);
      const second = bridge.prepareCycle(cycle.id);

      expect(second.preparedRuns.map((run) => run.runId)).toEqual(
        first.preparedRuns.map((run) => run.runId),
      );

      const bridgeRunFiles = readdirSync(join(kataDir, 'bridge-runs')).filter((file) => file.endsWith('.json'));
      expect(bridgeRunFiles).toHaveLength(cycle.bets.length);
    });

    it('should reuse an in-progress bridge run by betId when the cycle bet lost its stored runId', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      const first = bridge.prepareCycle(cycle.id);
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const persistedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      delete persistedCycle.bets[0]!.runId;
      writeFileSync(cyclePath, JSON.stringify(persistedCycle, null, 2));

      const second = bridge.prepareCycle(cycle.id);

      expect(second.preparedRuns[0]!.betId).toBe(first.preparedRuns[0]!.betId);
      expect(second.preparedRuns[0]!.runId).toBe(first.preparedRuns[0]!.runId);
    });

    it('should create a fresh run when a pending bet only has terminal bridge-run metadata', () => {
      const cycle = createCycle(kataDir, {
        state: 'planning',
        bets: [{
          id: randomUUID(),
          description: 'Retryable bet',
          appetite: 20,
          outcome: 'pending',
        }],
      });
      const bridge = new SessionExecutionBridge(kataDir);

      const first = bridge.prepareCycle(cycle.id);
      bridge.complete(first.preparedRuns[0]!.runId, { success: false, notes: 'retry this one' });

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const persistedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      persistedCycle.bets[0]!.outcome = 'pending';
      persistedCycle.updatedAt = new Date().toISOString();
      writeFileSync(cyclePath, JSON.stringify(persistedCycle, null, 2));

      const second = bridge.prepareCycle(cycle.id);

      expect(second.preparedRuns[0]!.runId).not.toBe(first.preparedRuns[0]!.runId);
    });

    it('should update cycle and bridge metadata names when an active cycle is re-prepared with a new name', () => {
      const cycle = createCycle(kataDir, { state: 'planning', name: 'Original Name' });
      const bridge = new SessionExecutionBridge(kataDir);

      const first = bridge.prepareCycle(cycle.id);
      const second = bridge.prepareCycle(cycle.id, undefined, '  Renamed Cycle  ');

      expect(second.preparedRuns.map((run) => run.runId)).toEqual(
        first.preparedRuns.map((run) => run.runId),
      );
      expect(second.cycleName).toBe('Renamed Cycle');

      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = CycleSchema.parse(JSON.parse(readFileSync(cyclePath, 'utf-8')));
      expect(updatedCycle.name).toBe('Renamed Cycle');

      const bridgeMeta = JSON.parse(readFileSync(join(kataDir, 'bridge-runs', `${first.preparedRuns[0]!.runId}.json`), 'utf-8'));
      expect(bridgeMeta.cycleName).toBe('Renamed Cycle');
    });

    it('should backfill agent attribution onto existing prepared runs when a later prepare provides agentId', () => {
      const cycle = createCycle(kataDir, { state: 'planning' });
      const bridge = new SessionExecutionBridge(kataDir);

      const first = bridge.prepareCycle(cycle.id);
      const agentId = randomUUID();
      const second = bridge.prepareCycle(cycle.id, agentId);

      expect(second.preparedRuns.map((run) => run.runId)).toEqual(
        first.preparedRuns.map((run) => run.runId),
      );
      expect(second.preparedRuns.every((run) => run.agentId === agentId)).toBe(true);

      const bridgeMeta = JSON.parse(readFileSync(join(kataDir, 'bridge-runs', `${first.preparedRuns[0]!.runId}.json`), 'utf-8'));
      expect(bridgeMeta.agentId).toBe(agentId);
      expect(bridgeMeta.katakaId).toBe(agentId);

      const runJson = RunSchema.parse(JSON.parse(readFileSync(join(kataDir, 'runs', first.preparedRuns[0]!.runId, 'run.json'), 'utf-8')));
      expect(runJson.agentId).toBe(agentId);
      expect(runJson.katakaId).toBe(agentId);
    });
  });

  describe('getCycleStatus()', () => {
    it('should return status for a cycle with no runs', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const status = bridge.getCycleStatus(cycle.id);

      expect(status.cycleId).toBe(cycle.id);
      expect(status.cycleName).toBe('Test Cycle');
      expect(status.bets.length).toBe(2);
      expect(status.bets[0]!.status).toBe('pending');
      expect(status.bets[1]!.status).toBe('pending');
      expect(status.bets.every((bet) => bet.runId === '')).toBe(true);
      expect(status.budgetUsed).toEqual({ percent: 0, tokenEstimate: 0 });
    });

    it('should return status after preparing runs', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);
      const status = bridge.getCycleStatus(cycle.id);

      expect(status.bets.length).toBe(2);
      expect(status.bets.every((b) => b.status === 'in-progress')).toBe(true);
      expect(status.bets.every((b) => b.runId !== '')).toBe(true);
    });

    it('should count observations and artifacts from run data', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);
      const runId = prepared.preparedRuns[0]!.runId;

      // Write some fake observation data
      const runDir = join(kataDir, 'runs', runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(
        join(runDir, 'observations.jsonl'),
        '{"note":"obs1"}\n{"note":"obs2"}\n{"note":"obs3"}\n',
      );
      writeFileSync(
        join(runDir, 'artifacts.jsonl'),
        '{"name":"fix.ts"}\n',
      );

      const status = bridge.getCycleStatus(cycle.id);
      const bet1Status = status.bets.find((b) => b.runId === runId);
      expect(bet1Status!.kansatsuCount).toBe(3);
      expect(bet1Status!.artifactCount).toBe(1);
    });

    it('should include stage-level observations and decisions in cycle status counts', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);
      const runId = prepared.preparedRuns[0]!.runId;
      const runDir = join(kataDir, 'runs', runId);
      const stageDir = join(runDir, 'stages', 'build');
      mkdirSync(stageDir, { recursive: true });

      writeFileSync(join(runDir, 'observations.jsonl'), '{"note":"run obs"}\n');
      writeFileSync(join(stageDir, 'observations.jsonl'), '{"note":"stage obs 1"}\n{"note":"stage obs 2"}\n');
      writeFileSync(join(stageDir, 'decisions.jsonl'), '{"decision":"ship"}\n{"decision":"refactor"}\n');

      const status = bridge.getCycleStatus(cycle.id);
      const betStatus = status.bets.find((bet) => bet.runId === runId);

      expect(betStatus!.kansatsuCount).toBe(3);
      expect(betStatus!.decisionCount).toBe(2);
    });

    it('should ignore unrelated bridge-run files when listing cycle status', () => {
      const cycle = createCycle(kataDir);
      const otherCycle = createCycle(kataDir, { name: 'Other Cycle' });
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);
      bridge.prepareCycle(otherCycle.id);
      writeFileSync(join(kataDir, 'bridge-runs', 'notes.txt'), 'ignore me');

      const status = bridge.getCycleStatus(cycle.id);

      expect(status.bets).toHaveLength(cycle.bets.length);
      expect(status.bets.every((bet) => cycle.bets.some((cycleBet) => cycleBet.id === bet.betId))).toBe(true);
    });

    it('should estimate budget usage from history', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      // Write a fake history entry for this cycle
      const historyDir = join(kataDir, 'history');
      mkdirSync(historyDir, { recursive: true });
      writeFileSync(
        join(historyDir, `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'build',
          stageIndex: 0,
          adapter: 'claude-native',
          cycleId: cycle.id,
          tokenUsage: { inputTokens: 20000, outputTokens: 10000, total: 30000, cacheCreationTokens: 0, cacheReadTokens: 0 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );

      const status = bridge.getCycleStatus(cycle.id);
      expect(status.budgetUsed).not.toBeNull();
      expect(status.budgetUsed!.tokenEstimate).toBe(30000);
      expect(status.budgetUsed!.percent).toBe(30); // 30000/100000 * 100
    });

    it('should ignore unrelated and malformed history entries when estimating budget usage', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const historyDir = join(kataDir, 'history');
      mkdirSync(historyDir, { recursive: true });

      writeFileSync(
        join(historyDir, `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'build',
          stageIndex: 0,
          adapter: 'claude-native',
          cycleId: cycle.id,
          tokenUsage: { total: 15000 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );
      writeFileSync(
        join(historyDir, `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'review',
          stageIndex: 1,
          adapter: 'claude-native',
          cycleId: cycle.id,
          tokenUsage: { total: 5000 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );
      writeFileSync(
        join(historyDir, `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'build',
          stageIndex: 0,
          adapter: 'claude-native',
          cycleId: randomUUID(),
          tokenUsage: { total: 99999 },
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );
      writeFileSync(
        join(historyDir, `${randomUUID()}.json`),
        JSON.stringify({
          id: randomUUID(),
          pipelineId: randomUUID(),
          stageType: 'build',
          stageIndex: 0,
          adapter: 'claude-native',
          cycleId: cycle.id,
          tokenUsage: {},
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }),
      );
      writeFileSync(join(historyDir, `${randomUUID()}.json`), '{ broken json ');

      const status = bridge.getCycleStatus(cycle.id);
      expect(status.budgetUsed).toEqual({ percent: 20, tokenEstimate: 20000 });
    });

    it.each([
      { elapsedMs: 45_000, expected: '45s' },
      { elapsedMs: 5 * 60_000, expected: '5m' },
      { elapsedMs: ((2 * 60) + 5) * 60_000, expected: '2h 5m' },
    ])('should format elapsed duration as $expected', ({ elapsedMs, expected }) => {
      vi.useFakeTimers();
      const now = new Date('2026-03-12T12:00:00.000Z');
      vi.setSystemTime(now);

      const cycle = createCycle(kataDir, {
        bets: [
          {
            id: randomUUID(),
            description: 'One timed bet',
            appetite: 30,
            outcome: 'pending',
          },
        ],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.startedAt = new Date(now.getTime() - elapsedMs).toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      const status = bridge.getCycleStatus(cycle.id);
      expect(status.elapsed).toBe(expected);
    });

    it('should compute bet durationMs from completed bridge-run metadata', () => {
      const cycle = createCycle(kataDir, {
        bets: [
          {
            id: randomUUID(),
            description: 'Completed bet',
            appetite: 30,
            outcome: 'pending',
          },
        ],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepare(cycle.bets[0]!.id);

      const startedAt = new Date('2026-03-12T12:00:00.000Z');
      const completedAt = new Date(startedAt.getTime() + 65_000);
      const metaPath = join(kataDir, 'bridge-runs', `${prepared.runId}.json`);
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      meta.startedAt = startedAt.toISOString();
      meta.completedAt = completedAt.toISOString();
      meta.status = 'complete';
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));

      const status = bridge.getCycleStatus(cycle.id);
      expect(status.bets).toHaveLength(1);
      expect(status.bets[0]!.durationMs).toBe(65_000);
      expect(status.bets[0]!.status).toBe('complete');
    });

    it('should prefer completedAt over startedAt for last activity and fall back to startedAt otherwise', () => {
      const cycle = createCycle(kataDir, {
        bets: [
          {
            id: randomUUID(),
            description: 'Completed bet',
            appetite: 30,
            outcome: 'pending',
          },
          {
            id: randomUUID(),
            description: 'Running bet',
            appetite: 20,
            outcome: 'pending',
          },
        ],
      });
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepareCycle(cycle.id);

      const completedMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[0]!.runId}.json`);
      const completedMeta = JSON.parse(readFileSync(completedMetaPath, 'utf-8'));
      completedMeta.startedAt = '2026-03-12T12:00:00.000Z';
      completedMeta.completedAt = '2026-03-12T12:05:00.000Z';
      completedMeta.status = 'complete';
      writeFileSync(completedMetaPath, JSON.stringify(completedMeta, null, 2));

      const runningMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[1]!.runId}.json`);
      const runningMeta = JSON.parse(readFileSync(runningMetaPath, 'utf-8'));
      runningMeta.startedAt = '2026-03-12T13:00:00.000Z';
      delete runningMeta.completedAt;
      writeFileSync(runningMetaPath, JSON.stringify(runningMeta, null, 2));

      const status = bridge.getCycleStatus(cycle.id);
      const completedBet = status.bets.find((bet) => bet.runId === prepared.preparedRuns[0]!.runId);
      const runningBet = status.bets.find((bet) => bet.runId === prepared.preparedRuns[1]!.runId);

      expect(completedBet!.lastActivity).toBe('2026-03-12T12:05:00.000Z');
      expect(runningBet!.lastActivity).toBe('2026-03-12T13:00:00.000Z');
    });

    it('uses the earliest started run when calculating cycle elapsed time', () => {
      vi.useFakeTimers();
      const now = new Date('2026-03-12T12:00:00.000Z');
      vi.setSystemTime(now);

      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepareCycle(cycle.id);

      const [firstRun, secondRun] = prepared.preparedRuns;
      const firstMetaPath = join(kataDir, 'bridge-runs', `${firstRun!.runId}.json`);
      const secondMetaPath = join(kataDir, 'bridge-runs', `${secondRun!.runId}.json`);
      const firstMeta = JSON.parse(readFileSync(firstMetaPath, 'utf-8'));
      const secondMeta = JSON.parse(readFileSync(secondMetaPath, 'utf-8'));

      firstMeta.startedAt = new Date(now.getTime() - (5 * 60_000)).toISOString();
      secondMeta.startedAt = new Date(now.getTime() - (2 * 60 * 60_000)).toISOString();
      writeFileSync(firstMetaPath, JSON.stringify(firstMeta, null, 2));
      writeFileSync(secondMetaPath, JSON.stringify(secondMeta, null, 2));

      const status = bridge.getCycleStatus(cycle.id);
      expect(status.elapsed).toBe('2h 0m');
    });
  });

  describe('completeCycle()', () => {
    it('should complete all in-progress runs', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);

      const results: Record<string, AgentCompletionResult> = {};
      for (const run of prepared.preparedRuns) {
        results[run.runId] = { success: true, notes: `Completed ${run.betName}` };
      }

      const summary = bridge.completeCycle(cycle.id, results);

      expect(summary.cycleId).toBe(cycle.id);
      expect(summary.cycleName).toBe('Test Cycle');
      expect(summary.completedBets).toBe(2);
      expect(summary.totalBets).toBe(2);
      expect(summary.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it('should aggregate token usage', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);

      const results: Record<string, AgentCompletionResult> = {
        [prepared.preparedRuns[0]!.runId]: {
          success: true,
          tokenUsage: { inputTokens: 1000, outputTokens: 500, total: 1500 },
        },
        [prepared.preparedRuns[1]!.runId]: {
          success: true,
          tokenUsage: { inputTokens: 2000, outputTokens: 1000, total: 3000 },
        },
      };

      const summary = bridge.completeCycle(cycle.id, results);

      expect(summary.tokenUsage).not.toBeNull();
      expect(summary.tokenUsage!.total).toBe(4500);
      expect(summary.tokenUsage!.inputTokens).toBe(3000);
      expect(summary.tokenUsage!.outputTokens).toBe(1500);
    });

    it('should aggregate exact duration totals and leave token usage null when no token data is provided', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-12T14:00:00.000Z'));

      try {
        const cycle = createCycle(kataDir);
        const bridge = new SessionExecutionBridge(kataDir);
        const prepared = bridge.prepareCycle(cycle.id);

        const firstMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[0]!.runId}.json`);
        const firstMeta = JSON.parse(readFileSync(firstMetaPath, 'utf-8'));
        firstMeta.startedAt = '2026-03-12T13:59:00.000Z';
        writeFileSync(firstMetaPath, JSON.stringify(firstMeta, null, 2));

        const secondMetaPath = join(kataDir, 'bridge-runs', `${prepared.preparedRuns[1]!.runId}.json`);
        const secondMeta = JSON.parse(readFileSync(secondMetaPath, 'utf-8'));
        secondMeta.startedAt = '2026-03-12T13:58:00.000Z';
        writeFileSync(secondMetaPath, JSON.stringify(secondMeta, null, 2));

        const summary = bridge.completeCycle(cycle.id, {
          [prepared.preparedRuns[0]!.runId]: { success: true },
          [prepared.preparedRuns[1]!.runId]: { success: false },
        });

        expect(summary.completedBets).toBe(1);
        expect(summary.totalDurationMs).toBe(180_000);
        expect(summary.tokenUsage).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should default to success when no result provided for a run', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);
      const summary = bridge.completeCycle(cycle.id, {});

      expect(summary.completedBets).toBe(2);
    });

    it('should preserve persisted token usage from runs completed before completeCycle()', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);
      bridge.complete(prepared.preparedRuns[0]!.runId, {
        success: true,
        tokenUsage: { inputTokens: 10, outputTokens: 5, total: 15 },
      });

      const summary = bridge.completeCycle(cycle.id, {});

      expect(summary.completedBets).toBe(2);
      expect(summary.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, total: 15 });
    });

    it('should only write new history entries for runs that are still in progress', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);
      const prepared = bridge.prepareCycle(cycle.id);

      bridge.complete(prepared.preparedRuns[0]!.runId, { success: true, notes: 'already done' });

      const historyDir = join(kataDir, 'history');
      const historyCountBefore = readdirSync(historyDir).filter((file) => file.endsWith('.json')).length;

      bridge.completeCycle(cycle.id, {
        [prepared.preparedRuns[1]!.runId]: { success: true, notes: 'complete remaining run' },
      });

      const historyCountAfter = readdirSync(historyDir).filter((file) => file.endsWith('.json')).length;
      expect(historyCountBefore).toBe(1);
      expect(historyCountAfter).toBe(2);
    });

    it('should update all bet outcomes in cycle JSON after completeCycle() (#216)', () => {
      // Regression test for #216: kata cooldown showed 0% completion because
      // bet outcomes were never written to the cycle JSON.
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      const prepared = bridge.prepareCycle(cycle.id);
      const results: Record<string, AgentCompletionResult> = {
        [prepared.preparedRuns[0]!.runId]: { success: true },
        [prepared.preparedRuns[1]!.runId]: { success: false },
      };
      bridge.completeCycle(cycle.id, results);

      // Verify cycle JSON has updated outcomes — this is what CycleManager.generateCooldown() reads
      const cyclePath = join(kataDir, 'cycles', `${cycle.id}.json`);
      const updatedCycle = JSON.parse(readFileSync(cyclePath, 'utf-8'));
      const outcomes: string[] = updatedCycle.bets.map((b: { outcome: string }) => b.outcome);
      // Both should be resolved — one success, one failure
      expect(outcomes).not.toContain('pending');
      expect(outcomes).toContain('complete');
      expect(outcomes).toContain('partial');
    });
  });
});
