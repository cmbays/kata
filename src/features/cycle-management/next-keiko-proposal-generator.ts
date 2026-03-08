import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Cycle } from '@domain/types/cycle.js';
import type { Observation } from '@domain/types/observation.js';
import { ObservationSchema } from '@domain/types/observation.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { logger } from '@shared/lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MilestoneIssue {
  number: number;
  title: string;
  labels: string[];
}

export interface NextKeikoInput {
  cycle: Cycle;
  runsDir: string;
  /**
   * Path to `.kata/bridge-runs/` directory.
   * When provided, bets whose `bet.runId` is null/undefined will be resolved
   * via bridge-run file lookup (same fallback as writeSynthesisInput — fixes #348).
   */
  bridgeRunsDir?: string;
  /** Milestone name to query for open issues. When omitted, issue list is skipped. */
  milestoneName?: string;
  /** Completed bet descriptions (for context). */
  completedBets: string[];
}

export interface NextKeikoResult {
  /** The formatted proposal text to print to the user. */
  text: string;
  /** Observation counts used as input. */
  observationCounts: {
    friction: number;
    gap: number;
    insight: number;
    total: number;
  };
  /** Number of milestone issues fetched. */
  milestoneIssueCount: number;
}

// ---------------------------------------------------------------------------
// Dependencies (injectable for testing)
// ---------------------------------------------------------------------------

export interface NextKeikoProposalGeneratorDeps {
  /**
   * Invoke `claude --print` with the given prompt via stdin.
   * Returns the raw stdout string.
   * Injectable for testing.
   */
  invokeClaude?: (prompt: string) => string;
  /**
   * Fetch open issues for a milestone via `gh issue list`.
   * Returns an array of MilestoneIssue.
   * Injectable for testing.
   */
  fetchMilestoneIssues?: (milestoneName: string) => MilestoneIssue[];
}

// ---------------------------------------------------------------------------
// NextKeikoProposalGenerator
// ---------------------------------------------------------------------------

/**
 * Generates LLM-driven ranked bet proposals for the next keiko.
 *
 * Data gathered:
 *   1. Observations (friction, gap, insight) from all runs in this cycle
 *   2. Open issues in the active milestone (via `gh issue list`)
 *   3. Completed bets from this cycle
 *
 * Output format:
 *   === Next Keiko Proposals ===
 *
 *   Recommended bets (ranked):
 *     1. <title> (#NNN)    appetite: S    signal: <one-line rationale>
 *     2. ...
 *
 *   Based on: N friction observations, N gap observations, N open milestone issues
 */
export class NextKeikoProposalGenerator {
  private readonly invokeClaude: (prompt: string) => string;
  private readonly fetchMilestoneIssues: (milestoneName: string) => MilestoneIssue[];

  constructor(deps: NextKeikoProposalGeneratorDeps = {}) {
    this.invokeClaude = deps.invokeClaude ?? defaultInvokeClaude;
    this.fetchMilestoneIssues = deps.fetchMilestoneIssues ?? defaultFetchMilestoneIssues;
  }

  /**
   * Generate next-keiko proposals and return the formatted text.
   */
  generate(input: NextKeikoInput): NextKeikoResult {
    // 1. Collect observations from all cycle runs
    const observations = this.collectObservations(input.cycle, input.runsDir, input.bridgeRunsDir);

    const frictionObs = observations.filter((o) => o.type === 'friction');
    const gapObs = observations.filter((o) => o.type === 'gap');
    const insightObs = observations.filter((o) => o.type === 'insight');

    const observationCounts = {
      friction: frictionObs.length,
      gap: gapObs.length,
      insight: insightObs.length,
      total: observations.length,
    };

    // 2. Fetch open milestone issues (non-critical)
    let milestoneIssues: MilestoneIssue[] = [];
    if (input.milestoneName) {
      try {
        milestoneIssues = this.fetchMilestoneIssues(input.milestoneName);
      } catch (err) {
        logger.warn(
          `NextKeikoProposalGenerator: failed to fetch milestone issues for "${input.milestoneName}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3. Build the synthesis prompt
    const prompt = buildProposalPrompt({
      cycleName: input.cycle.name ?? input.cycle.id,
      completedBets: input.completedBets,
      frictionObservations: frictionObs.map((o) => o.content),
      gapObservations: gapObs.map((o) => o.content),
      insightObservations: insightObs.map((o) => o.content),
      milestoneIssues,
    });

    // 4. Invoke claude --print
    let rawOutput: string;
    try {
      rawOutput = this.invokeClaude(prompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`NextKeikoProposalGenerator: claude invocation failed: ${msg}`);
      // Graceful degradation: return a minimal output rather than crashing cooldown
      const footer = buildFooter(observationCounts, milestoneIssues.length);
      return {
        text: `=== Next Keiko Proposals ===\n\n(LLM synthesis unavailable: ${msg})\n\n${footer}`,
        observationCounts,
        milestoneIssueCount: milestoneIssues.length,
      };
    }

    // 5. Format final output
    const text = formatOutput(rawOutput, observationCounts, milestoneIssues.length);

    return {
      text,
      observationCounts,
      milestoneIssueCount: milestoneIssues.length,
    };
  }

  /**
   * Collect all observations from `.kata/runs/<run-id>/observations.jsonl`
   * for every bet in the cycle that has a runId.
   *
   * When `bet.runId` is null/undefined, falls back to a bridge-run file lookup
   * (same pattern as writeSynthesisInput — fixes #348).
   *
   * Falls back to scanning all level-specific observation files when
   * run-level observations.jsonl is absent (forward compatible).
   */
  private collectObservations(cycle: Cycle, runsDir: string, bridgeRunsDir?: string): Observation[] {
    const all: Observation[] = [];

    // Build betId → runId fallback map from bridge-run files when bet.runId is missing.
    // Only loaded when bridgeRunsDir is provided — lazy, scanned at most once.
    const bridgeRunIdByBetId: Map<string, string> = bridgeRunsDir
      ? loadBridgeRunIdsByBetId(cycle.id, bridgeRunsDir)
      : new Map();

    for (const bet of cycle.bets) {
      // Prefer bet.runId (forward link set by prepare); fall back to bridge-run lookup
      const runId = bet.runId ?? bridgeRunIdByBetId.get(bet.id);
      if (!runId) continue;

      const runDir = join(runsDir, runId);
      if (!existsSync(runDir)) continue;

      // Run-level observations (primary source)
      const runObs = join(runDir, 'observations.jsonl');
      if (existsSync(runObs)) {
        const obs = JsonlStore.readAll(runObs, ObservationSchema);
        all.push(...obs);
      }

      // Stage-level observations (supplement)
      const stagesDir = join(runDir, 'stages');
      if (existsSync(stagesDir)) {
        try {
          const stages = readdirSync(stagesDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => d.name);

          for (const stage of stages) {
            const stageObs = join(stagesDir, stage, 'observations.jsonl');
            if (existsSync(stageObs)) {
              all.push(...JsonlStore.readAll(stageObs, ObservationSchema));
            }
          }
        } catch {
          // Non-critical — skip silently
        }
      }
    }

    return all;
  }
}

// ---------------------------------------------------------------------------
// Bridge-run fallback helper
// ---------------------------------------------------------------------------

/**
 * Build a betId → runId map by scanning bridge-run files for the given cycle.
 *
 * This is the fallback used by collectObservations() when bet.runId is not set
 * on the cycle record (e.g., staged-workflow cycles launched before
 * backfillRunIdInCycle was wired — mirrors the fix in writeSynthesisInput,
 * fixes #348).
 *
 * Returns an empty Map when bridgeRunsDir is missing or unreadable.
 */
function loadBridgeRunIdsByBetId(cycleId: string, bridgeRunsDir: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!existsSync(bridgeRunsDir)) return result;

  let files: string[];
  try {
    files = readdirSync(bridgeRunsDir).filter((f) => f.endsWith('.json'));
  } catch {
    return result;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(bridgeRunsDir, file), 'utf-8');
      const meta = JSON.parse(raw) as { cycleId?: string; betId?: string; runId?: string };
      if (meta.cycleId === cycleId && meta.betId && meta.runId) {
        result.set(meta.betId, meta.runId);
      }
    } catch {
      // Skip unreadable / invalid bridge-run files
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Prompt builder (exported for testing)
// ---------------------------------------------------------------------------

export interface ProposalPromptInput {
  cycleName: string;
  completedBets: string[];
  frictionObservations: string[];
  gapObservations: string[];
  insightObservations: string[];
  milestoneIssues: MilestoneIssue[];
}

/**
 * Build the full synthesis prompt for next-keiko proposal generation.
 *
 * Exported for unit testing without requiring claude invocation.
 */
export function buildProposalPrompt(input: ProposalPromptInput): string {
  const lines: string[] = [];

  lines.push('You are kata-sensei generating ranked next-keiko (sprint) bet proposals.');
  lines.push('');
  lines.push('## Context');
  lines.push('');
  lines.push(`Cycle just completed: ${input.cycleName}`);
  lines.push('');

  // Completed bets
  if (input.completedBets.length > 0) {
    lines.push('### Completed bets this cycle');
    for (const b of input.completedBets) {
      lines.push(`  - ${b}`);
    }
    lines.push('');
  }

  // Friction observations
  if (input.frictionObservations.length > 0) {
    lines.push(`### Friction observations (${input.frictionObservations.length})`);
    for (const o of input.frictionObservations.slice(0, 20)) {
      lines.push(`  - ${o}`);
    }
    if (input.frictionObservations.length > 20) {
      lines.push(`  ... (${input.frictionObservations.length - 20} more)`);
    }
    lines.push('');
  }

  // Gap observations
  if (input.gapObservations.length > 0) {
    lines.push(`### Gap observations (${input.gapObservations.length})`);
    for (const o of input.gapObservations.slice(0, 20)) {
      lines.push(`  - ${o}`);
    }
    if (input.gapObservations.length > 20) {
      lines.push(`  ... (${input.gapObservations.length - 20} more)`);
    }
    lines.push('');
  }

  // Insight observations
  if (input.insightObservations.length > 0) {
    lines.push(`### Insight observations (${input.insightObservations.length})`);
    for (const o of input.insightObservations.slice(0, 15)) {
      lines.push(`  - ${o}`);
    }
    if (input.insightObservations.length > 15) {
      lines.push(`  ... (${input.insightObservations.length - 15} more)`);
    }
    lines.push('');
  }

  // Milestone issues
  if (input.milestoneIssues.length > 0) {
    lines.push(`### Open milestone issues (${input.milestoneIssues.length})`);
    for (const issue of input.milestoneIssues) {
      const labels = issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
      lines.push(`  - #${issue.number}: ${issue.title}${labels}`);
    }
    lines.push('');
  }

  lines.push('## Task');
  lines.push('');
  lines.push(
    'Propose 6-8 ranked bets for the next keiko. For each bet, suggest an appetite size (S = small ~1 session, M = medium ~2-3 sessions, L = large ~4+ sessions) based on the issue labels and observation signal.',
  );
  lines.push('');
  lines.push('Output EXACTLY this format (no other text):');
  lines.push('');
  lines.push('=== Next Keiko Proposals ===');
  lines.push('');
  lines.push('Recommended bets (ranked):');
  lines.push(
    '  1. <issue title or description> (#NNN if from issue list)    appetite: S|M|L    signal: <one-line rationale>',
  );
  lines.push(
    '  2. <issue title or description> (#NNN if from issue list)    appetite: S|M|L    signal: <one-line rationale>',
  );
  lines.push('  ... (continue for all 6-8 bets)');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output formatter
// ---------------------------------------------------------------------------

function buildFooter(
  counts: { friction: number; gap: number; total: number },
  issueCount: number,
): string {
  const parts: string[] = [];
  if (counts.friction > 0) parts.push(`${counts.friction} friction observation${counts.friction !== 1 ? 's' : ''}`);
  if (counts.gap > 0) parts.push(`${counts.gap} gap observation${counts.gap !== 1 ? 's' : ''}`);
  if (issueCount > 0) parts.push(`${issueCount} open milestone issue${issueCount !== 1 ? 's' : ''}`);

  if (parts.length === 0) return 'Based on: cycle history';
  return `Based on: ${parts.join(', ')}`;
}

/**
 * Format the raw LLM output into the final output, appending the footer.
 * If the LLM already includes the header, we use its output as-is.
 * If not, we wrap it.
 */
function formatOutput(
  rawOutput: string,
  observationCounts: NextKeikoResult['observationCounts'],
  milestoneIssueCount: number,
): string {
  const trimmed = rawOutput.trim();

  // Extract the proposals block — look for our expected header
  const headerIdx = trimmed.indexOf('=== Next Keiko Proposals ===');
  const proposalsText = headerIdx >= 0 ? trimmed.slice(headerIdx) : trimmed;

  const footer = buildFooter(observationCounts, milestoneIssueCount);

  // If the output already ends with a "Based on:" line, replace it; otherwise append
  const hasFooter = proposalsText.match(/^Based on:/m);
  if (hasFooter) {
    return proposalsText.replace(/^Based on:.*$/m, footer);
  }

  return `${proposalsText}\n\n${footer}`;
}

// ---------------------------------------------------------------------------
// Default I/O implementations
// ---------------------------------------------------------------------------

function defaultInvokeClaude(prompt: string): string {
  return execFileSync('claude', ['--print'], {
    input: prompt,
    encoding: 'utf-8',
    timeout: 120_000,
  });
}

function defaultFetchMilestoneIssues(milestoneName: string): MilestoneIssue[] {
  const raw = execFileSync(
    'gh',
    [
      'issue',
      'list',
      '--milestone',
      milestoneName,
      '--state',
      'open',
      '--json',
      'number,title,labels',
      '--limit',
      '50',
    ],
    { encoding: 'utf-8', timeout: 30_000 },
  );

  const parsed = JSON.parse(raw) as Array<{
    number: number;
    title: string;
    labels: Array<{ name: string }>;
  }>;

  return parsed.map((issue) => ({
    number: issue.number,
    title: issue.title,
    labels: issue.labels.map((l) => l.name),
  }));
}
