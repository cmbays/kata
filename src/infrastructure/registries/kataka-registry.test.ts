import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Kataka } from '@domain/types/kataka.js';
import { KatakaRegistry } from './kataka-registry.js';

function makeKataka(overrides: Partial<Kataka> = {}): Kataka {
  return {
    id: randomUUID(),
    name: 'Sensei',
    role: 'executor',
    skills: ['TypeScript'],
    createdAt: '2026-01-01T00:00:00.000Z',
    active: true,
    ...overrides,
  };
}

describe('KatakaRegistry', () => {
  let basePath: string;
  let registry: KatakaRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'kataka-registry-test-'));
    registry = new KatakaRegistry(basePath);
  });

  describe('register', () => {
    it('persists a kataka to disk as {id}.json', () => {
      const k = makeKataka();
      registry.register(k);
      expect(existsSync(join(basePath, `${k.id}.json`))).toBe(true);
    });

    it('overwrites an existing kataka with the same id', () => {
      const id = randomUUID();
      registry.register(makeKataka({ id, name: 'v1' }));
      registry.register(makeKataka({ id, name: 'v2' }));
      expect(registry.get(id).name).toBe('v2');
    });

    it('throws on invalid kataka data', () => {
      expect(() => registry.register({ id: 'bad' } as Kataka)).toThrow();
    });
  });

  describe('get', () => {
    it('retrieves a registered kataka by id', () => {
      const k = makeKataka();
      registry.register(k);
      expect(registry.get(k.id).name).toBe(k.name);
    });

    it('loads from disk when not in cache', () => {
      const k = makeKataka();
      registry.register(k);
      // Fresh registry instance — cache is empty
      const fresh = new KatakaRegistry(basePath);
      expect(fresh.get(k.id).id).toBe(k.id);
    });

    it('throws when kataka does not exist', () => {
      expect(() => registry.get(randomUUID())).toThrow(/not found/i);
    });
  });

  describe('list', () => {
    it('returns all registered kataka', () => {
      const k1 = makeKataka({ name: 'A' });
      const k2 = makeKataka({ name: 'B' });
      registry.register(k1);
      registry.register(k2);
      const list = registry.list();
      expect(list).toHaveLength(2);
    });

    it('returns empty array when no kataka registered', () => {
      expect(registry.list()).toEqual([]);
    });
  });

  describe('getActive', () => {
    it('returns only active kataka', () => {
      registry.register(makeKataka({ name: 'active', active: true }));
      registry.register(makeKataka({ name: 'inactive', active: false }));
      const active = registry.getActive();
      expect(active).toHaveLength(1);
      expect(active[0]!.name).toBe('active');
    });
  });

  describe('deactivate', () => {
    it('sets active to false and persists', () => {
      const k = makeKataka();
      registry.register(k);
      const updated = registry.deactivate(k.id);
      expect(updated.active).toBe(false);

      // Verify persisted to disk
      const fresh = new KatakaRegistry(basePath);
      expect(fresh.get(k.id).active).toBe(false);
    });

    it('throws when kataka does not exist', () => {
      expect(() => registry.deactivate(randomUUID())).toThrow(/not found/i);
    });
  });

  describe('delete', () => {
    it('removes kataka from disk and cache', () => {
      const k = makeKataka();
      registry.register(k);
      registry.delete(k.id);
      expect(existsSync(join(basePath, `${k.id}.json`))).toBe(false);
      expect(() => registry.get(k.id)).toThrow();
    });

    it('throws when kataka does not exist', () => {
      expect(() => registry.delete(randomUUID())).toThrow();
    });
  });
});
