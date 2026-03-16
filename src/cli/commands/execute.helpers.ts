import { z } from 'zod/v4';
import { FlavorHintSchema } from '@domain/types/saved-kata.js';
import { StageCategorySchema } from '@domain/types/stage.js';

export const parseSuccessSchema = z.object({
  ok: z.literal(true),
  value: z.unknown(),
});

export const parseFailureSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
});

export const parseResultSchema = z.discriminatedUnion('ok', [
  parseSuccessSchema,
  parseFailureSchema,
]);

export const explainMatchReportSchema = z.object({
  flavorName: z.string(),
  score: z.number(),
  keywordHits: z.number(),
  ruleAdjustments: z.number(),
  learningBoost: z.number(),
  reasoning: z.string(),
});

export type ParseSuccess = z.infer<typeof parseSuccessSchema>;
export type ParseFailure = z.infer<typeof parseFailureSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
export type ExplainMatchReport = z.infer<typeof explainMatchReportSchema>;
export type CompletedRunArtifact = { name: string; path?: string };
export type CompletedRunTokenUsage = {
  hasTokens: boolean;
  totalTokens?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    total: number;
  };
};

export interface PreparedCycleOutput {
  cycleName: string;
  preparedRuns: ReadonlyArray<{
    betName: string;
    runId: string;
    stages: readonly string[];
    isolation: string;
  }>;
}

export interface PreparedRunOutput {
  betName: string;
  runId: string;
  cycleName: string;
  stages: readonly string[];
  isolation: string;
}

const _betOptionResultSchema = z.discriminatedUnion('ok', [
  parseSuccessSchema.extend({
    value: z.record(z.string(), z.unknown()).optional(),
  }),
  parseFailureSchema,
]);

const _hintFlagResultSchema = z.discriminatedUnion('ok', [
  parseSuccessSchema.extend({
    value: z.record(z.string(), FlavorHintSchema).optional(),
  }),
  parseFailureSchema,
]);

type BetOptionResult = z.infer<typeof _betOptionResultSchema>;
type HintFlagResult = z.infer<typeof _hintFlagResultSchema>;

const _completedRunArtifactSchema = z.object({
  name: z.string(),
  path: z.string().optional(),
}).passthrough();

const _completedRunArtifactsSchema = z.array(_completedRunArtifactSchema);

const _completedRunTokenUsageSchema = z.object({
  hasTokens: z.boolean(),
  totalTokens: z.number().nonnegative().optional(),
  tokenUsage: z.object({
    inputTokens: z.number().nonnegative().optional(),
    outputTokens: z.number().nonnegative().optional(),
    total: z.number().nonnegative(),
  }).optional(),
});

export function formatExplain(
  stageCategory: string,
  selectedFlavors: readonly string[],
  matchReports?: ExplainMatchReport[],
): string {
  const lines: string[] = [];
  const selectedSet = new Set(selectedFlavors);

  lines.push(`Flavor scoring for stage: ${stageCategory}`);

  if (!matchReports || matchReports.length === 0) {
    lines.push(`  Selected: ${selectedFlavors.join(', ')} (no scoring data — flavor was pinned or vocabulary unavailable)`);
    return lines.join('\n');
  }

  const sorted = [...matchReports].sort((a, b) => b.score - a.score);

  lines.push('');
  lines.push('  Flavor scores:');
  for (const report of sorted) {
    const selected = selectedSet.has(report.flavorName) ? '  <- selected' : '';
    lines.push(`    ${report.flavorName.padEnd(24)}  score: ${report.score.toFixed(2)}${selected}`);
  }

  lines.push('');
  lines.push('  Scoring factors:');
  for (const report of sorted) {
    if (!selectedSet.has(report.flavorName) && report.score === 0 && sorted[0]!.score > 0) continue;
    lines.push(`    ${report.flavorName}:`);
    lines.push(`      keyword hits:      ${report.keywordHits}`);
    if (report.learningBoost > 0) {
      lines.push(`      learning boost:    +${report.learningBoost.toFixed(2)}`);
    }
    if (report.ruleAdjustments !== 0) {
      const sign = report.ruleAdjustments > 0 ? '+' : '';
      lines.push(`      rule adjustments:  ${sign}${report.ruleAdjustments.toFixed(2)}`);
    }
    lines.push(`      reasoning:         ${report.reasoning}`);
  }

  return lines.join('\n');
}

export function parseBetOption(betJson: string | undefined): BetOptionResult {
  if (betJson === undefined) {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(betJson);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        ok: false,
        error: 'Error: --bet must be a JSON object (e.g., \'{"title":"Add search"}\')',
      };
    }

    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: 'Error: --bet must be valid JSON' };
  }
}

export function parseHintFlags(hints: readonly string[] | undefined): HintFlagResult {
  if (!hints || hints.length === 0) {
    return { ok: true, value: undefined };
  }

  const result: Record<string, z.infer<typeof FlavorHintSchema>> = {};
  const validCategories = StageCategorySchema.options;

  for (const spec of hints) {
    const parts = spec.split(':');
    if (parts.length < 2 || parts.length > 3) {
      return {
        ok: false,
        error: `Error: invalid --hint format "${spec}". Expected: stage:flavor1,flavor2[:strategy]`,
      };
    }

    const stage = parts[0]!;
    if (!validCategories.includes(stage as typeof validCategories[number])) {
      return {
        ok: false,
        error: `Error: invalid stage category "${stage}" in --hint. Valid: ${validCategories.join(', ')}`,
      };
    }

    const flavors = parts[1]!.split(',').map((value) => value.trim()).filter(Boolean);
    if (flavors.length === 0) {
      return {
        ok: false,
        error: `Error: --hint "${spec}" has no flavor names.`,
      };
    }

    const strategy = parts[2];
    if (strategy === '' || (strategy !== undefined && strategy !== 'prefer' && strategy !== 'restrict')) {
      return {
        ok: false,
        error: `Error: invalid strategy "${strategy}" in --hint. Valid: prefer, restrict`,
      };
    }

    result[stage] = { recommended: flavors, strategy: strategy ?? 'prefer' };
  }

  return { ok: true, value: result };
}

export function parseCompletedRunArtifacts(artifactsJson: string | undefined): ParseResult {
  if (artifactsJson === undefined) {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(artifactsJson);
    const artifacts = _completedRunArtifactsSchema.safeParse(parsed);
    if (!artifacts.success) {
      return {
        ok: false,
        error: Array.isArray(parsed)
          ? 'Error: each artifact must have a "name" string property'
          : 'Error: --artifacts must be a JSON array',
      };
    }

    return { ok: true, value: artifacts.data as CompletedRunArtifact[] };
  } catch {
    return {
      ok: false,
      error: 'Error: --artifacts must be valid JSON',
    };
  }
}

export function parseCompletedRunTokenUsage(inputTokens: number | undefined, outputTokens: number | undefined): ParseResult {
  if (inputTokens !== undefined && (Number.isNaN(inputTokens) || inputTokens < 0)) {
    return {
      ok: false,
      error: 'Error: --input-tokens must be a non-negative integer',
    };
  }

  if (outputTokens !== undefined && (Number.isNaN(outputTokens) || outputTokens < 0)) {
    return {
      ok: false,
      error: 'Error: --output-tokens must be a non-negative integer',
    };
  }

  const hasTokens = inputTokens !== undefined || outputTokens !== undefined;
  const totalTokens = hasTokens ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined;

  return {
    ok: true,
    value: _completedRunTokenUsageSchema.parse({
      hasTokens,
      totalTokens,
      tokenUsage: hasTokens
        ? {
          inputTokens,
          outputTokens,
          total: totalTokens,
        }
        : undefined,
    }) as CompletedRunTokenUsage,
  };
}

export function formatAgentLoadError(agentId: string, message: string): string {
  const normalizedMessage = message.trim();

  if (/^Agent\b.*\bnot found\.?$/i.test(normalizedMessage)) {
    return `Error: agent "${agentId}" not found. Use "kata agent list" to see registered agents.`;
  }

  const loadFailurePrefix = `Failed to load agent "${agentId}":`;
  if (normalizedMessage.startsWith(loadFailurePrefix)) {
    return `Error: ${normalizedMessage}`;
  }

  return `Error: Failed to load agent "${agentId}": ${normalizedMessage}`;
}

export function mergePinnedFlavors(
  primaryPins: readonly string[] | undefined,
  fallbackPins: readonly string[] | undefined,
): string[] | undefined {
  const merged = [...(primaryPins ?? []), ...(fallbackPins ?? [])];
  return merged.length > 0 ? merged : undefined;
}

export function buildPreparedCycleOutputLines(result: PreparedCycleOutput): string[] {
  const lines = [`Prepared ${result.preparedRuns.length} run(s) for cycle "${result.cycleName}"`];
  for (const run of result.preparedRuns) {
    lines.push(`  ${run.betName}`);
    lines.push(`    Run ID: ${run.runId}`);
    lines.push(`    Stages: ${run.stages.join(', ')}`);
    lines.push(`    Isolation: ${run.isolation}`);
  }
  return lines;
}

export function buildPreparedRunOutputLines(result: PreparedRunOutput, agentContextBlock: string): string[] {
  return [
    `Prepared run for bet: "${result.betName}"`,
    `  Run ID: ${result.runId}`,
    `  Cycle: ${result.cycleName}`,
    `  Stages: ${result.stages.join(', ')}`,
    `  Isolation: ${result.isolation}`,
    '',
    'Agent context block (use "kata kiai context <run-id>" to fetch at dispatch time):',
    agentContextBlock,
  ];
}

export function resolveJsonFlag(localJson: boolean | undefined, globalJson: boolean | undefined): boolean {
  return !!(localJson || globalJson);
}

export function betStatusSymbol(status: string): string {
  if (status === 'in-progress') return '\u27F3';
  if (status === 'complete') return '\u2713';
  if (status === 'failed') return '\u2717';
  return '\u00B7';
}

export function resolveCompletionStatus(failed: boolean | undefined): 'failed' | 'complete' {
  return failed ? 'failed' : 'complete';
}

export function assertValidKataName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      `Invalid kata name "${name}": names must contain only letters, digits, hyphens, and underscores.`,
    );
  }
}

export function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/**
 * Pure predicate: returns true when there are no gaps to bridge.
 */
export function hasNoGapsToBridge(gaps: readonly unknown[] | undefined): boolean {
  return !gaps || gaps.length === 0;
}

/**
 * Pure predicate: returns true when bridged gaps should be reported.
 */
export function hasBridgedGaps(bridged: readonly unknown[]): boolean {
  return bridged.length > 0;
}

/**
 * Pure predicate: returns true when blocked gaps should halt execution.
 */
export function hasBlockedGaps(blocked: readonly unknown[]): boolean {
  return blocked.length > 0;
}

/**
 * Format confidence as a percentage string (0-100, no decimal).
 */
export function formatConfidencePercent(confidence: number): string {
  return `${(confidence * 100).toFixed(0)}%`;
}

/**
 * Pure predicate: returns true when pipeline learnings should be printed.
 */
export function hasPipelineLearnings(learnings: readonly string[]): boolean {
  return learnings.length > 0;
}
