import { canTransitionCycleState } from './cycle-rules.js';

describe('canTransitionCycleState', () => {
  it('allows planning → active', () => {
    expect(canTransitionCycleState('planning', 'active')).toBe(true);
  });

  it('allows active → cooldown', () => {
    expect(canTransitionCycleState('active', 'cooldown')).toBe(true);
  });

  it('allows cooldown → complete', () => {
    expect(canTransitionCycleState('cooldown', 'complete')).toBe(true);
  });

  it('rejects skipping states', () => {
    expect(canTransitionCycleState('active', 'complete')).toBe(false);
    expect(canTransitionCycleState('planning', 'cooldown')).toBe(false);
  });

  it('rejects backward transitions', () => {
    expect(canTransitionCycleState('active', 'planning')).toBe(false);
    expect(canTransitionCycleState('complete', 'active')).toBe(false);
  });

  it('rejects same-state transitions', () => {
    expect(canTransitionCycleState('active', 'active')).toBe(false);
  });
});
