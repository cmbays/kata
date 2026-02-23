import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Stage } from '@domain/types/stage.js';
import type { ExecutionContext } from '@domain/types/manifest.js';
import type { Learning } from '@domain/types/learning.js';
import { RefResolver, RefResolutionError } from '@infra/config/ref-resolver.js';
import { ManifestBuilder } from './manifest-builder.js';

function makeStage(overrides: Partial<Stage> = {}): Stage {
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
});
