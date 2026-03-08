import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { detectLaunchMode, detectSessionContext } from '@shared/lib/session-context.js';
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
import { CycleSchema, type Cycle, type CycleState } from '@domain/types/cycle.js';
import { type Bet } from '@domain/types/bet.js';
import { StageCategorySchema } from '@domain/types/stage.js';
import { z } from 'zod/v4';
import { JsonStore } from '@infra/persistence/json-store.js';
import { createRunTree, readRun, writeRun, runPaths } from '@infra/persistence/run-store.js';
import { KATA_DIRS } from '@shared/constants/paths.js';
import { logger } from '@shared/lib/logger.js';

/**
 * Schema for bridge-run metadata stored at .kata/bridge-runs/<runId>.json.
 */
const BridgeRunMetaSchema = z.object({
  runId: z.string(),
  betId: z.string(),
  betName: z.string(),
  cycleId: z.string(),
  cycleName: z.string(),
  stages: z.array(z.string()),
  isolation: z.enum(['worktree', 'shared']),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  status: z.enum(['in-progress', 'complete', 'failed']),
  /** Kataka (agent) ID driving this run — written to run.json on prepare. */
  katakaId: z.string().uuid().optional(),
  /**
   * Token usage for this run — populated by complete() when the agent
   * reports token counts via AgentCompletionResult.tokenUsage.
   */
  tokenUsage: z.object({
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    totalTokens: z.number().int().min(0),
  }).optional(),
});

type BridgeRunMeta = z.infer<typeof BridgeRunMetaSchema>;

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

  prepare(betId: string, katakaId?: string): PreparedRun {
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
      isolation,
      startedAt,
      katakaId,
    };

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
      katakaId,
    });

    // Backfill the runId onto the bet record in the cycle JSON so that queries
    // and reports that look up "the run for a bet" can do O(1) forward lookup.
    // Non-critical: errors are logged as warnings — a failed backfill should
    // not abort prepare() since the bridge-run metadata was already persisted.
    this.backfillRunIdInCycle(cycle.id, bet.id, runId);

    // Write run.json to runs/<run-id>/run.json so kata watch can discover
    // this run. BridgeRunMeta uses status "in-progress" but RunSchema requires
    // "running" — we map on write. Only valid StageCategory values are written
    // (filter guards against hypothetical custom stage strings).
    this.writeRunJson(runId, bet.id, bet.description, cycle.id, stages, startedAt, katakaId);

    return prepared;
  }

  formatAgentContext(prepared: PreparedRun): string {
    const lines: string[] = [];
    // --cwd takes the repo root (parent of .kata/), used in all kata CLI invocations
    const repoRoot = dirname(prepared.kataDir);

    // Detect launch context at dispatch time (late-bind — reflects actual env at agent start)
    const launchMode = detectLaunchMode();
    const sessionCtx = detectSessionContext(repoRoot);

    lines.push('## Launch context');
    lines.push('');
    lines.push(`- **Launch mode**: ${launchMode}`);
    lines.push(`- **In worktree**: ${sessionCtx.inWorktree ? 'yes' : 'no'}`);
    lines.push(`- **Kata dir resolved**: ${sessionCtx.kataDir ?? prepared.kataDir}`);
    if (launchMode !== 'interactive' && !sessionCtx.inWorktree) {
      lines.push('- **Note**: running as agent outside a git worktree — use `--cwd` to point kata commands at the main repo.');
    }
    lines.push('');

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

    // Git workflow
    lines.push('### Git workflow');
    lines.push('You are working in a git worktree. **NEVER commit directly to the `main` branch.**');
    lines.push('');
    lines.push('Before your first commit, create a feature branch:');
    lines.push(`  git checkout -b keiko-${prepared.runId.slice(0, 8)}/${prepared.betName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`);
    lines.push('');
    lines.push('Then commit to that branch and open a PR. The sensei will merge.');
    lines.push('');
    lines.push('To ensure hooks can detect your agent context, set this env var in your shell before git operations:');
    lines.push(`  export KATA_RUN_ID=${prepared.runId}`);
    lines.push('');

    // Record as you work
    lines.push('### Record as you work');
    lines.push('Use these commands at natural checkpoints — when a decision matters, when something surprises you, when you hit resistance:');
    lines.push('');
    lines.push(`  kata --cwd ${repoRoot} kansatsu record <type> "..." --run ${prepared.runId}`);
    lines.push(`  kata --cwd ${repoRoot} maki record <name> <path> --run ${prepared.runId}`);
    lines.push(`  kata --cwd ${repoRoot} kime record --decision "..." --rationale "..." --run ${prepared.runId}`);

    lines.push('');
    lines.push('**kime vs kansatsu — which to use for decisions:**');
    lines.push('  `kime record` is for decisions with explicit, trackable outcomes. Use kime when:');
    lines.push('    - You make a significant architectural or approach decision');
    lines.push('    - You can state what "success" or "failure" looks like for this decision');
    lines.push('    - Belt advancement tracks these directly as decision-outcome pairs');
    lines.push('  `kansatsu record decision` + `kansatsu record outcome` is for paired run observations. Use when:');
    lines.push('    - You want to log a decision as part of a broader observational record');
    lines.push('    - Belt also counts these as min(decisions, outcomes) pairs — secondary signal');
    lines.push('  **Prefer `kime record` for significant decisions — it is the primary belt metric.**');
    lines.push('');
    lines.push('**Observation types** — pick the most specific:');
    lines.push('  decision    — a choice between real alternatives; always include WHY you chose this path');
    lines.push('  prediction  — a testable bet about future behavior (state what would falsify it)');
    lines.push('  assumption  — something you are treating as true but have not verified');
    lines.push('  friction    — something that slowed you down; requires --taxonomy (see below)');
    lines.push('  gap         — missing capability, coverage, or information; requires --severity critical|major|minor');
    lines.push('  outcome     — factual result after a decision or prediction resolves');
    lines.push('  insight     — non-obvious learning that would change your approach in a similar situation');
    lines.push('');
    lines.push('**FRICTION — record immediately, before continuing:**');
    lines.push('When you hit a wall, get blocked, or need a workaround — record it as friction BEFORE resuming work.');
    lines.push('Do not defer to the summary. Friction recorded mid-run is the signal; friction in prose is noise.');
    lines.push('');
    lines.push('Example friction record (copy-paste and fill in):');
    lines.push(`  kata --cwd ${repoRoot} kansatsu record friction "lint-staged reverted my edits to execute.ts between two Edit calls" --run ${prepared.runId} --taxonomy tool-mismatch`);
    lines.push('');
    lines.push('**Friction taxonomy** (--taxonomy <value> — required for friction type):');
    lines.push('  stale-learning   — your expected pattern was outdated or wrong in this context');
    lines.push('  config-drift     — actual env/files/settings do not match documented expectations');
    lines.push('  convention-clash — established code convention conflicts with the natural approach');
    lines.push('  tool-mismatch    — available tool required workarounds; not quite right for the job');
    lines.push('  scope-creep      — work expanded beyond the original bet boundary during execution');
    lines.push('  agent-override   — user directed a different approach from what you would have chosen');
    lines.push('');
    lines.push('**Quality bar** — ask: would a future agent reading this understand what happened and why?');
    lines.push('  weak:   "Features already in main, issues can be closed"');
    lines.push('  strong: "Bets silently become redundant when issues stay open after merging — triage needs a closed-issue pre-flight"');
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
    lines.push('Before reporting back — did you record all friction events?');
    lines.push('Check: rate limits hit, unexpected tool behavior, workarounds needed, anything that took more than one try.');
    lines.push('If any of those happened and you have not recorded them yet, record them now before continuing.');
    lines.push('');
    lines.push('Report back to the sensei with a summary of:');
    lines.push('- What you produced (artifacts)');
    lines.push('- Any decisions you made and why');
    lines.push('- Any issues or blockers encountered');
    lines.push('Do NOT close the run yourself — the sensei handles run lifecycle.');

    return lines.join('\n');
  }

  getAgentContext(runId: string): string {
    const meta = this.readBridgeRunMeta(runId);
    if (!meta) {
      throw new Error(`No bridge run found for run ID "${runId}". Was it prepared via the session bridge?`);
    }
    if (meta.status === 'complete' || meta.status === 'failed') {
      throw new Error(`Run "${runId}" is in terminal state "${meta.status}" and cannot be dispatched.`);
    }

    // Reconstruct the minimal PreparedRun shape needed by formatAgentContext().
    // The manifest is rebuilt from stored metadata — it doesn't need to be the
    // exact original manifest because formatAgentContext() only reads:
    //   prepared.runId, betId, cycleId, kataDir, stages,
    //   manifest.artifacts, manifest.entryGate, manifest.exitGate, manifest.learnings
    // betName and betPrompt are stored in BridgeRunMeta directly.
    const prepared: PreparedRun = {
      runId: meta.runId,
      betId: meta.betId,
      betName: meta.betName,
      cycleId: meta.cycleId,
      cycleName: meta.cycleName,
      manifest: {
        stageType: meta.stages.join(','),
        prompt: `Execute the bet: "${meta.betName}"`,
        context: {
          pipelineId: meta.runId,
          stageIndex: 0,
          metadata: {
            betId: meta.betId,
            cycleId: meta.cycleId,
            cycleName: meta.cycleName,
            runId: meta.runId,
            adapter: 'claude-native',
          },
        },
        artifacts: [],
        learnings: [],
      },
      kataDir: this.kataDir,
      stages: meta.stages,
      isolation: meta.isolation,
      startedAt: meta.startedAt,
    };

    return this.formatAgentContext(prepared);
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
      throw new Error(
        `Bridge run ${runId} history entry failed to write: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Update bridge run metadata (includes tokenUsage when provided)
    meta.completedAt = completedAt;
    meta.status = result.success ? 'complete' : 'failed';
    if (result.tokenUsage) {
      meta.tokenUsage = {
        inputTokens: result.tokenUsage.inputTokens ?? 0,
        outputTokens: result.tokenUsage.outputTokens ?? 0,
        totalTokens: result.tokenUsage.total ?? 0,
      };
    }
    this.writeBridgeRunMeta(meta);

    // Update run.json with completion status and token usage so kata watch
    // can display final state (#254 partial fix: run.json reflects completion).
    this.updateRunJsonOnComplete(runId, completedAt, result.success, result.tokenUsage);

    // Update the bet outcome in the cycle JSON so CycleManager.generateCooldown()
    // sees correct completion data (fixes #216: 0% completion rate in cooldown).
    // success → 'complete', failure → 'partial' (agent ran but did not fully succeed).
    this.updateBetOutcomeInCycle(meta.cycleId, meta.betId, result.success ? 'complete' : 'partial');
  }

  // ── Cycle-level convenience ───────────────────────────────────────────

  prepareCycle(cycleId: string, katakaId?: string, name?: string): PreparedCycle {
    const cycle = this.loadCycle(cycleId);
    const pendingBets = cycle.bets.filter((b) => b.outcome === 'pending');

    if (pendingBets.length === 0) {
      throw new Error(`No pending bets in cycle "${cycle.name ?? cycle.id}".`);
    }

    // Write name and transition state BEFORE preparing runs so each bridge-run
    // file is written with the resolved cycle name (#346).
    this.updateCycleState(cycle.id, 'active', name);
    const updatedCycle = this.loadCycle(cycle.id);
    const resolvedName = updatedCycle.name ?? cycle.id;

    const preparedRuns = pendingBets.map((bet) => this.prepare(bet.id, katakaId));

    return {
      cycleId: cycle.id,
      cycleName: resolvedName,
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

  // ── Cycle JSON update ─────────────────────────────────────────────────

  /**
   * Transition cycle state directly in the cycle JSON file.
   * Called by prepareCycle() to move a planning cycle to active (#322).
   * Optionally sets a human-readable name on the cycle at launch time (#346).
   */
  private updateCycleState(cycleId: string, state: CycleState, name?: string): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot update cycle state: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      const ALLOWED_TRANSITIONS: Partial<Record<CycleState, CycleState>> = {
        planning: 'active',
        active: 'cooldown',
        cooldown: 'complete',
      };
      if (ALLOWED_TRANSITIONS[cycle.state] !== state) {
        logger.warn(`Cannot transition cycle "${cycleId}" from "${cycle.state}" to "${state}".`);
        return;
      }
      cycle.state = state;
      if (name !== undefined) {
        cycle.name = name;
      }
      cycle.updatedAt = new Date().toISOString();
      JsonStore.write(cyclePath, cycle, CycleSchema);
    } catch (err) {
      logger.warn(`Failed to update cycle state for cycle "${cycleId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Update a bet's outcome field directly in the cycle JSON file.
   * Non-critical: errors are logged as warnings — a failed update should not
   * abort the run completion, since the history entry was already persisted.
   *
   * Only updates bets that are currently 'pending' to avoid overwriting
   * a manually-set outcome (e.g. user ran kata cooldown before bridge complete).
   */
  private updateBetOutcomeInCycle(
    cycleId: string,
    betId: string,
    outcome: 'complete' | 'partial',
  ): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot update bet outcome: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      const bet = cycle.bets.find((b) => b.id === betId);
      if (!bet) {
        logger.warn(`Cannot update bet outcome: bet "${betId}" not found in cycle "${cycleId}".`);
        return;
      }

      // Only update if still pending — don't overwrite a manually-set outcome
      if (bet.outcome !== 'pending') {
        return;
      }

      bet.outcome = outcome;
      cycle.updatedAt = new Date().toISOString();
      JsonStore.write(cyclePath, cycle, CycleSchema);
    } catch (err) {
      logger.warn(`Failed to update bet outcome in cycle "${cycleId}" for bet "${betId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Backfill the runId onto the bet record in the cycle JSON file.
   *
   * Called by prepare() after the bridge-run metadata and run.json are written.
   * This is the staged-workflow equivalent of CycleManager.setRunId() used by
   * `kata cycle start` — it enables O(1) forward lookup of "the run for a bet".
   *
   * Idempotent: overwrites any previously stored runId without error (safe on retry).
   * Non-critical: errors are logged as warnings — the bridge-run metadata was already
   * persisted and the agent can still execute.
   */
  private backfillRunIdInCycle(cycleId: string, betId: string, runId: string): void {
    try {
      const cyclesDir = join(this.kataDir, KATA_DIRS.cycles);
      const cyclePath = join(cyclesDir, `${cycleId}.json`);
      if (!existsSync(cyclePath)) {
        logger.warn(`Cannot backfill bet.runId: cycle file not found for cycle "${cycleId}".`);
        return;
      }

      const cycle = JsonStore.read(cyclePath, CycleSchema);
      const bet = cycle.bets.find((b) => b.id === betId);
      if (!bet) {
        logger.warn(`Cannot backfill bet.runId: bet "${betId}" not found in cycle "${cycleId}".`);
        return;
      }

      bet.runId = runId;
      cycle.updatedAt = new Date().toISOString();
      JsonStore.write(cyclePath, cycle, CycleSchema);
    } catch (err) {
      logger.warn(`Failed to backfill bet.runId in cycle "${cycleId}" for bet "${betId}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── run.json writer ───────────────────────────────────────────────────

  /**
   * Write a RunSchema-conforming run.json to runs/<runId>/run.json.
   *
   * This is called by prepare() so that kata watch (which reads RunSchema)
   * can discover bridge-prepared runs immediately (#234).
   *
   * Status mapping: BridgeRunMeta uses "in-progress" but RunSchema uses
   * "running". We always write "running" here. The run.json is NOT updated
   * when the bridge run completes — history entries are the completion record.
   *
   * Stage filtering: RunSchema.stageSequence requires StageCategory values.
   * Any stage string that is not a valid StageCategory is dropped so that
   * Zod validation does not fail on hypothetical custom stage names.
   */
  private writeRunJson(
    runId: string,
    betId: string,
    betPrompt: string,
    cycleId: string,
    stages: string[],
    startedAt: string,
    katakaId?: string,
  ): void {
    try {
      const validCategories = StageCategorySchema.options;
      const stageSequence = stages.filter((s): s is typeof validCategories[number] =>
        (validCategories as readonly string[]).includes(s),
      );

      // Fall back to the standard four-stage sequence if all were filtered out
      const finalSequence = stageSequence.length > 0
        ? stageSequence
        : (['research', 'plan', 'build', 'review'] as const);

      const runsDir = join(this.kataDir, KATA_DIRS.runs);
      createRunTree(runsDir, {
        id: runId,
        cycleId,
        betId,
        betPrompt,
        stageSequence: [...finalSequence],
        currentStage: finalSequence[0] ?? null,
        status: 'running',
        startedAt,
        ...(katakaId ? { katakaId } : {}),
      });
    } catch (err) {
      // Non-critical: log a warning but do not abort prepare(). The bridge-run
      // metadata was already written and the agent can still execute. kata watch
      // will simply not see this run until the issue is resolved.
      logger.warn('Failed to write run.json for bridge run — kata watch will not see this run.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── run.json completion update ────────────────────────────────────────

  /**
   * Update run.json on completion: set status, completedAt, and tokenUsage.
   *
   * Non-critical: errors are logged as warnings — run.json is supplementary
   * to the history entry (which is the canonical completion record). If this
   * fails, cooldown token utilization simply won't reflect this run's tokens.
   */
  private updateRunJsonOnComplete(
    runId: string,
    completedAt: string,
    success: boolean,
    tokenUsage?: { inputTokens?: number; outputTokens?: number; total?: number },
  ): void {
    try {
      const runsDir = join(this.kataDir, KATA_DIRS.runs);
      const paths = runPaths(runsDir, runId);
      if (!existsSync(paths.runJson)) return;

      const run = readRun(runsDir, runId);
      const updated = {
        ...run,
        status: (success ? 'completed' : 'failed') as 'completed' | 'failed',
        completedAt,
        ...(tokenUsage ? {
          tokenUsage: {
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.total,
          },
        } : {}),
      };
      writeRun(runsDir, updated);
    } catch (err) {
      logger.warn('Failed to update run.json on complete — token utilization may be incomplete.', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Bridge run metadata persistence ───────────────────────────────────

  private bridgeRunsDir(): string {
    return join(this.kataDir, KATA_DIRS.bridgeRuns);
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
      return BridgeRunMetaSchema.parse(JSON.parse(readFileSync(path, 'utf-8')));
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
          const meta = BridgeRunMetaSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf-8')));
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
