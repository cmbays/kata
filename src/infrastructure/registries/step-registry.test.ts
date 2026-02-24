import { mkdtempSync, writeFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Step } from '@domain/types/step.js';
import { StepNotFoundError } from '@shared/lib/errors.js';
import { StepRegistry } from './step-registry.js';

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    type: 'research',
    description: 'Research step',
    artifacts: [],
    learningHooks: ['research-quality'],
    config: {},
    ...overrides,
  };
}

describe('StepRegistry', () => {
  let basePath: string;
  let registry: StepRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'step-registry-test-'));
    registry = new StepRegistry(basePath);
  });

  describe('register', () => {
    it('should register a valid step and persist to disk', () => {
      const step = makeStep();
      registry.register(step);

      expect(existsSync(join(basePath, 'research.json'))).toBe(true);
    });

    it('should register a flavored step with correct filename', () => {
      const step = makeStep({ flavor: 'competitive-analysis' });
      registry.register(step);

      expect(existsSync(join(basePath, 'research.competitive-analysis.json'))).toBe(true);
    });

    it('should overwrite an existing step of the same type+flavor', () => {
      const step1 = makeStep({ description: 'Version 1' });
      const step2 = makeStep({ description: 'Version 2' });

      registry.register(step1);
      registry.register(step2);

      const retrieved = registry.get('research');
      expect(retrieved.description).toBe('Version 2');
    });

    it('should throw on invalid step data', () => {
      expect(() => {
        registry.register({ type: '' } as Step);
      }).toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve a registered step by type', () => {
      const step = makeStep();
      registry.register(step);

      const retrieved = registry.get('research');
      expect(retrieved.type).toBe('research');
      expect(retrieved.description).toBe('Research step');
    });

    it('should retrieve a flavored step', () => {
      const step = makeStep({ flavor: 'domain-research' });
      registry.register(step);

      const retrieved = registry.get('research', 'domain-research');
      expect(retrieved.flavor).toBe('domain-research');
    });

    it('should throw StepNotFoundError for unregistered step', () => {
      expect(() => {
        registry.get('nonexistent');
      }).toThrow(StepNotFoundError);
    });

    it('should throw StepNotFoundError for wrong flavor', () => {
      const step = makeStep({ flavor: 'competitive-analysis' });
      registry.register(step);

      expect(() => {
        registry.get('research', 'wrong-flavor');
      }).toThrow(StepNotFoundError);
    });

    it('should load from disk if not in cache', () => {
      // Register using one instance
      const registry1 = new StepRegistry(basePath);
      registry1.register(makeStep());

      // Create a fresh instance (empty cache)
      const registry2 = new StepRegistry(basePath);
      const retrieved = registry2.get('research');
      expect(retrieved.type).toBe('research');
    });
  });

  describe('list', () => {
    it('should list all registered steps', () => {
      registry.register(makeStep({ type: 'research' }));
      registry.register(makeStep({ type: 'build' }));
      registry.register(makeStep({ type: 'review' }));

      const steps = registry.list();
      expect(steps).toHaveLength(3);
    });

    it('should filter by type', () => {
      registry.register(makeStep({ type: 'research' }));
      registry.register(makeStep({ type: 'research', flavor: 'competitive' }));
      registry.register(makeStep({ type: 'build' }));

      const filtered = registry.list({ type: 'research' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.type === 'research')).toBe(true);
    });

    it('should return empty array when no steps match filter', () => {
      registry.register(makeStep({ type: 'research' }));

      const filtered = registry.list({ type: 'nonexistent' });
      expect(filtered).toHaveLength(0);
    });

    it('should load from disk on first list call', () => {
      // Write directly to disk
      const step = makeStep({ type: 'build' });
      writeFileSync(
        join(basePath, 'build.json'),
        JSON.stringify(step, null, 2),
      );

      // Fresh registry — cache is empty
      const freshRegistry = new StepRegistry(basePath);
      const steps = freshRegistry.list();
      expect(steps.some((s) => s.type === 'build')).toBe(true);
    });
  });

  describe('loadBuiltins', () => {
    it('should load all step JSON files from a directory', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));

      writeFileSync(
        join(builtinDir, 'research.json'),
        JSON.stringify(makeStep({ type: 'research' })),
      );
      writeFileSync(
        join(builtinDir, 'build.json'),
        JSON.stringify(makeStep({ type: 'build' })),
      );

      registry.loadBuiltins(builtinDir);

      const steps = registry.list();
      expect(steps).toHaveLength(2);
      expect(steps.map((s) => s.type).sort()).toEqual(['build', 'research']);
    });

    it('should persist loaded builtins to basePath', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));
      writeFileSync(
        join(builtinDir, 'review.json'),
        JSON.stringify(makeStep({ type: 'review' })),
      );

      registry.loadBuiltins(builtinDir);

      expect(existsSync(join(basePath, 'review.json'))).toBe(true);
    });

    it('should skip invalid JSON files silently', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));
      writeFileSync(
        join(builtinDir, 'valid.json'),
        JSON.stringify(makeStep({ type: 'research' })),
      );
      writeFileSync(join(builtinDir, 'invalid.json'), '{ broken json }');

      registry.loadBuiltins(builtinDir);

      const steps = registry.list();
      expect(steps).toHaveLength(1);
    });

    it('should handle empty directory', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'empty-'));
      registry.loadBuiltins(emptyDir);

      const steps = registry.list();
      expect(steps).toHaveLength(0);
    });

    it('should handle non-existent directory', () => {
      registry.loadBuiltins('/tmp/nonexistent-dir-xyz');

      const steps = registry.list();
      expect(steps).toHaveLength(0);
    });
  });

  describe('loadCustom', () => {
    it('should load custom step definitions', () => {
      const customDir = mkdtempSync(join(tmpdir(), 'custom-'));
      writeFileSync(
        join(customDir, 'custom-step.json'),
        JSON.stringify(makeStep({ type: 'custom', flavor: 'my-step' })),
      );

      registry.loadCustom(customDir);

      const step = registry.get('custom', 'my-step');
      expect(step.type).toBe('custom');
      expect(step.flavor).toBe('my-step');
    });

    it('should overwrite existing steps with custom definitions', () => {
      registry.register(makeStep({ type: 'research', description: 'Original' }));

      const customDir = mkdtempSync(join(tmpdir(), 'custom-'));
      writeFileSync(
        join(customDir, 'research.json'),
        JSON.stringify(makeStep({ type: 'research', description: 'Custom override' })),
      );

      registry.loadCustom(customDir);

      const step = registry.get('research');
      expect(step.description).toBe('Custom override');
    });
  });

  describe('duplicate handling', () => {
    it('should keep both type and type+flavor as separate entries', () => {
      registry.register(makeStep({ type: 'research', description: 'Base' }));
      registry.register(makeStep({ type: 'research', flavor: 'deep', description: 'Deep' }));

      const base = registry.get('research');
      const deep = registry.get('research', 'deep');

      expect(base.description).toBe('Base');
      expect(deep.description).toBe('Deep');
    });
  });

  describe('delete', () => {
    it('deletes a registered step from disk and cache', () => {
      registry.register(makeStep({ type: 'build' }));
      expect(existsSync(join(basePath, 'build.json'))).toBe(true);

      registry.delete('build');

      expect(existsSync(join(basePath, 'build.json'))).toBe(false);
      expect(() => registry.get('build')).toThrow(StepNotFoundError);
    });

    it('returns the deleted step', () => {
      registry.register(makeStep({ type: 'build', description: 'Build step' }));

      const deleted = registry.delete('build');

      expect(deleted.type).toBe('build');
      expect(deleted.description).toBe('Build step');
    });

    it('deletes a flavored step', () => {
      registry.register(makeStep({ type: 'build', flavor: 'go' }));

      registry.delete('build', 'go');

      expect(existsSync(join(basePath, 'build.go.json'))).toBe(false);
    });

    it('throws StepNotFoundError for missing step', () => {
      expect(() => registry.delete('nonexistent')).toThrow(StepNotFoundError);
    });

    it('does not affect sibling steps when one is deleted', () => {
      registry.register(makeStep({ type: 'build' }));
      registry.register(makeStep({ type: 'build', flavor: 'go' }));

      registry.delete('build', 'go');

      expect(existsSync(join(basePath, 'build.json'))).toBe(true);
      expect(() => registry.get('build')).not.toThrow();
    });
  });

  describe('error handling', () => {
    it('get() wraps JsonStore errors with step-specific context', () => {
      writeFileSync(join(basePath, 'research.json'), '{ invalid json }');

      expect(() => registry.get('research')).toThrow('Failed to load step "research"');
    });

    it('get() includes flavor in context for flavored steps', () => {
      writeFileSync(join(basePath, 'build.go.json'), '{ invalid json }');

      expect(() => registry.get('build', 'go')).toThrow('Failed to load step "build:go"');
    });

    it('delete() wraps unlink OS errors with step context', () => {
      registry.register(makeStep({ type: 'build' }));
      const originalMode = statSync(basePath).mode & 0o777;
      chmodSync(basePath, 0o555); // make directory read-only (no delete permission)
      try {
        expect(() => registry.delete('build')).toThrow('Failed to delete step "build"');
      } finally {
        chmodSync(basePath, originalMode);
      }
    });
  });

  describe('listFlavors', () => {
    it('should return all flavors for a given type', () => {
      registry.register(makeStep({ type: 'build' }));
      registry.register(makeStep({ type: 'build', flavor: 'typescript' }));
      registry.register(makeStep({ type: 'build', flavor: 'rust' }));
      registry.register(makeStep({ type: 'research' }));

      const flavors = registry.listFlavors('build');
      expect(flavors).toEqual(['rust', 'typescript']);
    });

    it('should return empty array when type has no flavors', () => {
      registry.register(makeStep({ type: 'build' }));

      const flavors = registry.listFlavors('build');
      expect(flavors).toEqual([]);
    });

    it('should return empty array for unknown type', () => {
      const flavors = registry.listFlavors('nonexistent');
      expect(flavors).toEqual([]);
    });

    it('should return sorted flavor list', () => {
      registry.register(makeStep({ type: 'review', flavor: 'security' }));
      registry.register(makeStep({ type: 'review', flavor: 'api' }));
      registry.register(makeStep({ type: 'review', flavor: 'frontend' }));

      const flavors = registry.listFlavors('review');
      expect(flavors).toEqual(['api', 'frontend', 'security']);
    });

    it('should not include base (unflavored) step in flavor list', () => {
      registry.register(makeStep({ type: 'build' }));
      registry.register(makeStep({ type: 'build', flavor: 'go' }));

      const flavors = registry.listFlavors('build');
      expect(flavors).toEqual(['go']);
    });

    it('should load flavors from disk on fresh registry (dot-notation round-trip)', () => {
      // Write dot-notation files directly to disk (simulating what loadBuiltins does)
      writeFileSync(
        join(basePath, 'build.typescript.json'),
        JSON.stringify(makeStep({ type: 'build', flavor: 'typescript' })),
      );
      writeFileSync(
        join(basePath, 'build.rust.json'),
        JSON.stringify(makeStep({ type: 'build', flavor: 'rust' })),
      );
      writeFileSync(
        join(basePath, 'build.json'),
        JSON.stringify(makeStep({ type: 'build' })),
      );

      // Fresh registry — empty in-memory cache; forces loadFromDisk()
      const freshRegistry = new StepRegistry(basePath);
      const flavors = freshRegistry.listFlavors('build');
      expect(flavors).toEqual(['rust', 'typescript']);
    });
  });
});
