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

export function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
