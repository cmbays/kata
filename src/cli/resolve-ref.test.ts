import { resolveRef } from './resolve-ref.js';

const ITEMS = [
  { id: '550e8400-e29b-41d4-a716-446655440000', name: 'alpha-cycle', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'a1b2c3d4-0000-0000-0000-000000000001', name: 'beta-cycle', createdAt: '2026-02-15T12:00:00.000Z' },
  { id: 'deadbeef-1234-5678-9abc-def012345678', name: 'gamma-cycle', createdAt: '2026-03-01T08:30:00.000Z' },
];

describe('resolveRef', () => {
  describe('exact UUID match', () => {
    it('returns the item when full UUID matches', () => {
      const result = resolveRef('550e8400-e29b-41d4-a716-446655440000', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[0]);
    });

    it('returns exact match even if it also looks like a short hash', () => {
      // Full UUID takes priority over any other resolution
      const result = resolveRef('deadbeef-1234-5678-9abc-def012345678', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[2]);
    });
  });

  describe('latest shortcut', () => {
    it('returns the most recently created item', () => {
      const result = resolveRef('latest', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[2]); // gamma-cycle has the latest createdAt
    });

    it('works with items in any order', () => {
      const shuffled = [ITEMS[2]!, ITEMS[0]!, ITEMS[1]!];
      const result = resolveRef('latest', shuffled, 'cycle');
      expect(result.name).toBe('gamma-cycle');
    });

    it('throws when no items have createdAt', () => {
      const noTimestamps = [{ id: '550e8400-e29b-41d4-a716-446655440000', name: 'test' }];
      expect(() => resolveRef('latest', noTimestamps, 'cycle')).toThrow(
        'Cannot resolve "latest": no cycles have a createdAt timestamp.',
      );
    });
  });

  describe('short hash prefix match', () => {
    it('resolves 8-char prefix', () => {
      const result = resolveRef('550e8400', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[0]);
    });

    it('resolves shorter prefix (4 chars)', () => {
      const result = resolveRef('dead', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[2]);
    });

    it('is case-insensitive', () => {
      const result = resolveRef('DEADBEEF', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[2]);
    });

    it('throws on ambiguous prefix', () => {
      const ambiguous = [
        { id: 'abcd1234-0000-0000-0000-000000000001', name: 'one', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'abcd1234-9999-9999-9999-999999999999', name: 'two', createdAt: '2026-02-01T00:00:00.000Z' },
      ];
      expect(() => resolveRef('abcd1234', ambiguous, 'cycle')).toThrow(
        'Ambiguous cycle reference "abcd1234": matches 2 cycles.',
      );
    });

    it('falls through to name match when no prefix matches', () => {
      // "abcd" looks like a short hash but doesn't match any IDs — should try name match
      const items = [
        { id: '11111111-0000-0000-0000-000000000000', name: 'abcd', createdAt: '2026-01-01T00:00:00.000Z' },
      ];
      const result = resolveRef('abcd', items, 'cycle');
      expect(result).toBe(items[0]);
    });
  });

  describe('name-based lookup', () => {
    it('resolves by exact name (case-insensitive)', () => {
      const result = resolveRef('alpha-cycle', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[0]);
    });

    it('is case-insensitive', () => {
      const result = resolveRef('Alpha-Cycle', ITEMS, 'cycle');
      expect(result).toBe(ITEMS[0]);
    });

    it('resolves names with special characters', () => {
      const items = [
        { id: '11111111-0000-0000-0000-000000000000', name: 'my cycle (v2)', createdAt: '2026-01-01T00:00:00.000Z' },
      ];
      const result = resolveRef('my cycle (v2)', items, 'cycle');
      expect(result).toBe(items[0]);
    });
  });

  describe('error cases', () => {
    it('throws when items list is empty', () => {
      expect(() => resolveRef('anything', [], 'cycle')).toThrow('No cycles found.');
    });

    it('throws when nothing matches', () => {
      expect(() => resolveRef('nonexistent', ITEMS, 'cycle')).toThrow(
        'Cycle "nonexistent" not found.',
      );
    });

    it('includes label in error messages', () => {
      expect(() => resolveRef('nope', [], 'run')).toThrow('No runs found.');
      expect(() => resolveRef('nope', ITEMS, 'bet')).toThrow('Bet "nope" not found.');
    });
  });

  describe('items without name field', () => {
    it('works with items that have no name — resolves by ID and latest', () => {
      const nameless = [
        { id: '550e8400-e29b-41d4-a716-446655440000', createdAt: '2026-01-01T00:00:00.000Z' },
        { id: 'a1b2c3d4-0000-0000-0000-000000000001', createdAt: '2026-03-01T00:00:00.000Z' },
      ];
      // UUID works
      expect(resolveRef('550e8400-e29b-41d4-a716-446655440000', nameless, 'bet').id).toBe(nameless[0]!.id);
      // Short hash works
      expect(resolveRef('a1b2c3d4', nameless, 'bet').id).toBe(nameless[1]!.id);
      // Latest works
      expect(resolveRef('latest', nameless, 'bet').id).toBe(nameless[1]!.id);
    });
  });
});
