import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import type {
  ISessionExecutionBridge,
  PreparedRun,
  PreparedCycle,
  CycleExecutionStatus,
  RunStatus,
  CycleSummary,
  AgentCompletionResult,
} from '@domain/ports/session-bridge.js';
import type { ExecutionManifest } from '@domain/types/manifest.js';
import { ExecutionHistoryEntrySchema } from '@domain/types/history.js';
import { CycleSchema, type Cycle } from '@domain/types/cycle.js';
import { type Bet } from '@domain/types/bet.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Metadata stored for an open (in-progress) bridge run.
 * Written to .kata/bridge-runs/<runId>.json so getCycleStatus() can find them.
 */
interface BridgeRunMeta {
  runId: string;
  betId: string;
  betName: string;
  cycleId: string;
  cycleName: string;
  stages: string[];
  isolation: 'worktree' | 'shared';
  startedAt: string;
  completedAt?: string;
  status: 'in-progress' | 'complete' | 'failed';
}

/**
 * SessionExecutionBridge — splits the adapter lifecycle for in-session execution.
 *
 * Used by the sensei skill when Claude IS the orchestrator. The bridge prepares
 * runs (builds manifests, generates agent context blocks) and closes them
 * (writes history entries). The sensei handles the middle part (spawning agents
 * via the Agent tool).
 *
 * This is NOT an IExecutionAdapter — the lifecycle model is fundamentally
 * different. See docs/cycle-2/229-claude-native-adapter-frame.md.
 */
export class SessionExecutionBridge implements ISessionExecutionBridge {
  constructor(private readonly kataDir: string) {}

  // ── Run-level primitives ──────────────────────────────────────────────

  prepare(betId: string): PreparedRun {
    const cycle = this.findCycleForBet(betId);
    const bet = cycle.bets.find((b) => b.id === betId);
    if (!bet) {
      throw new Error(`Bet "${betId}" not found in cycle "${cycle.name ?? cycle.id}".`);
    }

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const stages = this.resolveStages(bet);
    const isolation = this.resolveIsolation(bet);

    // Build a lightweight manifest from the bet context.
    // The manifest is intentionally minimal — the sensei's formatAgentContext()
    // renders the full agent prompt. We don't run the full orchestrator here
    // because the agent IS the orchestrator.
    const manifest = this.buildManifestFromBet(bet, cycle, runId);

    const prepared: PreparedRun = {
      runId,
      betId: bet.id,
      betName: bet.description,
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      manifest,
      kataDir: this.kataDir,
      stages,
      agentContext: '', // Populated below
      isolation,
      startedAt,
    };

    // Generate the agent context block
    prepared.agentContext = this.formatAgentContext(prepared);

    // Persist bridge run metadata so getCycleStatus() can find it
    this.writeBridgeRunMeta({
      runId,
      betId: bet.id,
      betName: bet.description,
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      stages,
      isolation,
      startedAt,
      status: 'in-progress',
    });

    return prepared;
  }

  formatAgentContext(prepared: PreparedRun): string {
    const lines: string[] = [];

    lines.push('## Kata Run Context');
    lines.push('');
    lines.push('You are executing inside a kata run. Record your work as you go.');
    lines.push('');
    lines.push(`- **Run ID**: ${prepared.runId}`);
    lines.push(`- **Bet ID**: ${prepared.betId}`);
    lines.push(`- **Cycle ID**: ${prepared.cycleId}`);
    lines.push(`- **Kata dir**: ${prepared.kataDir}`);
    lines.push(`- **Stages**: ${prepared.stages.join(', ')}`);
    lines.push('');

    // What to produce
    lines.push('### What to produce');
    lines.push(`Execute the bet: "${prepared.betName}"`);
    if (prepared.manifest.artifacts.length > 0) {
      lines.push('');
      lines.push('Expected artifacts:');
      for (const art of prepared.manifest.artifacts) {
        const req = art.required !== false ? '[required]' : '[optional]';
        lines.push(`  - ${art.name} ${req}${art.description ? ` — ${art.description}` : ''}`);
      }
    }
    lines.push('');

    // Gates
    if (prepared.manifest.entryGate || prepared.manifest.exitGate) {
      lines.push('### Gates');
      if (prepared.manifest.entryGate) {
        lines.push(`**Entry gate** (${prepared.manifest.entryGate.type}):`);
        for (const cond of prepared.manifest.entryGate.conditions) {
          const desc = cond.description ?? this.describeCondition(cond);
          lines.push(`  - [${cond.type}] ${desc}`);
        }
        lines.push('  If you cannot satisfy an entry gate, STOP and report to the sensei.');
        lines.push('');
      }
      if (prepared.manifest.exitGate) {
        lines.push(`**Exit gate** (${prepared.manifest.exitGate.type}):`);
        for (const cond of prepared.manifest.exitGate.conditions) {
          const desc = cond.description ?? this.describeCondition(cond);
          lines.push(`  - [${cond.type}] ${desc}`);
        }
        lines.push('  Your output must satisfy these conditions. The sensei will verify.');
        lines.push('');
      }
      lines.push('Do not skip gates — the sensei catches violations at stage boundaries.');
      lines.push('');
    }

    // Record as you work
    lines.push('### Record as you work');
    lines.push('Use these commands at natural checkpoints (not after every line of code):');
    lines.push('');
    lines.push(`  kata kansatsu record --run-id ${prepared.runId} --note "..." --severity info`);
    lines.push(`  kata maki record --run-id ${prepared.runId} --name "..." --path "..."`);
    lines.push(`  kata kime record --run-id ${prepared.runId} --decision "..." --rationale "..."`);
    lines.push('');

    // Injected learnings
    if (prepared.manifest.learnings.length > 0) {
      lines.push('### Injected Learnings');
      lines.push('These patterns were captured from previous executions:');
      lines.push('');
      for (const learning of prepared.manifest.learnings) {
        const conf = learning.confidence !== undefined
          ? ` (confidence: ${(learning.confidence * 100).toFixed(0)}%)`
          : '';
        lines.push(`  - [${learning.tier}/${learning.category}]${conf}`);
        lines.push(`    ${learning.content}`);
      }
      lines.push('');
    }

    // When you're done
    lines.push('### When you\'re done');
    lines.push('Report back to the sensei with a summary of:');
    lines.push('- What you produced (artifacts)');
    lines.push('- Any decisions you made and why');
    lines.push('- Any issues or blockers encountered');
    lines.push('Do NOT close the run yourself — the sensei handles run lifecycle.');

    return lines.join('\n');
  }

  complete(runId: string, result: AgentCompletionResult): void {
    const meta = this.readBridgeRunMeta(runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }

    const completedAt = new Date().toISOString();
    const durationMs = new Date(completedAt).getTime() - new Date(meta.startedAt).getTime();

    // Write history entry (same schema as KiaiRunner.writeHistoryEntry)
    try {
      const id = randomUUID();
      const entry = ExecutionHistoryEntrySchema.parse({
        id,
        pipelineId: randomUUID(),
        stageType: meta.stages.join(','),
        stageIndex: 0,
        adapter: 'claude-native',
        artifactNames: result.artifacts?.map((a) => a.name) ?? [],
        startedAt: meta.startedAt,
        completedAt,
        durationMs,
        cycleId: meta.cycleId,
        betId: meta.betId,
        tokenUsage: result.tokenUsage ? {
          inputTokens: result.tokenUsage.inputTokens ?? 0,
          outputTokens: result.tokenUsage.outputTokens ?? 0,
          total: result.tokenUsage.total ?? 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        } : undefined,
      });

      const historyDir = join(this.kataDir, KATA_DIRS.history);
      mkdirSync(historyDir, { recursive: true });
      writeFileSync(
        join(historyDir, `${id}.json`),
        JSON.stringify(entry, null, 2) + '\n',
      );
    } catch (err) {
      logger.error('Failed to write history entry for bridge run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Update bridge run metadata
    meta.completedAt = completedAt;
    meta.status = result.success ? 'complete' : 'failed';
    this.writeBridgeRunMeta(meta);
  }

  // ── Cycle-level convenience ───────────────────────────────────────────

  prepareCycle(cycleId: string): PreparedCycle {
    const cycle = this.loadCycle(cycleId);
    const pendingBets = cycle.bets.filter((b) => b.outcome === 'pending');

    if (pendingBets.length === 0) {
      throw new Error(`No pending bets in cycle "${cycle.name ?? cycle.id}".`);
    }

    const preparedRuns = pendingBets.map((bet) => this.prepare(bet.id));

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      preparedRuns,
    };
  }

  getCycleStatus(cycleId: string): CycleExecutionStatus {
    const cycle = this.loadCycle(cycleId);
    const bridgeRuns = this.listBridgeRunsForCycle(cycleId);

    const bets: RunStatus[] = [];
    let earliestStart: string | null = null;

    for (const meta of bridgeRuns) {
      // Count observations, artifacts, decisions from .kata/runs/ if available
      const counts = this.countRunData(meta.runId);

      if (!earliestStart || meta.startedAt < earliestStart) {
        earliestStart = meta.startedAt;
      }

      const durationMs = meta.completedAt
        ? new Date(meta.completedAt).getTime() - new Date(meta.startedAt).getTime()
        : null;

      bets.push({
        betId: meta.betId,
        betName: meta.betName,
        runId: meta.runId,
        status: meta.status === 'in-progress' ? 'in-progress' : meta.status,
        kansatsuCount: counts.observations,
        artifactCount: counts.artifacts,
        decisionCount: counts.decisions,
        lastActivity: counts.lastTimestamp,
        durationMs,
      });
    }

    // Include bets that haven't been prepared yet
    for (const bet of cycle.bets) {
      if (!bridgeRuns.some((r) => r.betId === bet.id)) {
        bets.push({
          betId: bet.id,
          betName: bet.description,
          runId: '',
          status: 'pending',
          kansatsuCount: 0,
          artifactCount: 0,
          decisionCount: 0,
          lastActivity: null,
          durationMs: null,
        });
      }
    }

    const elapsed = earliestStart
      ? this.formatDuration(Date.now() - new Date(earliestStart).getTime())
      : '0m';

    // Budget estimation (approximate — we count history entries for this cycle)
    const budgetUsed = this.estimateBudgetUsage(cycle);

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      bets,
      elapsed,
      budgetUsed,
    };
  }

  completeCycle(cycleId: string, results: Record<string, AgentCompletionResult>): CycleSummary {
    const cycle = this.loadCycle(cycleId);
    const bridgeRuns = this.listBridgeRunsForCycle(cycleId);

    let totalDuration = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let completed = 0;
    let hasTokenData = false;

    for (const meta of bridgeRuns) {
      if (meta.status === 'in-progress') {
        const result = results[meta.runId] ?? { success: true };
        this.complete(meta.runId, result);
      }

      // Re-read to get updated metadata
      const updated = this.readBridgeRunMeta(meta.runId);
      if (updated?.status === 'complete') completed++;

      if (updated?.completedAt) {
        totalDuration += new Date(updated.completedAt).getTime() - new Date(updated.startedAt).getTime();
      }

      const agentResult = results[meta.runId];
      if (agentResult?.tokenUsage) {
        hasTokenData = true;
        totalInput += agentResult.tokenUsage.inputTokens ?? 0;
        totalOutput += agentResult.tokenUsage.outputTokens ?? 0;
        totalTokens += agentResult.tokenUsage.total ?? 0;
      }
    }

    return {
      cycleId: cycle.id,
      cycleName: cycle.name ?? cycle.id,
      completedBets: completed,
      totalBets: cycle.bets.length,
      totalDurationMs: totalDuration,
      tokenUsage: hasTokenData
        ? { inputTokens: totalInput, outputTokens: totalOutput, total: totalTokens }
        : null,
    };
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private findCycleForBet(betId: string): Cycle {
    const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
    if (!existsSync(cyclesDir)) {
      throw new Error('No cycles directory found. Run "kata cycle new" first.');
    }

    const files = readdirSync(cyclesDir).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      try {
        const cycle = JsonStore.read(join(cyclesDir, file), CycleSchema);
        if (cycle.bets.some((b) => b.id === betId)) {
          return cycle;
        }
      } catch {
        // Skip invalid cycle files
      }
    }

    throw new Error(`No cycle found containing bet "${betId}".`);
  }

  private loadCycle(cycleId: string): Cycle {
    const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
    const files = readdirSync(cyclesDir).filter((f) => f.endsWith('.json'));

    for (const file of files) {
      try {
        const cycle = JsonStore.read(join(cyclesDir, file), CycleSchema);
        if (cycle.id === cycleId || cycle.name === cycleId) {
          return cycle;
        }
      } catch {
        // Skip invalid cycle files
      }
    }

    throw new Error(`Cycle "${cycleId}" not found.`);
  }

  private resolveStages(bet: Bet): string[] {
    if (bet.kata) {
      if (bet.kata.type === 'ad-hoc') {
        return [...bet.kata.stages];
      }
      // For named katas, try to load the saved kata file
      try {
        const kataPath = join(this.kataDir, KATA_DIRS.katas, `${bet.kata.pattern}.json`);
        if (existsSync(kataPath)) {
          const raw = JSON.parse(readFileSync(kataPath, 'utf-8'));
          return raw.stages ?? ['research', 'plan', 'build', 'review'];
        }
      } catch {
        // Fall through to default
      }
    }
    return ['research', 'plan', 'build', 'review'];
  }

  private resolveIsolation(bet: Bet): 'worktree' | 'shared' {
    // Default to shared. Build stages typically need worktree isolation,
    // but the sensei can override based on flavor.isolation fields.
    const stages = this.resolveStages(bet);
    return stages.includes('build') ? 'worktree' : 'shared';
  }

  private buildManifestFromBet(bet: Bet, cycle: Cycle, runId: string): ExecutionManifest {
    return {
      stageType: this.resolveStages(bet).join(','),
      prompt: `Execute the bet: "${bet.description}"\n\nContext: Cycle "${cycle.name ?? cycle.id}" — run ${runId}`,
      context: {
        pipelineId: randomUUID(),
        stageIndex: 0,
        metadata: {
          betId: bet.id,
          cycleId: cycle.id,
          cycleName: cycle.name ?? cycle.id,
          runId,
          adapter: 'claude-native',
        },
      },
      artifacts: [],
      learnings: [],
    };
  }

  private describeCondition(cond: { type: string; artifactName?: string; predecessorType?: string }): string {
    switch (cond.type) {
      case 'artifact-exists':
        return cond.artifactName ? `artifact "${cond.artifactName}" must exist` : 'required artifact must exist';
      case 'predecessor-complete':
        return cond.predecessorType ? `stage "${cond.predecessorType}" must be complete` : 'predecessor must be complete';
      case 'human-approved':
        return 'requires human approval';
      case 'schema-valid':
        return 'output must pass schema validation';
      case 'command-passes':
        return 'command must exit with code 0';
      default:
        return cond.type;
    }
  }

  // ── Bridge run metadata persistence ───────────────────────────────────

  private bridgeRunsDir(): string {
    return join(this.kataDir, 'bridge-runs');
  }

  private writeBridgeRunMeta(meta: BridgeRunMeta): void {
    const dir = this.bridgeRunsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${meta.runId}.json`),
      JSON.stringify(meta, null, 2) + '\n',
    );
  }

  private readBridgeRunMeta(runId: string): BridgeRunMeta | null {
    const path = join(this.bridgeRunsDir(), `${runId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      return null;
    }
  }

  private listBridgeRunsForCycle(cycleId: string): BridgeRunMeta[] {
    const dir = this.bridgeRunsDir();
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const meta: BridgeRunMeta = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
          return meta.cycleId === cycleId ? meta : null;
        } catch {
          return null;
        }
      })
      .filter((m): m is BridgeRunMeta => m !== null);
  }

  // ── Data counting for status ──────────────────────────────────────────

  private countRunData(runId: string): {
    observations: number;
    artifacts: number;
    decisions: number;
    lastTimestamp: string | null;
  } {
    const runsDir = join(this.kataDir, KATA_DIRS.runs);
    const runDir = join(runsDir, runId);

    if (!existsSync(runDir)) {
      return { observations: 0, artifacts: 0, decisions: 0, lastTimestamp: null };
    }

    // Count JSONL entries in the run's data files
    const countJsonlLines = (filePath: string): number => {
      if (!existsSync(filePath)) return 0;
      try {
        const content = readFileSync(filePath, 'utf-8').trim();
        return content ? content.split('\n').length : 0;
      } catch {
        return 0;
      }
    };

    // Standard run-store paths
    let observations = countJsonlLines(join(runDir, 'observations.jsonl'));
    const artifacts = countJsonlLines(join(runDir, 'artifacts.jsonl'));
    let decisions = countJsonlLines(join(runDir, 'decisions.jsonl'));

    // Also check stage-level observations
    const stagesDir = join(runDir, 'stages');
    if (existsSync(stagesDir)) {
      for (const stageDir of readdirSync(stagesDir)) {
        observations += countJsonlLines(join(stagesDir, stageDir, 'observations.jsonl'));
        decisions += countJsonlLines(join(stagesDir, stageDir, 'decisions.jsonl'));
      }
    }

    // Get last timestamp from bridge-run metadata
    const meta = this.readBridgeRunMeta(runId);
    let lastTimestamp: string | null = null;
    if (meta?.completedAt) {
      lastTimestamp = meta.completedAt;
    } else if (meta?.startedAt) {
      lastTimestamp = meta.startedAt;
    }

    return { observations, artifacts, decisions, lastTimestamp };
  }

  private estimateBudgetUsage(cycle: Cycle): { percent: number; tokenEstimate: number } | null {
    if (!cycle.budget.tokenBudget) return null;

    const historyDir = join(this.kataDir, KATA_DIRS.history);
    if (!existsSync(historyDir)) return { percent: 0, tokenEstimate: 0 };

    let totalTokens = 0;
    for (const file of readdirSync(historyDir).filter((f) => f.endsWith('.json'))) {
      try {
        const entry = JSON.parse(readFileSync(join(historyDir, file), 'utf-8'));
        if (entry.cycleId === cycle.id && entry.tokenUsage?.total) {
          totalTokens += entry.tokenUsage.total;
        }
      } catch {
        // Skip invalid files
      }
    }

    return {
      percent: Math.round((totalTokens / cycle.budget.tokenBudget) * 100),
      tokenEstimate: totalTokens,
    };
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }
}
