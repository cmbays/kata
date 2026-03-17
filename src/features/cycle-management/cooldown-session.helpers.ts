import { join } from 'node:path';
import type { BudgetAlertLevel } from '@domain/types/cycle.js';
import type { ExecutionHistoryEntry } from '@domain/types/history.js';
import type { Learning } from '@domain/types/learning.js';
import type { Observation } from '@domain/types/observation.js';
import type { SynthesisInput, SynthesisProposal } from '@domain/types/synthesis.js';
import type { BeltComputeResult } from '@features/belt/belt-calculator.js';

export interface CooldownHelperBetOutcome {
  betId: string;
  outcome: 'complete' | 'partial' | 'abandoned';
  notes?: string;
  betDescription?: string;
}

export interface CooldownDiaryBetSource {
  id: string;
  outcome: string;
  outcomeNotes?: string;
  description: string;
}

export interface CooldownBudgetUsage {
  utilizationPercent: number;
  alertLevel?: BudgetAlertLevel;
}

export interface CooldownLearningContext {
  cycleId: string;
  cycleName?: string;
  completionRate: number;
  betCount: number;
  tokenBudget?: number;
  utilizationPercent: number;
  tokensUsed: number;
}

export interface CooldownLearningDraft {
  category: 'cycle-management' | 'budget-management';
  content: string;
  confidence: number;
  observation: string;
}

export interface DojoSessionBuildRequest {
  diaryDir: string;
  runsDir: string;
  title: string;
}

export function shouldWarnOnIncompleteRuns(incompleteRunsCount: number, force: boolean): boolean {
  return incompleteRunsCount > 0 && !force;
}

export function selectEffectiveBetOutcomes(
  explicitBetOutcomes: readonly CooldownHelperBetOutcome[],
  syncedBetOutcomes: readonly CooldownHelperBetOutcome[],
): CooldownHelperBetOutcome[] {
  return explicitBetOutcomes.length > 0
    ? [...explicitBetOutcomes]
    : [...syncedBetOutcomes];
}

export function buildDiaryBetOutcomesFromCycleBets(bets: readonly CooldownDiaryBetSource[]): CooldownHelperBetOutcome[] {
  return bets
    .filter((bet) => bet.outcome !== 'pending')
    .map((bet) => ({
      betId: bet.id,
      outcome: bet.outcome as CooldownHelperBetOutcome['outcome'],
      notes: bet.outcomeNotes,
      betDescription: bet.description,
    }));
}

export function clampConfidenceWithDelta(existingConfidence: number, confidenceDelta: number): number {
  return Math.min(1, Math.max(0, existingConfidence + confidenceDelta));
}

export function buildCooldownBudgetUsage(
  tokenBudget: number | undefined,
  tokensUsed: number,
  currentAlertLevel: BudgetAlertLevel | undefined,
): CooldownBudgetUsage {
  const utilizationPercent = tokenBudget && tokenBudget > 0
    ? (tokensUsed / tokenBudget) * 100
    : 0;

  let alertLevel = currentAlertLevel;
  if (tokenBudget) {
    if (utilizationPercent >= 100) {
      alertLevel = 'critical';
    } else if (utilizationPercent >= 90) {
      alertLevel = 'warning';
    } else if (utilizationPercent >= 75) {
      alertLevel = 'info';
    } else {
      alertLevel = undefined;
    }
  }

  return {
    utilizationPercent,
    alertLevel,
  };
}

export function mapBridgeRunStatusToSyncedOutcome(
  status: string | undefined,
): CooldownHelperBetOutcome['outcome'] | undefined {
  if (status === 'complete') return 'complete';
  if (status === 'failed') return 'partial';
  return undefined;
}

export function mapBridgeRunStatusToIncompleteStatus(
  status: string | undefined,
): 'running' | undefined {
  return status === 'in-progress' ? 'running' : undefined;
}

export function filterExecutionHistoryForCycle(
  entries: readonly ExecutionHistoryEntry[],
  cycleId: string,
): ExecutionHistoryEntry[] {
  return entries.filter((entry) => entry.cycleId === cycleId);
}

export function buildCooldownLearningDrafts(context: CooldownLearningContext): CooldownLearningDraft[] {
  const drafts: CooldownLearningDraft[] = [];
  const cycleLabel = context.cycleName ?? context.cycleId;

  if (context.betCount > 0 && context.completionRate < 50) {
    drafts.push({
      category: 'cycle-management',
      content: `Cycle "${cycleLabel}" had low completion rate (${context.completionRate.toFixed(1)}%). Consider reducing scope or breaking bets into smaller chunks.`,
      confidence: 0.6,
      observation: `${context.betCount} bets, ${context.completionRate.toFixed(1)}% completion`,
    });
  }

  if (context.tokenBudget) {
    if (context.utilizationPercent > 100) {
      drafts.push({
        category: 'budget-management',
        content: `Cycle "${cycleLabel}" exceeded token budget (${context.utilizationPercent.toFixed(1)}% utilization). Consider more conservative estimates.`,
        confidence: 0.7,
        observation: `${context.tokensUsed} tokens used of ${context.tokenBudget} budget`,
      });
    } else if (context.utilizationPercent < 30 && context.betCount > 0) {
      drafts.push({
        category: 'budget-management',
        content: `Cycle "${cycleLabel}" significantly under-utilized token budget (${context.utilizationPercent.toFixed(1)}%). Could have taken on more work.`,
        confidence: 0.5,
        observation: `${context.tokensUsed} tokens used of ${context.tokenBudget} budget`,
      });
    }
  }

  return drafts;
}

export function buildExpiryCheckMessages(input: {
  archived: { length: number };
  flaggedStale: { length: number };
}): string[] {
  const messages: string[] = [];

  if (input.archived.length > 0) {
    messages.push(`Expiry check: auto-archived ${input.archived.length} expired operational learnings`);
  }

  if (input.flaggedStale.length > 0) {
    messages.push(`Expiry check: flagged ${input.flaggedStale.length} stale strategic learnings for review`);
  }

  return messages;
}

export function buildBeltAdvancementMessage(
  beltResult: Pick<BeltComputeResult, 'leveledUp' | 'previous' | 'belt'> | undefined,
): string | undefined {
  if (!beltResult?.leveledUp) {
    return undefined;
  }

  return `Belt advanced: ${beltResult.previous} → ${beltResult.belt}`;
}

export function buildDojoSessionBuildRequest(input: {
  dojoDir: string;
  cycleId: string;
  cycleName?: string;
  runsDir?: string;
}): DojoSessionBuildRequest {
  return {
    diaryDir: join(input.dojoDir, 'diary'),
    runsDir: input.runsDir ?? join(input.dojoDir, '..', 'runs'),
    title: input.cycleName
      ? `Cooldown — ${input.cycleName}`
      : `Cooldown — ${input.cycleId.slice(0, 8)}`,
  };
}

export function buildSynthesisInputRecord(input: {
  id: string;
  cycleId: string;
  createdAt: string;
  depth: import('@domain/types/synthesis.js').SynthesisDepth;
  observations: Observation[];
  learnings: Learning[];
  cycleName?: string;
  tokenBudget?: number;
  tokensUsed: number;
}): SynthesisInput {
  return {
    id: input.id,
    cycleId: input.cycleId,
    createdAt: input.createdAt,
    depth: input.depth,
    observations: input.observations,
    learnings: input.learnings,
    cycleName: input.cycleName,
    tokenBudget: input.tokenBudget,
    tokensUsed: input.tokensUsed,
  };
}

export function resolveAppliedProposalIds(
  proposals: ReadonlyArray<{ id: string }>,
  acceptedProposalIds?: readonly string[],
): Set<string> {
  return acceptedProposalIds
    ? new Set(acceptedProposalIds)
    : new Set(proposals.map((proposal) => proposal.id));
}

export function buildAgentPerspectiveFromProposals(proposals: readonly SynthesisProposal[]): string | undefined {
  if (proposals.length === 0) return undefined;

  return [
    '## Agent Perspective (Synthesis)',
    '',
    ...proposals.flatMap((proposal) => [...formatAgentPerspectiveProposal(proposal), '']),
  ].join('\n').trimEnd();
}

function formatAgentPerspectiveProposal(proposal: SynthesisProposal): string[] {
  switch (proposal.type) {
    case 'new-learning':
      return [
        `**New learning** [${proposal.proposedTier}/${proposal.proposedCategory}] (confidence: ${proposal.confidence.toFixed(2)}):`,
        `  ${proposal.proposedContent}`,
      ];
    case 'update-learning':
      return formatUpdateLearningPerspective(proposal.confidenceDelta, proposal.proposedContent);
    case 'promote':
      return [`**Promoted learning** to ${proposal.toTier} tier.`];
    case 'archive':
      return [`**Archived learning**: ${proposal.reason}`];
    case 'methodology-recommendation':
      return [
        `**Methodology recommendation** (${proposal.area}):`,
        `  ${proposal.recommendation}`,
      ];
  }
}

function formatUpdateLearningPerspective(confidenceDelta: number, proposedContent: string): string[] {
  const prefix = confidenceDelta > 0 ? '+' : '';
  return [
    `**Updated learning** (confidence delta: ${prefix}${confidenceDelta.toFixed(2)}):`,
    `  ${proposedContent}`,
  ];
}

export function listCompletedBetDescriptions(
  bets: ReadonlyArray<{ outcome: string; description: string }>,
): string[] {
  return bets
    .filter((bet) => bet.outcome === 'complete' || bet.outcome === 'partial')
    .map((bet) => bet.description);
}

export { isJsonFile } from '@shared/lib/file-filters.js';

export function isSynthesisPendingFile(filename: string): boolean {
  return filename.startsWith('pending-') && filename.endsWith('.json');
}

/**
 * Pure filter: returns true for bets that are eligible for auto-sync
 * (outcome is still 'pending' AND the bet has a runId assigned).
 */
export function isSyncableBet(bet: { outcome: string; runId?: string }): boolean {
  return bet.outcome === 'pending' && Boolean(bet.runId);
}

/**
 * Build a betId → runId mapping from an array of bridge-run metadata records.
 * Only includes records that match the target cycleId and have both betId and runId.
 */
export function collectBridgeRunIds(
  metas: ReadonlyArray<{ cycleId?: string; betId?: string; runId?: string }>,
  targetCycleId: string,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const meta of metas) {
    if (meta.cycleId === targetCycleId && meta.betId && meta.runId) {
      result.set(meta.betId, meta.runId);
    }
  }
  return result;
}

