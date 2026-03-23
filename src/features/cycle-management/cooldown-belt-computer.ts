import type { BeltCalculator } from '@features/belt/belt-calculator.js';
import { loadProjectState, type BeltComputeResult } from '@features/belt/belt-calculator.js';
import type { KataAgentConfidenceCalculator } from '@features/kata-agent/kata-agent-confidence-calculator.js';
import { logger } from '@shared/lib/logger.js';
import { buildBeltAdvancementMessage } from './cooldown-session.helpers.js';

export interface CooldownAgentRegistry {
  list(): Array<{ id: string; name: string }>;
}

/**
 * Dependencies injected into CooldownBeltComputer for testability.
 */
export interface CooldownBeltDeps {
  beltCalculator?: Pick<BeltCalculator, 'computeAndStore'>;
  projectStateFile?: string;
  agentConfidenceCalculator?: Pick<KataAgentConfidenceCalculator, 'compute'>;
  agentRegistry?: CooldownAgentRegistry;
}

/**
 * Computes belt advancement and per-agent confidence profiles during cooldown.
 *
 * Extracted from CooldownSession to isolate optional post-cooldown computations
 * from the cooldown orchestration logic.
 */
export class CooldownBeltComputer {
  constructor(private readonly deps: CooldownBeltDeps) {}

  /**
   * Recompute the practitioner's belt level from current project state.
   * Returns the belt result when belt evaluation is fully configured
   * (both calculator and project state file present), otherwise undefined.
   *
   * Non-critical: computation errors are logged as warnings and swallowed
   * so that belt evaluation failures do not abort cooldown.
   */
  compute(): BeltComputeResult | undefined {
    if (!this.deps.beltCalculator || !this.deps.projectStateFile) return undefined;

    try {
      const state = loadProjectState(this.deps.projectStateFile);
      const beltResult = this.deps.beltCalculator.computeAndStore(this.deps.projectStateFile, state);
      const beltAdvanceMessage = buildBeltAdvancementMessage(beltResult);
      if (beltAdvanceMessage) {
        logger.info(beltAdvanceMessage);
      }
      return beltResult;
    // Stryker disable next-line all: catch block is pure error-reporting — non-critical logging
    } catch (err) {
      logger.warn(`Belt computation failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /**
   * Recompute confidence profiles for all registered agents.
   *
   * Non-critical: computation errors are logged as warnings and swallowed
   * so that agent confidence failures do not abort cooldown.
  */
  computeAgentConfidence(): void {
    if (!this.deps.agentConfidenceCalculator || !this.deps.agentRegistry) return;

    let agents: { id: string; name: string }[];
    try {
      agents = this.deps.agentRegistry.list();
    // Stryker disable next-line all: catch block is pure error-reporting — registry load failure
    } catch (err) {
      logger.warn(`Agent confidence computation failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    for (const agent of agents) {
      try {
        this.deps.agentConfidenceCalculator.compute(agent.id, agent.name);
      // Stryker disable next-line all: catch block is pure error-reporting — per-agent failure
      } catch (err) {
        logger.warn(`Confidence computation failed for agent "${agent.name}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
