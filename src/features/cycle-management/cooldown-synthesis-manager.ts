import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import type { IKnowledgeStore } from '@domain/ports/knowledge-store.js';
import type { Cycle } from '@domain/types/cycle.js';
import type { Observation } from '@domain/types/observation.js';
import {
  SynthesisInputSchema,
  SynthesisResultSchema,
  type SynthesisProposal,
  type SynthesisDepth,
} from '@domain/types/synthesis.js';
import type { CooldownReport } from '@domain/services/cycle-manager.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { readAllObservationsForRun, readRun } from '@infra/persistence/run-store.js';
import { logger } from '@shared/lib/logger.js';
import {
  buildSynthesisInputRecord,
  clampConfidenceWithDelta,
  isSynthesisPendingFile,
  resolveAppliedProposalIds,
} from './cooldown-session.helpers.js';

/**
 * Dependencies injected into CooldownSynthesisManager for testability.
 */
export interface CooldownSynthesisDeps {
  synthesisDir?: string;
  runsDir?: string;
  knowledgeStore: IKnowledgeStore;
  /** Returns a map of betId → runId from bridge-run metadata for the given cycle. */
  loadBridgeRunIdsByBetId: (cycleId: string) => Map<string, string>;
}

/**
 * Handles synthesis I/O during cooldown.
 *
 * Extracted from CooldownSession to isolate the synthesis data collection,
 * result reading, and proposal application logic from the cooldown orchestration.
 *
 * Two public entry points:
 * - writeInput(): collects observations + learnings, writes a SynthesisInput file
 * - readAndApplyResults(): reads a SynthesisResult file, applies accepted proposals
 *
 * Non-critical: all failures are logged as warnings and never abort cooldown.
 */
export class CooldownSynthesisManager {
  constructor(private readonly deps: CooldownSynthesisDeps) {}

  /**
   * Collect observations and learnings, then write a SynthesisInput file.
   * Cleans up stale input files for the same cycle before writing.
   * Returns placeholder values when synthesisDir is not configured.
   */
  writeInput(
    cycleId: string,
    cycle: Cycle,
    report: CooldownReport,
    depth: SynthesisDepth,
  ): { synthesisInputId: string; synthesisInputPath: string } {
    const target = this.createSynthesisTarget();
    if (!target.synthesisDir) {
      return { synthesisInputId: target.id, synthesisInputPath: '' };
    }

    try {
      const synthesisInput = buildSynthesisInputRecord({
        id: target.id,
        cycleId,
        createdAt: new Date().toISOString(),
        depth,
        observations: this.collectObservations(cycleId, cycle),
        learnings: this.loadLearnings(),
        cycleName: cycle.name,
        tokenBudget: report.budget.tokenBudget,
        tokensUsed: report.tokensUsed,
      });

      this.cleanupStaleInputs(target.synthesisDir, cycleId);
      JsonStore.write(target.filePath, synthesisInput, SynthesisInputSchema);

      return { synthesisInputId: target.id, synthesisInputPath: target.filePath };
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      // Stryker disable next-line all: presentation text in warning message
      logger.warn(`Failed to write synthesis input for cycle ${cycleId}: ${err instanceof Error ? err.message : String(err)}`);
      return { synthesisInputId: target.id, synthesisInputPath: '' };
    }
  }

  /**
   * Read a SynthesisResult file and apply accepted proposals to the knowledge store.
   * Returns the list of successfully applied proposals, or undefined if no result exists.
   */
  readAndApplyResults(
    synthesisInputId?: string,
    acceptedProposalIds?: readonly string[],
  ): SynthesisProposal[] | undefined {
    const resultPath = this.resolveResultPath(synthesisInputId);
    if (!resultPath || !existsSync(resultPath)) return undefined;

    try {
      const synthesisResult = JsonStore.read(resultPath, SynthesisResultSchema);
      return this.applyAcceptedProposals(synthesisResult.proposals, acceptedProposalIds);
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      // Stryker disable next-line all: presentation text in warning message
      logger.warn(`Failed to read synthesis result for input ${synthesisInputId}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  // -- Private: synthesis target ------------------------------------------------

  private createSynthesisTarget(): { id: string; synthesisDir?: string; filePath: string } {
    const id = crypto.randomUUID();
    const synthesisDir = this.deps.synthesisDir;
    // Stryker disable next-line StringLiteral: empty fallback when synthesisDir is absent — never used for writes
    const filePath = synthesisDir ? join(synthesisDir, `pending-${id}.json`) : '';
    return { id, synthesisDir, filePath };
  }

  // -- Private: observation collection ------------------------------------------

  private collectObservations(cycleId: string, cycle: Cycle): Observation[] {
    const observations: Observation[] = [];
    // Stryker disable next-line ConditionalExpression: guard redundant with catch in readObservationsForRun
    if (!this.deps.runsDir) return observations;

    const bridgeRunIdByBetId = this.deps.loadBridgeRunIdsByBetId(cycleId);

    for (const bet of cycle.bets) {
      const runId = bet.runId ?? bridgeRunIdByBetId.get(bet.id);
      if (!runId) continue;

      const runObs = this.readObservationsForRun(runId, bet.id);
      // Stryker disable next-line ConditionalExpression: push(...[]) is a no-op — guard is equivalent
      if (runObs.length > 0) {
        observations.push(...runObs);
      }
    }

    return observations;
  }

  private readObservationsForRun(runId: string, betId: string): Observation[] {
    try {
      const stageSequence = this.readStageSequence(runId);
      return readAllObservationsForRun(this.deps.runsDir!, runId, stageSequence);
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      logger.warn(`Failed to read observations for run ${runId} (bet ${betId}): ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private readStageSequence(runId: string): import('@domain/types/stage.js').StageCategory[] {
    try {
      return readRun(this.deps.runsDir!, runId).stageSequence;
    } catch {
      return [];
    }
  }

  // -- Private: learnings loading -----------------------------------------------

  private loadLearnings(): import('@domain/types/learning.js').Learning[] {
    try {
      return this.deps.knowledgeStore.query({});
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      logger.warn(`Failed to query learnings for synthesis input: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  // -- Private: stale input cleanup ---------------------------------------------

  private cleanupStaleInputs(synthesisDir: string, cycleId: string): void {
    try {
      const existing = readdirSync(synthesisDir).filter(isSynthesisPendingFile);
      for (const file of existing) {
        this.removeStaleInputFile(synthesisDir, file, cycleId);
      }
    } catch {
      // Non-critical — if cleanup fails, still write the new file
    }
  }

  private removeStaleInputFile(synthesisDir: string, file: string, cycleId: string): void {
    try {
      const raw = readFileSync(join(synthesisDir, file), 'utf-8');
      const meta = JSON.parse(raw) as { cycleId?: string };
      if (meta.cycleId !== cycleId) return;
      unlinkSync(join(synthesisDir, file));
      // Stryker disable next-line StringLiteral: presentation text in debug log
      logger.debug(`Removed stale synthesis input file: ${file}`);
    } catch {
      // Skip unreadable / already-deleted files
    }
  }

  // -- Private: result reading and proposal application -------------------------

  private resolveResultPath(synthesisInputId?: string): string | undefined {
    if (!synthesisInputId || !this.deps.synthesisDir) return undefined;
    return join(this.deps.synthesisDir, `result-${synthesisInputId}.json`);
  }

  private applyAcceptedProposals(
    proposals: readonly SynthesisProposal[],
    acceptedProposalIds?: readonly string[],
  ): SynthesisProposal[] {
    const idsToApply = resolveAppliedProposalIds(proposals, acceptedProposalIds);
    const appliedProposals: SynthesisProposal[] = [];

    for (const proposal of proposals) {
      if (!idsToApply.has(proposal.id)) continue;
      if (this.tryApplyProposal(proposal)) {
        appliedProposals.push(proposal);
      }
    }

    return appliedProposals;
  }

  private tryApplyProposal(proposal: SynthesisProposal): boolean {
    try {
      this.applyProposal(proposal);
      return true;
    // Stryker disable next-line all: catch block is pure error-reporting
    } catch (err) {
      logger.warn(`Failed to apply synthesis proposal ${proposal.id} (${proposal.type}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  private applyProposal(proposal: SynthesisProposal): void {
    switch (proposal.type) {
      case 'new-learning':
        this.deps.knowledgeStore.capture({
          tier: proposal.proposedTier,
          category: proposal.proposedCategory,
          content: proposal.proposedContent,
          confidence: proposal.confidence,
          source: 'synthesized',
        });
        break;

      case 'update-learning': {
        const existing = this.deps.knowledgeStore.get(proposal.targetLearningId);
        const newConfidence = clampConfidenceWithDelta(existing.confidence, proposal.confidenceDelta);
        this.deps.knowledgeStore.update(proposal.targetLearningId, {
          content: proposal.proposedContent,
          confidence: newConfidence,
        });
        break;
      }

      case 'promote':
        this.deps.knowledgeStore.promoteTier(proposal.targetLearningId, proposal.toTier);
        break;

      case 'archive':
        this.deps.knowledgeStore.archiveLearning(proposal.targetLearningId, proposal.reason);
        break;

      case 'methodology-recommendation':
        // Sensei writes methodology-recommendation to KATA.md — we only log here
        logger.info(`Methodology recommendation (area: ${proposal.area}): ${proposal.recommendation}`);
        break;
    }
  }
}
