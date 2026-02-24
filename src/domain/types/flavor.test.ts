import { FlavorSchema, FlavorStepRefSchema, StepOverrideSchema } from './flavor.js';

describe('FlavorStepRefSchema', () => {
  it('accepts valid step reference', () => {
    const ref = FlavorStepRefSchema.parse({ stepName: 'shaping', stepType: 'shape' });
    expect(ref.stepName).toBe('shaping');
    expect(ref.stepType).toBe('shape');
  });

  it('rejects empty stepName', () => {
    expect(() => FlavorStepRefSchema.parse({ stepName: '', stepType: 'shape' })).toThrow();
  });

  it('rejects empty stepType', () => {
    expect(() => FlavorStepRefSchema.parse({ stepName: 'shaping', stepType: '' })).toThrow();
  });
});

describe('StepOverrideSchema', () => {
  it('accepts empty override (all optional)', () => {
    const override = StepOverrideSchema.parse({});
    expect(override).toEqual({});
  });

  it('accepts humanApproval override', () => {
    const override = StepOverrideSchema.parse({ humanApproval: true });
    expect(override.humanApproval).toBe(true);
  });

  it('accepts confidenceThreshold override', () => {
    const override = StepOverrideSchema.parse({ confidenceThreshold: 0.8 });
    expect(override.confidenceThreshold).toBe(0.8);
  });

  it('accepts boundary values 0 and 1 for confidenceThreshold', () => {
    expect(StepOverrideSchema.parse({ confidenceThreshold: 0 }).confidenceThreshold).toBe(0);
    expect(StepOverrideSchema.parse({ confidenceThreshold: 1 }).confidenceThreshold).toBe(1);
  });

  it('rejects confidenceThreshold above 1', () => {
    expect(() => StepOverrideSchema.parse({ confidenceThreshold: 1.5 })).toThrow();
  });

  it('rejects confidenceThreshold below 0', () => {
    expect(() => StepOverrideSchema.parse({ confidenceThreshold: -0.1 })).toThrow();
  });

  it('accepts timeout override', () => {
    const override = StepOverrideSchema.parse({ timeout: 30000 });
    expect(override.timeout).toBe(30000);
  });

  it('rejects non-positive timeout', () => {
    expect(() => StepOverrideSchema.parse({ timeout: 0 })).toThrow();
    expect(() => StepOverrideSchema.parse({ timeout: -1 })).toThrow();
  });

  it('accepts all override fields together', () => {
    const override = StepOverrideSchema.parse({
      humanApproval: false,
      confidenceThreshold: 0.5,
      timeout: 60000,
    });
    expect(override.humanApproval).toBe(false);
    expect(override.confidenceThreshold).toBe(0.5);
    expect(override.timeout).toBe(60000);
  });
});

describe('FlavorSchema', () => {
  const minimalFlavor = {
    name: 'ui-planning',
    stageCategory: 'plan' as const,
    steps: [{ stepName: 'shaping', stepType: 'shape' }],
    synthesisArtifact: 'shape-document',
  };

  it('accepts a minimal valid flavor', () => {
    const flavor = FlavorSchema.parse(minimalFlavor);
    expect(flavor.name).toBe('ui-planning');
    expect(flavor.stageCategory).toBe('plan');
    expect(flavor.steps).toHaveLength(1);
    expect(flavor.synthesisArtifact).toBe('shape-document');
  });

  it('accepts a full flavor with description and overrides', () => {
    const flavor = FlavorSchema.parse({
      name: 'data-model-planning',
      description: 'Schema design + migration planning',
      stageCategory: 'plan',
      steps: [
        { stepName: 'schema-design', stepType: 'shape' },
        { stepName: 'migration-planning', stepType: 'plan' },
        { stepName: 'impl-planning', stepType: 'plan' },
      ],
      overrides: {
        'schema-design': { humanApproval: true },
        'impl-planning': { confidenceThreshold: 0.9, timeout: 120000 },
      },
      synthesisArtifact: 'implementation-plan',
    });

    expect(flavor.steps).toHaveLength(3);
    expect(flavor.overrides?.['schema-design']?.humanApproval).toBe(true);
    expect(flavor.overrides?.['impl-planning']?.confidenceThreshold).toBe(0.9);
  });

  it('accepts all valid stage categories', () => {
    const categories = ['research', 'plan', 'build', 'review'] as const;
    for (const cat of categories) {
      const flavor = FlavorSchema.parse({ ...minimalFlavor, stageCategory: cat });
      expect(flavor.stageCategory).toBe(cat);
    }
  });

  it('rejects empty flavor name', () => {
    expect(() => FlavorSchema.parse({ ...minimalFlavor, name: '' })).toThrow();
  });

  it('rejects empty steps array', () => {
    expect(() => FlavorSchema.parse({ ...minimalFlavor, steps: [] })).toThrow();
  });

  it('rejects invalid stage category', () => {
    expect(() => FlavorSchema.parse({ ...minimalFlavor, stageCategory: 'invalid' })).toThrow();
  });

  it('rejects empty synthesisArtifact', () => {
    expect(() => FlavorSchema.parse({ ...minimalFlavor, synthesisArtifact: '' })).toThrow();
  });

  it('allows overrides field to be omitted', () => {
    const flavor = FlavorSchema.parse(minimalFlavor);
    expect(flavor.overrides).toBeUndefined();
  });

  it('step reuse: same stepType can appear under different stepNames', () => {
    const flavor = FlavorSchema.parse({
      ...minimalFlavor,
      steps: [
        { stepName: 'initial-planning', stepType: 'plan' },
        { stepName: 'final-planning', stepType: 'plan' },
      ],
    });
    expect(flavor.steps[0].stepType).toBe('plan');
    expect(flavor.steps[1].stepType).toBe('plan');
    expect(flavor.steps[0].stepName).not.toBe(flavor.steps[1].stepName);
  });

  it('rejects duplicate stepName within the same flavor', () => {
    expect(() =>
      FlavorSchema.parse({
        ...minimalFlavor,
        steps: [
          { stepName: 'shaping', stepType: 'shape' },
          { stepName: 'shaping', stepType: 'breadboard' }, // same stepName
        ],
      }),
    ).toThrow(/Duplicate stepName/);
  });
});
