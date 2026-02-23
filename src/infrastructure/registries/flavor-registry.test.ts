import { mkdtempSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Flavor } from '@domain/types/flavor.js';
import type { Step } from '@domain/types/step.js';
import { KataError, FlavorNotFoundError } from '@shared/lib/errors.js';
import { FlavorRegistry } from './flavor-registry.js';

function makeFlavor(overrides: Partial<Flavor> = {}): Flavor {
  return {
    name: 'ui-planning',
    stageCategory: 'plan',
    steps: [
      { stepName: 'shaping', stepType: 'shape' },
      { stepName: 'breadboarding', stepType: 'breadboard' },
    ],
    synthesisArtifact: 'shape-document',
    ...overrides,
  };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    type: 'shape',
    artifacts: [],
    learningHooks: [],
    config: {},
    ...overrides,
  };
}

describe('FlavorRegistry', () => {
  let basePath: string;
  let registry: FlavorRegistry;

  beforeEach(() => {
    basePath = mkdtempSync(join(tmpdir(), 'flavor-registry-test-'));
    registry = new FlavorRegistry(basePath);
  });

  describe('register', () => {
    it('persists a valid flavor to disk', () => {
      const flavor = makeFlavor();
      registry.register(flavor);

      expect(existsSync(join(basePath, 'plan.ui-planning.json'))).toBe(true);
    });

    it('overwrites an existing flavor with the same category+name', () => {
      registry.register(makeFlavor({ name: 'ui-planning', synthesisArtifact: 'v1' }));
      registry.register(makeFlavor({ name: 'ui-planning', synthesisArtifact: 'v2' }));

      const retrieved = registry.get('plan', 'ui-planning');
      expect(retrieved.synthesisArtifact).toBe('v2');
    });

    it('throws on invalid flavor data', () => {
      expect(() => {
        registry.register({ name: '' } as Flavor);
      }).toThrow();
    });

    it('uses dot-notation filename: {stageCategory}.{name}.json', () => {
      registry.register(makeFlavor({ stageCategory: 'research', name: 'domain-research' }));
      expect(existsSync(join(basePath, 'research.domain-research.json'))).toBe(true);
    });
  });

  describe('get', () => {
    it('retrieves a registered flavor', () => {
      const flavor = makeFlavor();
      registry.register(flavor);

      const retrieved = registry.get('plan', 'ui-planning');
      expect(retrieved.name).toBe('ui-planning');
      expect(retrieved.stageCategory).toBe('plan');
    });

    it('throws FlavorNotFoundError for unregistered flavor', () => {
      expect(() => {
        registry.get('plan', 'nonexistent');
      }).toThrow(FlavorNotFoundError);
    });

    it('loads from disk if not in cache', () => {
      const registry1 = new FlavorRegistry(basePath);
      registry1.register(makeFlavor());

      const registry2 = new FlavorRegistry(basePath);
      const retrieved = registry2.get('plan', 'ui-planning');
      expect(retrieved.name).toBe('ui-planning');
    });

    it('throws FlavorNotFoundError for wrong category', () => {
      registry.register(makeFlavor({ stageCategory: 'plan' }));
      expect(() => {
        registry.get('research', 'ui-planning');
      }).toThrow(FlavorNotFoundError);
    });
  });

  describe('list', () => {
    it('lists all registered flavors', () => {
      registry.register(makeFlavor({ name: 'ui-planning', stageCategory: 'plan' }));
      registry.register(makeFlavor({ name: 'data-model', stageCategory: 'plan' }));
      registry.register(makeFlavor({ name: 'domain-research', stageCategory: 'research' }));

      const all = registry.list();
      expect(all).toHaveLength(3);
    });

    it('filters by stage category', () => {
      registry.register(makeFlavor({ name: 'ui-planning', stageCategory: 'plan' }));
      registry.register(makeFlavor({ name: 'data-model', stageCategory: 'plan' }));
      registry.register(makeFlavor({ name: 'domain-research', stageCategory: 'research' }));

      const planFlavors = registry.list('plan');
      expect(planFlavors).toHaveLength(2);
      expect(planFlavors.every((f) => f.stageCategory === 'plan')).toBe(true);
    });

    it('returns empty array when no flavors match category', () => {
      registry.register(makeFlavor({ stageCategory: 'plan' }));

      const buildFlavors = registry.list('build');
      expect(buildFlavors).toHaveLength(0);
    });

    it('loads from disk on first list call', () => {
      const flavor = makeFlavor();
      writeFileSync(
        join(basePath, 'plan.ui-planning.json'),
        JSON.stringify(flavor, null, 2),
      );

      const freshRegistry = new FlavorRegistry(basePath);
      const flavors = freshRegistry.list();
      expect(flavors.some((f) => f.name === 'ui-planning')).toBe(true);
    });
  });

  describe('delete', () => {
    it('removes flavor from disk and cache', () => {
      registry.register(makeFlavor());

      registry.delete('plan', 'ui-planning');

      expect(existsSync(join(basePath, 'plan.ui-planning.json'))).toBe(false);
      expect(() => registry.get('plan', 'ui-planning')).toThrow(FlavorNotFoundError);
    });

    it('returns the deleted flavor', () => {
      registry.register(makeFlavor({ name: 'ui-planning' }));

      const deleted = registry.delete('plan', 'ui-planning');
      expect(deleted.name).toBe('ui-planning');
    });

    it('throws FlavorNotFoundError for missing flavor', () => {
      expect(() => registry.delete('plan', 'nonexistent')).toThrow(FlavorNotFoundError);
    });

    it('does not affect sibling flavors when one is deleted', () => {
      registry.register(makeFlavor({ name: 'ui-planning' }));
      registry.register(makeFlavor({ name: 'data-model' }));

      registry.delete('plan', 'ui-planning');

      expect(() => registry.get('plan', 'data-model')).not.toThrow();
    });
  });

  describe('loadBuiltins', () => {
    it('loads all flavor JSON files from a directory', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtin-flavors-'));

      writeFileSync(
        join(builtinDir, 'plan.ui-planning.json'),
        JSON.stringify(makeFlavor({ name: 'ui-planning', stageCategory: 'plan' })),
      );
      writeFileSync(
        join(builtinDir, 'research.domain.json'),
        JSON.stringify(makeFlavor({ name: 'domain', stageCategory: 'research' })),
      );

      registry.loadBuiltins(builtinDir);

      const flavors = registry.list();
      expect(flavors).toHaveLength(2);
    });

    it('persists builtins to basePath', () => {
      const builtinDir = mkdtempSync(join(tmpdir(), 'builtin-flavors-'));
      writeFileSync(
        join(builtinDir, 'plan.ui.json'),
        JSON.stringify(makeFlavor({ name: 'ui', stageCategory: 'plan' })),
      );

      registry.loadBuiltins(builtinDir);

      expect(existsSync(join(basePath, 'plan.ui.json'))).toBe(true);
    });

    it('handles non-existent directory gracefully', () => {
      registry.loadBuiltins('/tmp/nonexistent-flavors-dir-xyz');
      expect(registry.list()).toHaveLength(0);
    });
  });

  describe('validate — structural only (no stepResolver)', () => {
    it('returns valid for a well-formed flavor', () => {
      const result = registry.validate(makeFlavor());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns invalid for a flavor with empty name', () => {
      const result = registry.validate({ ...makeFlavor(), name: '' });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('returns invalid for a flavor with empty steps', () => {
      const result = registry.validate({ ...makeFlavor(), steps: [] });
      expect(result.valid).toBe(false);
    });

    it('reports override key that does not match any step name', () => {
      const flavor = makeFlavor({
        overrides: { 'nonexistent-step': { humanApproval: true } },
      });
      const result = registry.validate(flavor);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('nonexistent-step'))).toBe(true);
    });

    it('accepts valid overrides for existing step names', () => {
      const flavor = makeFlavor({
        overrides: { shaping: { humanApproval: true, confidenceThreshold: 0.9 } },
      });
      const result = registry.validate(flavor);
      expect(result.valid).toBe(true);
    });
  });

  describe('validate — DAG validation with stepResolver', () => {
    it('returns valid when artifact-exists conditions are satisfied by preceding steps', () => {
      const shapingStep = makeStep({
        type: 'shape',
        artifacts: [{ name: 'shape-document', required: true }],
      });
      const breadboardStep = makeStep({
        type: 'breadboard',
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'shape-document' }],
          required: true,
        },
        artifacts: [{ name: 'breadboard-sketch', required: true }],
      });

      const stepResolver = (stepName: string) => {
        if (stepName === 'shaping') return shapingStep;
        if (stepName === 'breadboarding') return breadboardStep;
        return undefined;
      };

      const flavor = makeFlavor({
        steps: [
          { stepName: 'shaping', stepType: 'shape' },
          { stepName: 'breadboarding', stepType: 'breadboard' },
        ],
        synthesisArtifact: 'breadboard-sketch',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns valid when artifact comes from stage input', () => {
      const breadboardStep = makeStep({
        type: 'breadboard',
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'prior-stage-artifact' }],
          required: true,
        },
        artifacts: [{ name: 'breadboard-sketch', required: true }],
      });

      const stepResolver = () => breadboardStep;

      const flavor = makeFlavor({
        steps: [{ stepName: 'breadboarding', stepType: 'breadboard' }],
        synthesisArtifact: 'breadboard-sketch',
      });

      const result = registry.validate(flavor, stepResolver, ['prior-stage-artifact']);
      expect(result.valid).toBe(true);
    });

    it('fails when artifact-exists condition requires a later step\'s artifact', () => {
      // breadboarding requires shape-document, but shaping comes AFTER breadboarding
      const shapingStep = makeStep({
        type: 'shape',
        artifacts: [{ name: 'shape-document', required: true }],
      });
      const breadboardStep = makeStep({
        type: 'breadboard',
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'shape-document' }],
          required: true,
        },
        artifacts: [{ name: 'breadboard-sketch', required: true }],
      });

      const stepResolver = (stepName: string) => {
        if (stepName === 'shaping') return shapingStep;
        if (stepName === 'breadboarding') return breadboardStep;
        return undefined;
      };

      const flavor = makeFlavor({
        steps: [
          { stepName: 'breadboarding', stepType: 'breadboard' }, // wrong order
          { stepName: 'shaping', stepType: 'shape' },
        ],
        synthesisArtifact: 'shape-document',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('shape-document'))).toBe(true);
      expect(result.errors.some((e) => e.includes('shaping'))).toBe(true);
    });

    it('fails when required artifact is not produced by any step in the flavor', () => {
      const stepWithDanglingRequirement = makeStep({
        type: 'build',
        entryGate: {
          type: 'entry',
          conditions: [{ type: 'artifact-exists', artifactName: 'nonexistent-artifact' }],
          required: true,
        },
        artifacts: [{ name: 'build-output', required: true }],
      });

      const stepResolver = () => stepWithDanglingRequirement;

      const flavor = makeFlavor({
        steps: [{ stepName: 'building', stepType: 'build' }],
        synthesisArtifact: 'build-output',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('nonexistent-artifact'))).toBe(true);
      expect(result.errors.some((e) => e.includes('not produced by any step'))).toBe(true);
    });

    it('fails when synthesisArtifact is not produced by any step', () => {
      const step = makeStep({
        type: 'shape',
        artifacts: [{ name: 'some-other-artifact', required: true }],
      });

      const stepResolver = () => step;

      const flavor = makeFlavor({
        steps: [{ stepName: 'shaping', stepType: 'shape' }],
        synthesisArtifact: 'undeclared-synthesis-artifact',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('undeclared-synthesis-artifact'))).toBe(true);
    });

    it('reports unresolvable steps but continues checking others', () => {
      const knownStep = makeStep({
        type: 'shape',
        artifacts: [{ name: 'shape-document', required: true }],
      });

      const stepResolver = (stepName: string) => {
        if (stepName === 'known') return knownStep;
        return undefined;
      };

      const flavor = makeFlavor({
        steps: [
          { stepName: 'known', stepType: 'shape' },
          { stepName: 'unknown', stepType: 'mystery' },
        ],
        synthesisArtifact: 'shape-document',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unknown'))).toBe(true);
    });

    it('allows step reuse — same stepType referenced under different stepNames', () => {
      // impl-planning step appears in both ui-planning and data-model-planning flavors
      const planStep = makeStep({
        type: 'plan',
        artifacts: [{ name: 'implementation-plan', required: true }],
      });

      const stepResolver = () => planStep;

      const uiPlanningFlavor: Flavor = {
        name: 'ui-planning',
        stageCategory: 'plan',
        steps: [
          { stepName: 'ui-impl-planning', stepType: 'plan' },
        ],
        synthesisArtifact: 'implementation-plan',
      };

      const dataModelFlavor: Flavor = {
        name: 'data-model-planning',
        stageCategory: 'plan',
        steps: [
          { stepName: 'db-impl-planning', stepType: 'plan' },
        ],
        synthesisArtifact: 'implementation-plan',
      };

      expect(registry.validate(uiPlanningFlavor, stepResolver).valid).toBe(true);
      expect(registry.validate(dataModelFlavor, stepResolver).valid).toBe(true);
    });

    it('ignores non-artifact-exists gate conditions during DAG check', () => {
      const step = makeStep({
        type: 'review',
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'human-approved' },
            { type: 'predecessor-complete', predecessorType: 'build' },
          ],
          required: true,
        },
        artifacts: [{ name: 'review-report', required: true }],
      });

      const stepResolver = () => step;

      const flavor = makeFlavor({
        steps: [{ stepName: 'code-review', stepType: 'review' }],
        synthesisArtifact: 'review-report',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(true);
    });
  });

  describe('validate — additional edge cases', () => {
    it('rejects flavor with mixed valid and invalid override keys — only invalid key appears in errors', () => {
      const flavor = makeFlavor({
        overrides: {
          shaping: { humanApproval: true },       // valid key
          nonexistent: { confidenceThreshold: 0.5 }, // invalid key
        },
      });
      const result = registry.validate(flavor);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('nonexistent'))).toBe(true);
      // 'shaping' is valid — must not appear in errors
      expect(result.errors.some((e) => e.includes('"shaping"'))).toBe(false);
    });

    it('handles multiple artifact-exists conditions in one gate — reports only unsatisfied ones', () => {
      const step1 = makeStep({
        type: 'shape',
        artifacts: [{ name: 'shape-document', required: true }],
      });
      const step2 = makeStep({
        type: 'breadboard',
        entryGate: {
          type: 'entry',
          conditions: [
            { type: 'artifact-exists', artifactName: 'shape-document' },   // satisfied
            { type: 'artifact-exists', artifactName: 'missing-artifact' }, // not satisfied
          ],
          required: true,
        },
        artifacts: [{ name: 'breadboard-sketch', required: true }],
      });

      const stepResolver = (stepName: string) => {
        if (stepName === 'shaping') return step1;
        if (stepName === 'breadboarding') return step2;
        return undefined;
      };

      const flavor = makeFlavor({
        steps: [
          { stepName: 'shaping', stepType: 'shape' },
          { stepName: 'breadboarding', stepType: 'breadboard' },
        ],
        synthesisArtifact: 'breadboard-sketch',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(false);
      // Only the unsatisfied artifact produces an error
      expect(result.errors.some((e) => e.includes('missing-artifact'))).toBe(true);
      expect(result.errors.some((e) => e.includes('shape-document'))).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('stepResolver receiving correct stepType for disambiguation', () => {
      const shapeStep = makeStep({
        type: 'shape',
        artifacts: [{ name: 'shape-document', required: true }],
      });
      const planStep = makeStep({
        type: 'plan',
        artifacts: [{ name: 'plan-document', required: true }],
      });

      // Resolver dispatches on stepType, not just stepName
      const stepResolver = (_stepName: string, stepType: string) => {
        if (stepType === 'shape') return shapeStep;
        if (stepType === 'plan') return planStep;
        return undefined;
      };

      const flavor = makeFlavor({
        steps: [
          { stepName: 'my-shaping', stepType: 'shape' },
          { stepName: 'my-planning', stepType: 'plan' },
        ],
        synthesisArtifact: 'plan-document',
      });

      const result = registry.validate(flavor, stepResolver);
      expect(result.valid).toBe(true);
    });

    it('stepResolver that throws is handled gracefully — treated as unresolvable', () => {
      const throwingResolver = () => {
        throw new Error('Registry unavailable');
      };

      const flavor = makeFlavor({
        steps: [{ stepName: 'shaping', stepType: 'shape' }],
        synthesisArtifact: 'shape-document',
      });

      const result = registry.validate(flavor, throwingResolver);
      expect(result.valid).toBe(false);
      // Should report as unresolvable, not crash
      expect(result.errors.some((e) => e.includes('could not be resolved'))).toBe(true);
    });
  });

  describe('error handling', () => {
    it('get() throws KataError when flavor file is corrupted', () => {
      writeFileSync(join(basePath, 'plan.ui-planning.json'), '{ corrupted json }');

      expect(() => registry.get('plan', 'ui-planning')).toThrow(KataError);
    });

    it('delete() throws KataError when file was externally removed after caching', () => {
      registry.register(makeFlavor());
      // Remove file directly while flavor is still in cache
      unlinkSync(join(basePath, 'plan.ui-planning.json'));

      expect(() => registry.delete('plan', 'ui-planning')).toThrow(KataError);
    });
  });

  describe('list() cache semantics', () => {
    it('does NOT load from disk when cache is already populated (documents known behavior)', () => {
      // Write flavorB directly to disk before any registry interaction
      writeFileSync(
        join(basePath, 'plan.data-model.json'),
        JSON.stringify(makeFlavor({ name: 'data-model' })),
      );

      // Register a different flavor — now cache is non-empty
      registry.register(makeFlavor({ name: 'ui-planning' }));

      // list() skips disk scan because cache.size > 0
      // Only the registered flavor is returned, not the one on disk
      const flavors = registry.list();
      expect(flavors.some((f) => f.name === 'ui-planning')).toBe(true);
      expect(flavors.some((f) => f.name === 'data-model')).toBe(false);
      // Use a fresh registry instance to see both:
      const fresh = new FlavorRegistry(basePath);
      expect(fresh.list()).toHaveLength(2);
    });
  });

  describe('override merge semantics', () => {
    it('flavor overrides take precedence over step defaults', () => {
      // The registry stores flavors with overrides — the merge happens at the
      // execution layer, not in the registry. Registry just stores/validates.
      const flavor = makeFlavor({
        overrides: {
          shaping: { humanApproval: false, confidenceThreshold: 0.6 },
        },
      });
      registry.register(flavor);

      const retrieved = registry.get('plan', 'ui-planning');
      expect(retrieved.overrides?.['shaping']?.humanApproval).toBe(false);
      expect(retrieved.overrides?.['shaping']?.confidenceThreshold).toBe(0.6);
      // timeout not set in override — step default applies at runtime
      expect(retrieved.overrides?.['shaping']?.timeout).toBeUndefined();
    });

    it('partial overrides do not overwrite unset properties', () => {
      const flavor = makeFlavor({
        overrides: {
          shaping: { humanApproval: true },
          // No confidenceThreshold or timeout — step defaults apply
        },
      });
      registry.register(flavor);

      const retrieved = registry.get('plan', 'ui-planning');
      expect(retrieved.overrides?.['shaping']?.humanApproval).toBe(true);
      expect(retrieved.overrides?.['shaping']?.confidenceThreshold).toBeUndefined();
      expect(retrieved.overrides?.['shaping']?.timeout).toBeUndefined();
    });
  });
});
