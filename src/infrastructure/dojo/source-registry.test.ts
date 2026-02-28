import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DojoSource } from '@domain/types/dojo.js';
import { SourceRegistry } from './source-registry.js';

let tempDir: string;
let registryPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kata-source-test-'));
  registryPath = join(tempDir, 'sources.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeSource(overrides: Partial<DojoSource> = {}): DojoSource {
  return {
    id: crypto.randomUUID(),
    name: 'MDN Web Docs',
    url: 'https://developer.mozilla.org',
    domains: ['javascript', 'html', 'css'],
    reputation: 'official',
    description: 'Mozilla Developer Network documentation.',
    active: true,
    ...overrides,
  };
}

describe('SourceRegistry', () => {
  describe('list', () => {
    it('returns an empty array for a new registry', () => {
      const registry = new SourceRegistry(registryPath);
      expect(registry.list()).toEqual([]);
    });

    it('returns all sources after adding', () => {
      const registry = new SourceRegistry(registryPath);
      registry.add(makeSource({ name: 'Source A' }));
      registry.add(makeSource({ name: 'Source B' }));

      const result = registry.list();
      expect(result).toHaveLength(2);
    });
  });

  describe('add', () => {
    it('adds a new source and persists it', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource();
      registry.add(source);

      // Verify persistence by loading fresh
      const freshRegistry = new SourceRegistry(registryPath);
      const sources = freshRegistry.list();
      expect(sources).toHaveLength(1);
      expect(sources[0]!.name).toBe(source.name);
    });

    it('updates an existing source by id', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource({ name: 'Original' });
      registry.add(source);

      const updated = { ...source, name: 'Updated' };
      registry.add(updated);

      const sources = registry.list();
      expect(sources).toHaveLength(1);
      expect(sources[0]!.name).toBe('Updated');
    });

    it('validates the source against DojoSourceSchema', () => {
      const registry = new SourceRegistry(registryPath);
      const invalid = { id: 'not-uuid', name: '', url: 'bad' } as unknown as DojoSource;
      expect(() => registry.add(invalid)).toThrow();
    });
  });

  describe('remove', () => {
    it('removes a source by id and returns true', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource();
      registry.add(source);

      const removed = registry.remove(source.id);
      expect(removed).toBe(true);
      expect(registry.list()).toHaveLength(0);
    });

    it('returns false when source does not exist', () => {
      const registry = new SourceRegistry(registryPath);
      const removed = registry.remove(crypto.randomUUID());
      expect(removed).toBe(false);
    });

    it('persists the removal', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource();
      registry.add(source);
      registry.remove(source.id);

      const freshRegistry = new SourceRegistry(registryPath);
      expect(freshRegistry.list()).toHaveLength(0);
    });
  });

  describe('toggleActive', () => {
    it('toggles a source from active to inactive', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource({ active: true });
      registry.add(source);

      const toggled = registry.toggleActive(source.id);
      expect(toggled).toBe(true);

      const sources = registry.list();
      expect(sources[0]!.active).toBe(false);
    });

    it('toggles a source from inactive to active', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource({ active: false });
      registry.add(source);

      registry.toggleActive(source.id);

      const sources = registry.list();
      expect(sources[0]!.active).toBe(true);
    });

    it('returns false for a non-existent source', () => {
      const registry = new SourceRegistry(registryPath);
      const toggled = registry.toggleActive(crypto.randomUUID());
      expect(toggled).toBe(false);
    });
  });

  describe('forDomain', () => {
    it('returns active sources matching the domain', () => {
      const registry = new SourceRegistry(registryPath);
      registry.add(makeSource({ domains: ['javascript', 'typescript'], active: true, name: 'JS Docs' }));
      registry.add(makeSource({ domains: ['rust'], active: true, name: 'Rust Docs' }));
      registry.add(makeSource({ domains: ['javascript'], active: false, name: 'Inactive JS' }));

      const result = registry.forDomain('javascript');
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('JS Docs');
    });

    it('returns empty array when no active sources match', () => {
      const registry = new SourceRegistry(registryPath);
      registry.add(makeSource({ domains: ['python'], active: true }));

      const result = registry.forDomain('javascript');
      expect(result).toEqual([]);
    });
  });

  describe('active', () => {
    it('returns only active sources', () => {
      const registry = new SourceRegistry(registryPath);
      registry.add(makeSource({ active: true, name: 'Active' }));
      registry.add(makeSource({ active: false, name: 'Inactive' }));

      const result = registry.active();
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe('Active');
    });
  });

  describe('loadDefaults (static)', () => {
    it('loads sources from a valid defaults file', () => {
      const defaultsPath = join(tempDir, 'defaults.json');
      const sources = [makeSource({ name: 'Default A' }), makeSource({ name: 'Default B' })];
      writeFileSync(defaultsPath, JSON.stringify({
        sources,
        updatedAt: new Date().toISOString(),
      }));

      const result = SourceRegistry.loadDefaults(defaultsPath);
      expect(result).toHaveLength(2);
      expect(result[0]!.name).toBe('Default A');
    });

    it('returns empty array for non-existent file', () => {
      const result = SourceRegistry.loadDefaults(join(tempDir, 'nonexistent.json'));
      expect(result).toEqual([]);
    });

    it('returns empty array for invalid JSON', () => {
      const defaultsPath = join(tempDir, 'bad-defaults.json');
      writeFileSync(defaultsPath, 'not json {{{');

      const result = SourceRegistry.loadDefaults(defaultsPath);
      expect(result).toEqual([]);
    });
  });

  describe('seedDefaults', () => {
    it('adds default sources that do not already exist', () => {
      const registry = new SourceRegistry(registryPath);
      const defaults = [
        makeSource({ name: 'Default A', url: 'https://a.example.com' }),
        makeSource({ name: 'Default B', url: 'https://b.example.com' }),
      ];

      const added = registry.seedDefaults(defaults);
      expect(added).toBe(2);
      expect(registry.list()).toHaveLength(2);
    });

    it('skips sources that already exist (by name + url)', () => {
      const registry = new SourceRegistry(registryPath);
      const existing = makeSource({ name: 'Existing', url: 'https://existing.example.com' });
      registry.add(existing);

      const defaults = [
        makeSource({ name: 'Existing', url: 'https://existing.example.com' }),
        makeSource({ name: 'New Source', url: 'https://new.example.com' }),
      ];

      const added = registry.seedDefaults(defaults);
      expect(added).toBe(1);
      expect(registry.list()).toHaveLength(2);
    });

    it('returns 0 when all defaults already exist', () => {
      const registry = new SourceRegistry(registryPath);
      const source = makeSource({ name: 'Already There', url: 'https://there.example.com' });
      registry.add(source);

      const defaults = [makeSource({ name: 'Already There', url: 'https://there.example.com' })];
      const added = registry.seedDefaults(defaults);
      expect(added).toBe(0);
    });
  });
});
