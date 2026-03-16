import type { CycleState } from '@domain/types/cycle.js';

/**
 * Check whether a cycle state transition is allowed.
 * Valid transitions: planning → active → cooldown → complete.
 */
export function canTransitionCycleState(from: CycleState, to: CycleState): boolean {
  const allowedTransitions: Partial<Record<CycleState, CycleState>> = {
    planning: 'active',
    active: 'cooldown',
    cooldown: 'complete',
  };
  return allowedTransitions[from] === to;
}

/**
 * Detect whether bridge-run metadata has changed vs its refreshed values.
 */
export function hasBridgeRunMetadataChanged(
  current: { betName?: string; cycleName?: string },
  refreshed: { betName?: string; cycleName?: string },
): boolean {
  return refreshed.betName !== current.betName || refreshed.cycleName !== current.cycleName;
}

/**
 * Filter filenames to only .json files.
 */
export function isJsonFile(filename: string): boolean {
  return filename.endsWith('.json');
}
