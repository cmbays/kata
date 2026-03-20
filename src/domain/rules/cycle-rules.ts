import type { CycleState } from '@domain/types/cycle.js';

/**
 * Valid cycle state transitions.
 *
 * The cycle state machine is linear: planning → active → cooldown → complete.
 * No backward transitions, no skipping states.
 */
const ALLOWED_TRANSITIONS: Partial<Record<CycleState, CycleState>> = {
  planning: 'active',
  active: 'cooldown',
  cooldown: 'complete',
};

/**
 * Check whether a cycle state transition is allowed.
 */
export function canTransitionCycleState(from: CycleState, to: CycleState): boolean {
  return ALLOWED_TRANSITIONS[from] === to;
}
