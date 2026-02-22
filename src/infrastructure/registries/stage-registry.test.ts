import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Stage } from '@domain/types/stage.js';
import { StageNotFoundError } from '@shared/lib/errors.js';
import { StageRegistry } from './stage-registry.js';

function makeStage(overrides: Partial<Stage> = {}): Stage {
  return {
    type: 'research',
    description: 'Research stage',
    artifacts: [],
    learningHooks: ['research-quality'],
    config: {},
    ...overrides,
  };
}

describe('StageRegistry', () => {
  let basePath: string;
  let registry: StageRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'stage-registry-test-'));
    registry = new StageRegistry(basePath);
  });

  describe('register', () => {
    it('should register a valid stage and persist to disk', () => {
      const stage = makeStage();
      registry.register(stage);

      expect(existsSync(join(basePath, 'research.json'))).toBe(true);
    });

    it('should register a flavored stage with correct filename', () => {
      const stage = makeStage({ flavor: 'competitive-analysis' });
      registry.register(stage);

      expect(existsSync(join(basePath, 'research:competitive-analysis.json'))).toBe(true);
    });

    it('should overwrite an existing stage of the same type+flavor', () => {
      const stage1 = makeStage({ description: 'Version 1' });
      const stage2 = makeStage({ description: 'Version 2' });

      registry.register(stage1);
      registry.register(stage2);

      const retrieved = registry.get('research');
      expect(retrieved.description).toBe('Version 2');
    });

    it('should throw on invalid stage data', () => {
      expect(() => {
        registry.register({ type: '' } as Stage);
      }).toThrow();
    });
  });

  describe('get', () => {
    it('should retrieve a registered stage by type', () => {
      const stage = makeStage();
      registry.register(stage);

      const retrieved = registry.get('research');
      expect(retrieved.type).toBe('research');
      expect(retrieved.description).toBe('Research stage');
    });

    it('should retrieve a flavored stage', () => {
      const stage = makeStage({ flavor: 'domain-research' });
      registry.register(stage);

      const retrieved = registry.get('research', 'domain-research');
      expect(retrieved.flavor).toBe('domain-research');
    });

    it('should throw StageNotFoundError for unregistered stage', () => {
      expect(() => {
        registry.get('nonexistent');
      }).toThrow(StageNotFoundError);
    });

    it('should throw StageNotFoundError for wrong flavor', () => {
      const stage = makeStage({ flavor: 'competitive-analysis' });
      registry.register(stage);

      expect(() => {
        registry.get('research', 'wrong-flavor');
      }).toThrow(StageNotFoundError);
    });

    it('should load from disk if not in cache', () => {
      // Register using one instance
      const registry1 = new StageRegistry(basePath);
      registry1.register(makeStage());

      // Create a fresh instance (empty cache)
      const registry2 = new StageRegistry(basePath);
      const retrieved = registry2.get('research');
      expect(retrieved.type).toBe('research');
    });
  });

  describe('list', () => {
    it('should list all registered stages', () => {
      registry.register(makeStage({ type: 'research' }));
      registry.register(makeStage({ type: 'build' }));
      registry.register(makeStage({ type: 'review' }));

      const stages = registry.list();
      expect(stages).toHaveLength(3);
    });

    it('should filter by type', () => {
      registry.register(makeStage({ type: 'research' }));
      registry.register(makeStage({ type: 'research', flavor: 'competitive' }));
      registry.register(makeStage({ type: 'build' }));

      const filtered = registry.list({ type: 'research' });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.type === 'research')).toBe(true);
    });

    it('should return empty array when no stages match filter', () => {
      registry.register(makeStage({ type: 'research' }));

      const filtered = registry.list({ type: 'nonexistent' });
      expect(filtered).toHaveLength(0);
    });

    it('should load from disk on first list call', () => {
      // Write directly to disk
      const stage = makeStage({ type: 'build' });
      writeFileSync(
        join(basePath, 'build.json'),
        JSON.stringify(stage, null, 2),
      );

      // Fresh registry — cache is empty
      const freshRegistry = new StageRegistry(basePath);
      const stages = freshRegistry.list();
      expect(stages.some((s) => s.type === 'build')).toBe(true);
    });
  });

  describe('loadBuiltins', () => {
    it('should load all stage JSON files from a directory', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));

      writeFileSync(
        join(builtinDir, 'research.json'),
        JSON.stringify(makeStage({ type: 'research' })),
      );
      writeFileSync(
        join(builtinDir, 'build.json'),
        JSON.stringify(makeStage({ type: 'build' })),
      );

      registry.loadBuiltins(builtinDir);

      const stages = registry.list();
      expect(stages).toHaveLength(2);
      expect(stages.map((s) => s.type).sort()).toEqual(['build', 'research']);
    });

    it('should persist loaded builtins to basePath', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));
      writeFileSync(
        join(builtinDir, 'review.json'),
        JSON.stringify(makeStage({ type: 'review' })),
      );

      registry.loadBuiltins(builtinDir);

      expect(existsSync(join(basePath, 'review.json'))).toBe(true);
    });

    it('should skip invalid JSON files silently', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtins-'));
      writeFileSync(
        join(builtinDir, 'valid.json'),
        JSON.stringify(makeStage({ type: 'research' })),
      );
      writeFileSync(join(builtinDir, 'invalid.json'), '{ broken json }');

      registry.loadBuiltins(builtinDir);

      const stages = registry.list();
      expect(stages).toHaveLength(1);
    });

    it('should handle empty directory', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'empty-'));
      registry.loadBuiltins(emptyDir);

      const stages = registry.list();
      expect(stages).toHaveLength(0);
    });

    it('should handle non-existent directory', () => {
      registry.loadBuiltins('/tmp/nonexistent-dir-xyz');

      const stages = registry.list();
      expect(stages).toHaveLength(0);
    });
  });

  describe('loadCustom', () => {
    it('should load custom stage definitions', () => {
      const customDir = mkdtempSync(join(tmpdir(), 'custom-'));
      writeFileSync(
        join(customDir, 'custom-stage.json'),
        JSON.stringify(makeStage({ type: 'custom', flavor: 'my-stage' })),
      );

      registry.loadCustom(customDir);

      const stage = registry.get('custom', 'my-stage');
      expect(stage.type).toBe('custom');
      expect(stage.flavor).toBe('my-stage');
    });

    it('should overwrite existing stages with custom definitions', () => {
      registry.register(makeStage({ type: 'research', description: 'Original' }));

      const customDir = mkdtempSync(join(tmpdir(), 'custom-'));
      writeFileSync(
        join(customDir, 'research.json'),
        JSON.stringify(makeStage({ type: 'research', description: 'Custom override' })),
      );

      registry.loadCustom(customDir);

      const stage = registry.get('research');
      expect(stage.description).toBe('Custom override');
    });
  });

  describe('duplicate handling', () => {
    it('should keep both type and type+flavor as separate entries', () => {
      registry.register(makeStage({ type: 'research', description: 'Base' }));
      registry.register(makeStage({ type: 'research', flavor: 'deep', description: 'Deep' }));

      const base = registry.get('research');
      const deep = registry.get('research', 'deep');

      expect(base.description).toBe('Base');
      expect(deep.description).toBe('Deep');
    });
  });
});
