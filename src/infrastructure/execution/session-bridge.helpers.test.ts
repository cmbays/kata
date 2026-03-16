import {
  canTransitionCycleState,
  hasBridgeRunMetadataChanged,
  isJsonFile,
} from './session-bridge.helpers.js';

describe('session-bridge helpers', () => {
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

    it('rejects active → complete (skipping cooldown)', () => {
      expect(canTransitionCycleState('active', 'complete')).toBe(false);
    });

    it('rejects planning → cooldown (skipping active)', () => {
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

  describe('hasBridgeRunMetadataChanged', () => {
    it('returns false when both fields match', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'A', cycleName: 'C1' },
      )).toBe(false);
    });

    it('returns true when betName differs', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'B', cycleName: 'C1' },
      )).toBe(true);
    });

    it('returns true when cycleName differs', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'A', cycleName: 'C2' },
      )).toBe(true);
    });

    it('returns true when both differ', () => {
      expect(hasBridgeRunMetadataChanged(
        { betName: 'A', cycleName: 'C1' },
        { betName: 'B', cycleName: 'C2' },
      )).toBe(true);
    });
  });

  describe('isJsonFile', () => {
    it('returns true for .json files', () => {
      expect(isJsonFile('cycle.json')).toBe(true);
      expect(isJsonFile('data.json')).toBe(true);
    });

    it('returns false for non-.json files', () => {
      expect(isJsonFile('readme.md')).toBe(false);
      expect(isJsonFile('json')).toBe(false);
      expect(isJsonFile('')).toBe(false);
      expect(isJsonFile('.DS_Store')).toBe(false);
    });
  });
});
