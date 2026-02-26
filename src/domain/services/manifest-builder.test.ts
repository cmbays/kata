import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Step, StepResources } from '@domain/types/step.js';
import type { Flavor } from '@domain/types/flavor.js';
import type { ExecutionContext } from '@domain/types/manifest.js';
import type { Learning } from '@domain/types/learning.js';
import { RefResolver, RefResolutionError } from '@infra/config/ref-resolver.js';
import { ManifestBuilder } from './manifest-builder.js';

function makeStage(overrides: Partial<Step> = {}): Step {
  return {
    type: 'research',
    description: 'Research the problem space',
    promptTemplate: '# Research Stage\n\nInvestigate the problem.',
    artifacts: [
      { name: 'research-summary', description: 'Summary of research findings', required: true },
    ],
    learningHooks: ['research-quality'],
    config: {},
    entryGate: {
      type: 'entry',
      conditions: [
        { type: 'predecessor-complete', description: 'Previous stage must be done' },
      ],
      required: true,
    },
    exitGate: {
      type: 'exit',
      conditions: [
        { type: 'artifact-exists', artifactName: 'research-summary' },
      ],
      required: true,
    },
    ...overrides,
  };
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    pipelineId: randomUUID(),
    stageIndex: 0,
    metadata: {},
    ...overrides,
  };
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    tier: 'stage',
    category: 'research-quality',
    content: 'Starting with competitor analysis yields better research outputs.',
    evidence: [
      {
        pipelineId: randomUUID(),
        stageType: 'research',
        observation: 'Competitor analysis first led to more structured findings',
        recordedAt: now,
      },
    ],
    confidence: 0.75,
    stageType: 'research',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ManifestBuilder', () => {
  describe('build', () => {
    it('should build a complete manifest from a stage and context', () => {
      const stage = makeStage();
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context);

      expect(manifest.stageType).toBe('research');
      expect(manifest.prompt).toContain('Research Stage');
      expect(manifest.context.pipelineId).toBe(context.pipelineId);
      expect(manifest.entryGate).toBeDefined();
      expect(manifest.exitGate).toBeDefined();
      expect(manifest.artifacts).toHaveLength(1);
      expect(manifest.artifacts[0]?.name).toBe('research-summary');
    });

    it('should include flavor in manifest', () => {
      const stage = makeStage({ flavor: 'competitive-analysis' });
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context);
      expect(manifest.stageFlavor).toBe('competitive-analysis');
    });

    it('should use default prompt when promptTemplate is undefined', () => {
      const stage = makeStage({ promptTemplate: undefined });
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context);
      expect(manifest.prompt).toContain('research');
    });

    it('should inject learnings into the prompt', () => {
      const stage = makeStage();
      const context = makeContext();
      const learnings = [makeLearning()];

      const manifest = ManifestBuilder.build(stage, context, learnings);

      expect(manifest.prompt).toContain('Learnings from Previous Executions');
      expect(manifest.prompt).toContain('competitor analysis');
      expect(manifest.learnings).toHaveLength(1);
    });

    it('should work without learnings', () => {
      const stage = makeStage();
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context);

      expect(manifest.learnings).toHaveLength(0);
      expect(manifest.prompt).not.toContain('Learnings');
    });

    it('should handle empty learnings array', () => {
      const stage = makeStage();
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context, []);

      expect(manifest.learnings).toHaveLength(0);
    });

    it('should handle stage with no gates', () => {
      const stage = makeStage({
        entryGate: undefined,
        exitGate: undefined,
      });
      const context = makeContext();

      const manifest = ManifestBuilder.build(stage, context);

      expect(manifest.entryGate).toBeUndefined();
      expect(manifest.exitGate).toBeUndefined();
    });
  });

  describe('resolveRefs', () => {
    it('should resolve a prompt template path and return file contents', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'manifest-refs-'));
      mkdirSync(join(tempDir, 'prompts'), { recursive: true });

      const promptContent = '# Research Prompt\n\nDo thorough research on the topic.';
      writeFileSync(join(tempDir, 'prompts', 'research.md'), promptContent);

      const result = ManifestBuilder.resolveRefs('prompts/research.md', tempDir, RefResolver);
      expect(result).toBe(promptContent);
    });

    it('should resolve parent directory references', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'manifest-refs-'));
      mkdirSync(join(tempDir, 'builtin'), { recursive: true });
      mkdirSync(join(tempDir, 'prompts'), { recursive: true });

      const content = '# Build Prompt\n\nBuild the thing.';
      writeFileSync(join(tempDir, 'prompts', 'build.md'), content);

      const result = ManifestBuilder.resolveRefs(
        '../prompts/build.md',
        join(tempDir, 'builtin'),
        RefResolver,
      );
      expect(result).toBe(content);
    });

    it('should throw RefResolutionError for missing files', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'manifest-refs-'));

      expect(() => {
        ManifestBuilder.resolveRefs('nonexistent.md', tempDir, RefResolver);
      }).toThrow(RefResolutionError);
    });
  });

  describe('attachGates', () => {
    it('should extract entry and exit gates from a stage', () => {
      const stage = makeStage();
      const gates = ManifestBuilder.attachGates(stage);

      expect(gates.entryGate).toBeDefined();
      expect(gates.entryGate?.type).toBe('entry');
      expect(gates.exitGate).toBeDefined();
      expect(gates.exitGate?.type).toBe('exit');
    });

    it('should return undefined for missing gates', () => {
      const stage = makeStage({
        entryGate: undefined,
        exitGate: undefined,
      });

      const gates = ManifestBuilder.attachGates(stage);
      expect(gates.entryGate).toBeUndefined();
      expect(gates.exitGate).toBeUndefined();
    });

    it('should handle stage with only entry gate', () => {
      const stage = makeStage({ exitGate: undefined });
      const gates = ManifestBuilder.attachGates(stage);

      expect(gates.entryGate).toBeDefined();
      expect(gates.exitGate).toBeUndefined();
    });

    it('should handle stage with only exit gate', () => {
      const stage = makeStage({ entryGate: undefined });
      const gates = ManifestBuilder.attachGates(stage);

      expect(gates.entryGate).toBeUndefined();
      expect(gates.exitGate).toBeDefined();
    });
  });

  describe('injectLearnings', () => {
    it('should format learnings as markdown context', () => {
      const learnings = [makeLearning()];
      const text = ManifestBuilder.injectLearnings(learnings);

      expect(text).toContain('## Learnings from Previous Executions');
      expect(text).toContain('[STAGE] research-quality');
      expect(text).toContain('**Confidence**: 75%');
      expect(text).toContain('competitor analysis yields better');
    });

    it('should include evidence in output', () => {
      const learnings = [makeLearning()];
      const text = ManifestBuilder.injectLearnings(learnings);

      expect(text).toContain('**Evidence**');
      expect(text).toContain('more structured findings');
    });

    it('should return empty string for empty learnings', () => {
      const text = ManifestBuilder.injectLearnings([]);
      expect(text).toBe('');
    });

    it('should format multiple learnings', () => {
      const learnings = [
        makeLearning({ category: 'cat-1', content: 'Learning one' }),
        makeLearning({ category: 'cat-2', content: 'Learning two', tier: 'category' }),
      ];

      const text = ManifestBuilder.injectLearnings(learnings);
      expect(text).toContain('cat-1');
      expect(text).toContain('cat-2');
      expect(text).toContain('Learning one');
      expect(text).toContain('Learning two');
      expect(text).toContain('[CATEGORY]');
    });

    it('should handle learnings without evidence', () => {
      const learning = makeLearning({ evidence: [] });
      const text = ManifestBuilder.injectLearnings([learning]);

      expect(text).not.toContain('**Evidence**');
    });

    it('should format confidence as percentage', () => {
      const learning = makeLearning({ confidence: 0.92 });
      const text = ManifestBuilder.injectLearnings([learning]);

      expect(text).toContain('92%');
    });
  });

  describe('serializeResources', () => {
    it('should render ## Suggested Resources section with tools', () => {
      const text = ManifestBuilder.serializeResources({
        tools: [{ name: 'tsc', purpose: 'Type checking', command: 'npx tsc --noEmit' }],
        agents: [],
        skills: [],
      });
      expect(text).toContain('## Suggested Resources');
      expect(text).toContain('**Tools**');
      expect(text).toContain('tsc: Type checking');
      expect(text).toContain('`npx tsc --noEmit`');
    });

    it('should render agents section', () => {
      const text = ManifestBuilder.serializeResources({
        tools: [],
        agents: [{ name: 'everything-claude-code:build-error-resolver', when: 'when build fails' }],
        skills: [],
      });
      expect(text).toContain('**Agents**');
      expect(text).toContain('everything-claude-code:build-error-resolver');
      expect(text).toContain('when build fails');
    });

    it('should render skills section', () => {
      const text = ManifestBuilder.serializeResources({
        tools: [],
        agents: [],
        skills: [{ name: 'pr-review-toolkit:code-reviewer', when: 'before marking stage complete' }],
      });
      expect(text).toContain('**Skills**');
      expect(text).toContain('pr-review-toolkit:code-reviewer');
      expect(text).toContain('before marking stage complete');
    });

    it('should return empty string when all arrays are empty', () => {
      const text = ManifestBuilder.serializeResources({ tools: [], agents: [], skills: [] });
      expect(text).toBe('');
    });

    it('should omit absent sections', () => {
      const text = ManifestBuilder.serializeResources({
        tools: [{ name: 'tsc', purpose: 'Type checking' }],
        agents: [],
        skills: [],
      });
      expect(text).not.toContain('**Agents**');
      expect(text).not.toContain('**Skills**');
    });

    it('should render tool without command (no backtick suffix)', () => {
      const text = ManifestBuilder.serializeResources({
        tools: [{ name: 'eslint', purpose: 'Linting' }],
        agents: [],
        skills: [],
      });
      expect(text).toContain('eslint: Linting');
      // No command suffix
      expect(text).not.toContain('`undefined`');
    });
  });

  describe('aggregateFlavorResources', () => {
    function makeFlavor(overrides: Partial<Flavor> = {}): Flavor {
      return {
        name: 'default-build',
        stageCategory: 'build',
        steps: [{ stepName: 'main', stepType: 'build' }],
        synthesisArtifact: 'build-output',
        ...overrides,
      };
    }

    function makeResources(
      tools: Array<{ name: string; purpose: string }> = [],
    ): StepResources {
      return { tools, agents: [], skills: [] };
    }

    it('returns step resources when flavor has no resources', () => {
      const flavor = makeFlavor({ steps: [{ stepName: 'step1', stepType: 'build' }] });
      const stepDefs = [makeStage({ type: 'build', resources: makeResources([{ name: 'tsc', purpose: 'type check' }]) })];
      const result = ManifestBuilder.aggregateFlavorResources(flavor, stepDefs);
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.name).toBe('tsc');
    });

    it('appends flavor-level additions after step resources', () => {
      const flavor = makeFlavor({
        steps: [{ stepName: 'step1', stepType: 'build' }],
        resources: makeResources([{ name: 'vitest', purpose: 'testing' }]),
      });
      const stepDefs = [makeStage({ type: 'build', resources: makeResources([{ name: 'tsc', purpose: 'type check' }]) })];
      const result = ManifestBuilder.aggregateFlavorResources(flavor, stepDefs);
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual(['tsc', 'vitest']);
    });

    it('deduplicates by name — step definition wins on conflict', () => {
      const flavor = makeFlavor({
        steps: [{ stepName: 'step1', stepType: 'build' }],
        resources: makeResources([{ name: 'tsc', purpose: 'flavor-purpose' }]),
      });
      const stepDefs = [makeStage({ type: 'build', resources: makeResources([{ name: 'tsc', purpose: 'step-purpose' }]) })];
      const result = ManifestBuilder.aggregateFlavorResources(flavor, stepDefs);
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0]?.purpose).toBe('step-purpose');
    });

    it('skips FlavorStepRef with no matching stepDef — no throw', () => {
      const flavor = makeFlavor({ steps: [{ stepName: 'step1', stepType: 'nonexistent' }] });
      expect(() => ManifestBuilder.aggregateFlavorResources(flavor, [])).not.toThrow();
      const result = ManifestBuilder.aggregateFlavorResources(flavor, []);
      expect(result.tools).toHaveLength(0);
      expect(result.agents).toHaveLength(0);
      expect(result.skills).toHaveLength(0);
    });

    it('returns empty resources when step has no resources and flavor has none', () => {
      const flavor = makeFlavor({ steps: [{ stepName: 'step1', stepType: 'build' }] });
      const stepDefs = [makeStage({ type: 'build', resources: undefined })];
      const result = ManifestBuilder.aggregateFlavorResources(flavor, stepDefs);
      expect(result.tools).toHaveLength(0);
      expect(result.agents).toHaveLength(0);
      expect(result.skills).toHaveLength(0);
    });

    it('aggregates resources across multiple steps in order', () => {
      const flavor = makeFlavor({
        steps: [
          { stepName: 'step1', stepType: 'research' },
          { stepName: 'step2', stepType: 'build' },
        ],
      });
      const stepDefs = [
        makeStage({ type: 'research', resources: makeResources([{ name: 'read', purpose: 'read files' }]) }),
        makeStage({ type: 'build', resources: makeResources([{ name: 'tsc', purpose: 'type check' }]) }),
      ];
      const result = ManifestBuilder.aggregateFlavorResources(flavor, stepDefs);
      expect(result.tools).toHaveLength(2);
      expect(result.tools.map((t) => t.name)).toEqual(['read', 'tsc']);
    });
  });

  describe('build with resources', () => {
    it('should inject ## Suggested Resources into prompt when resources present', () => {
      const stage = makeStage({
        resources: {
          tools: [{ name: 'tsc', purpose: 'Type checking', command: 'npx tsc --noEmit' }],
          agents: [],
          skills: [],
        },
      });
      const context = makeContext();
      const manifest = ManifestBuilder.build(stage, context);

      expect(manifest.prompt).toContain('## Suggested Resources');
      expect(manifest.prompt).toContain('tsc: Type checking');
    });

    it('should omit ## Suggested Resources section when resources absent', () => {
      const stage = makeStage({ resources: undefined });
      const context = makeContext();
      const manifest = ManifestBuilder.build(stage, context);

      expect(manifest.prompt).not.toContain('## Suggested Resources');
    });

    it('should pass resources through to manifest field', () => {
      const resources = {
        tools: [{ name: 'tsc', purpose: 'Checking' }],
        agents: [],
        skills: [],
      };
      const stage = makeStage({ resources });
      const manifest = ManifestBuilder.build(stage, makeContext());

      expect(manifest.resources).toBeDefined();
      expect(manifest.resources!.tools).toHaveLength(1);
    });

    it('should have undefined resources on manifest when stage has no resources', () => {
      const manifest = ManifestBuilder.build(makeStage(), makeContext());
      expect(manifest.resources).toBeUndefined();
    });
  });

  describe('build with flavorResources', () => {
    it('merges step and flavor resources — step wins on name conflict', () => {
      const stage = makeStage({
        resources: {
          tools: [{ name: 'tsc', purpose: 'step-purpose' }],
          agents: [],
          skills: [],
        },
      });
      const flavorResources: StepResources = {
        tools: [{ name: 'tsc', purpose: 'flavor-purpose' }, { name: 'vitest', purpose: 'testing' }],
        agents: [],
        skills: [],
      };
      const manifest = ManifestBuilder.build(stage, makeContext(), undefined, flavorResources);
      expect(manifest.resources?.tools).toHaveLength(2);
      expect(manifest.resources?.tools[0]?.purpose).toBe('step-purpose');
      expect(manifest.resources?.tools[1]?.name).toBe('vitest');
    });

    it('uses only flavorResources when step has no resources', () => {
      const stage = makeStage({ resources: undefined });
      const flavorResources: StepResources = {
        tools: [{ name: 'vitest', purpose: 'testing' }],
        agents: [],
        skills: [],
      };
      const manifest = ManifestBuilder.build(stage, makeContext(), undefined, flavorResources);
      expect(manifest.prompt).toContain('## Suggested Resources');
      expect(manifest.prompt).toContain('vitest');
    });

    it('serializes merged resources once — no double-print', () => {
      const stage = makeStage({
        resources: { tools: [{ name: 'tsc', purpose: 'check' }], agents: [], skills: [] },
      });
      const flavorResources: StepResources = {
        tools: [{ name: 'vitest', purpose: 'testing' }],
        agents: [],
        skills: [],
      };
      const manifest = ManifestBuilder.build(stage, makeContext(), undefined, flavorResources);
      const count = (manifest.prompt.match(/## Suggested Resources/g) ?? []).length;
      expect(count).toBe(1);
    });

    it('has undefined resources when both step and flavor have no resources', () => {
      const manifest = ManifestBuilder.build(makeStage({ resources: undefined }), makeContext(), undefined, undefined);
      expect(manifest.resources).toBeUndefined();
    });
  });
});
