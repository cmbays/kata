import type { Cycle } from '@domain/types/cycle.js';
import type { Bet } from '@domain/types/bet.js';
import { BetSchema, BetOutcome } from '@domain/types/bet.js';
import { KataError } from '@shared/lib/errors.js';
import { validateAppetite } from '@domain/rules/budget-rules.js';

/**
 * Find a bet within a cycle. Throws if not found.
 */
export function requireBet(cycle: Cycle, betId: string): Bet {
  const bet = cycle.bets.find((b) => b.id === betId);
  if (!bet) {
    throw new KataError(`Bet "${betId}" not found in cycle "${cycle.name ?? cycle.id}".`);
  }
  return bet;
}

/**
 * Create and validate a new bet for a cycle.
 * Returns the new bet. Throws if appetite would exceed budget.
 */
export function createBet(cycle: Cycle, input: Omit<Bet, 'id'>): Bet {
  const newBet = BetSchema.parse({
    ...input,
    id: crypto.randomUUID(),
  });

  const allBets = [...cycle.bets, newBet];
  const validation = validateAppetite(allBets, cycle.cooldownReserve);
  if (!validation.valid) {
    throw new Error(`Cannot add bet: ${validation.errors.join('; ')}`);
  }

  return newBet;
}

/**
 * Set a bet's outcome, but only if it is currently pending.
 * Returns true if the outcome was updated, false if already resolved.
 */
export function trySetBetOutcome(
  cycle: Cycle,
  betId: string,
  outcome: 'complete' | 'partial',
): boolean {
  const bet = requireBet(cycle, betId);
  if (bet.outcome !== 'pending') {
    return false;
  }
  bet.outcome = outcome;
  return true;
}

/**
 * Apply batch outcome updates to bets. Returns unmatched bet IDs.
 */
export function applyBetOutcomes(
  cycle: Cycle,
  outcomes: Array<{ betId: string; outcome: string; notes?: string }>,
): string[] {
  const unmatchedBetIds: string[] = [];

  for (const record of outcomes) {
    const parsed = BetOutcome.safeParse(record.outcome);
    if (!parsed.success) {
      throw new Error(
        `Invalid bet outcome "${record.outcome}". Must be one of: pending, complete, partial, abandoned`,
      );
    }

    const bet = cycle.bets.find((b) => b.id === record.betId);
    if (bet) {
      bet.outcome = parsed.data;
      if (record.notes) {
        bet.outcomeNotes = record.notes;
      }
    } else {
      unmatchedBetIds.push(record.betId);
    }
  }

  return unmatchedBetIds;
}
