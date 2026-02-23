import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Step } from '@domain/types/step.js';
import type { PipelineTemplate, PipelineMetadata } from '@domain/types/pipeline.js';
import { StepRegistry } from '@infra/registries/step-registry.js';
import { PipelineComposer } from './pipeline-composer.js';

function makeStage(overrides: Partial<Step> = {}): Step {
  return {
    type: 'research',
    description: 'Research stage',
    artifacts: [{ name: 'research-summary', required: true }],
    learningHooks: [],
    config: {},
    exitGate: {
      type: 'exit' as const,
      conditions: [
        { type: 'artifact-exists' as const, artifactName: 'research-summary' },
      ],
      required: true,
    },
    ...overrides,
  };
}

describe('PipelineComposer', () => {
  let registryPath: string;
  let registry: StepRegistry;

  beforeEach(() => {
    registryPath = mkdtempSync(join(tmpdir(), 'pipeline-composer-test-'));
    registry = new StepRegistry(registryPath);

    // Register some stages for testing
    registry.register(makeStage({
      type: 'research',
      artifacts: [{ name: 'research-summary', required: true }],
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'research-summary' }],
        required: true,
      },
    }));

    registry.register(makeStage({
      type: 'interview',
      entryGate: {
        type: 'entry',
        conditions: [{ type: 'artifact-exists', artifactName: 'research-summary' }],
        required: true,
      },
      artifacts: [{ name: 'interview-notes', required: true }],
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'interview-notes' }],
        required: true,
      },
    }));

    registry.register(makeStage({
      type: 'shape',
      entryGate: {
        type: 'entry',
        conditions: [{ type: 'artifact-exists', artifactName: 'interview-notes' }],
        required: true,
      },
      artifacts: [{ name: 'shaping-doc', required: true }],
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'shaping-doc' }],
        required: true,
      },
    }));

    registry.register(makeStage({
      type: 'build',
      artifacts: [{ name: 'build-output', required: true }],
      exitGate: {
        type: 'exit',
        conditions: [{ type: 'artifact-exists', artifactName: 'build-output' }],
        required: true,
      },
    }));
  });

  describe('define', () => {
    it('should create a pipeline with UUID, timestamps, and stage states', () => {
      const pipeline = PipelineComposer.define(
        'My Pipeline',
        'vertical',
        [{ type: 'research' }, { type: 'interview' }],
      );

      expect(pipeline.id).toBeDefined();
      expect(pipeline.name).toBe('My Pipeline');
      expect(pipeline.type).toBe('vertical');
      expect(pipeline.stages).toHaveLength(2);
      expect(pipeline.state).toBe('draft');
      expect(pipeline.currentStageIndex).toBe(0);
      expect(pipeline.createdAt).toBeDefined();
      expect(pipeline.updatedAt).toBeDefined();
    });

    it('should set all stages to pending state', () => {
      const pipeline = PipelineComposer.define(
        'Test',
        'spike',
        [{ type: 'research' }, { type: 'build' }],
      );

      expect(pipeline.stages.every((s) => s.state === 'pending')).toBe(true);
    });

    it('should handle flavored stage references', () => {
      const pipeline = PipelineComposer.define(
        'Flavored',
        'custom',
        [{ type: 'research', flavor: 'competitive' }],
      );

      expect(pipeline.stages[0]?.stageRef.flavor).toBe('competitive');
    });

    it('should generate unique IDs', () => {
      const p1 = PipelineComposer.define('P1', 'vertical', [{ type: 'research' }]);
      const p2 = PipelineComposer.define('P2', 'vertical', [{ type: 'research' }]);

      expect(p1.id).not.toBe(p2.id);
    });
  });

  describe('validate', () => {
    it('should pass for a valid pipeline with compatible gates', () => {
      const pipeline = PipelineComposer.define(
        'Valid',
        'vertical',
        [{ type: 'research' }, { type: 'interview' }, { type: 'shape' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail for missing stages', () => {
      const pipeline = PipelineComposer.define(
        'Missing',
        'vertical',
        [{ type: 'nonexistent-stage' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not found in registry');
    });

    it('should detect gate mismatches', () => {
      // build has no exit gate for interview-notes, but shape requires it
      const pipeline = PipelineComposer.define(
        'Mismatch',
        'custom',
        [{ type: 'build' }, { type: 'shape' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Gate mismatch'))).toBe(true);
      expect(result.errors.some((e) => e.includes('interview-notes'))).toBe(true);
    });

    it('should pass for stages without entry gates', () => {
      const pipeline = PipelineComposer.define(
        'NoGates',
        'custom',
        [{ type: 'research' }, { type: 'build' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.valid).toBe(true);
    });

    it('should report multiple errors', () => {
      const pipeline = PipelineComposer.define(
        'Multi-error',
        'custom',
        [{ type: 'missing1' }, { type: 'missing2' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });

    it('should pass for a single stage pipeline', () => {
      const pipeline = PipelineComposer.define(
        'Single',
        'custom',
        [{ type: 'research' }],
      );

      const result = PipelineComposer.validate(pipeline, registry);
      expect(result.valid).toBe(true);
    });
  });

  describe('instantiate', () => {
    it('should create a pipeline from a template', () => {
      const template: PipelineTemplate = {
        name: 'Vertical Slice',
        type: 'vertical',
        stages: [{ type: 'research' }, { type: 'interview' }, { type: 'shape' }],
      };

      const pipeline = PipelineComposer.instantiate(template);

      expect(pipeline.id).toBeDefined();
      expect(pipeline.name).toBe('Vertical Slice');
      expect(pipeline.type).toBe('vertical');
      expect(pipeline.stages).toHaveLength(3);
      expect(pipeline.state).toBe('draft');
    });

    it('should inject metadata when provided', () => {
      const template: PipelineTemplate = {
        name: 'Test',
        type: 'bug-fix',
        stages: [{ type: 'research' }],
      };
      const metadata: PipelineMetadata = {
        projectRef: 'my-project',
        issueRefs: ['#42', '#43'],
        betId: '550e8400-e29b-41d4-a716-446655440000',
        cycleId: '550e8400-e29b-41d4-a716-446655440001',
      };

      const pipeline = PipelineComposer.instantiate(template, metadata);

      expect(pipeline.metadata.projectRef).toBe('my-project');
      expect(pipeline.metadata.issueRefs).toEqual(['#42', '#43']);
      expect(pipeline.metadata.betId).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    it('should default metadata if not provided', () => {
      const template: PipelineTemplate = {
        name: 'Default',
        type: 'spike',
        stages: [{ type: 'research' }],
      };

      const pipeline = PipelineComposer.instantiate(template);
      expect(pipeline.metadata.issueRefs).toEqual([]);
    });
  });
});
