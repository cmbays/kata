import { join } from 'node:path';
import { mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SessionExecutionBridge } from './session-bridge.js';
import type { AgentCompletionResult } from '@domain/ports/session-bridge.js';
import { CycleSchema } from '@domain/types/cycle.js';

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
      expect(prepared.agentContext).toContain('## Kata Run Context');
      expect(prepared.agentContext).toContain(prepared.runId);
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

    it('should throw for unknown bet ID', () => {
      createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepare(randomUUID())).toThrow(/No cycle found/);
    });

    it('should throw when no cycles exist', () => {
      const bridge = new SessionExecutionBridge(kataDir);

      expect(() => bridge.prepare(randomUUID())).toThrow(/No cycles directory/);
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
      expect(context).toContain(`kata kansatsu record --run-id ${prepared.runId}`);
      expect(context).toContain(`kata maki record --run-id ${prepared.runId}`);
      expect(context).toContain(`kata kime record --run-id ${prepared.runId}`);
      expect(context).toContain("### When you're done");
      expect(context).toContain('Do NOT close the run yourself');
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

    it('should resolve cycle by name', () => {
      const cycle = createCycle(kataDir, { name: 'My Cycle' });
      const bridge = new SessionExecutionBridge(kataDir);

      const result = bridge.prepareCycle(cycle.id);
      expect(result.cycleName).toBe('My Cycle');
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

    it('should default to success when no result provided for a run', () => {
      const cycle = createCycle(kataDir);
      const bridge = new SessionExecutionBridge(kataDir);

      bridge.prepareCycle(cycle.id);
      const summary = bridge.completeCycle(cycle.id, {});

      expect(summary.completedBets).toBe(2);
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
