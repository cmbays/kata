import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { StageRegistry } from '@infra/registries/stage-registry.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { StageSchema } from '@domain/types/stage.js';
import { PromptUpdater } from './prompt-updater.js';
import type { PromptUpdate } from './learning-extractor.js';

describe('PromptUpdater', () => {
  let updater: PromptUpdater;
  let baseDir: string;
  let kataDir: string;
  let stagesDir: string;
  let stageRegistry: StageRegistry;

  beforeEach(() => {
    updater = new PromptUpdater();
    baseDir = join(tmpdir(), `kata-prompt-updater-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    kataDir = join(baseDir, '.kata');
    stagesDir = join(kataDir, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    stageRegistry = new StageRegistry(stagesDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function makeUpdate(overrides: Partial<PromptUpdate> = {}): PromptUpdate {
    return {
      stageType: 'build',
      currentPromptPath: 'prompts/build.md',
      section: 'testing',
      suggestion: '## Learned Patterns (testing)\n\n- Always run tests first',
      rationale: '1 learning accumulated for "testing" in the "build" stage.',
      basedOnLearnings: ['learning-1'],
      ...overrides,
    };
  }

  describe('apply', () => {
    it('appends suggestion to existing prompt template', () => {
      const promptDir = join(kataDir, 'prompts');
      mkdirSync(promptDir, { recursive: true });
      const promptPath = join(promptDir, 'build.md');
      writeFileSync(promptPath, '# Build Stage\n\nDo the build.\n', 'utf-8');

      const result = updater.apply(kataDir, makeUpdate(), stageRegistry);

      expect(result.applied).toBe(true);
      expect(result.stageType).toBe('build');
      expect(result.backupPath).toBe(`${promptPath}.bak`);

      const updated = readFileSync(promptPath, 'utf-8');
      expect(updated).toContain('# Build Stage');
      expect(updated).toContain('## Learned Patterns (testing)');
      expect(updated).toContain('- Always run tests first');
    });

    it('creates backup of original file', () => {
      const promptDir = join(kataDir, 'prompts');
      mkdirSync(promptDir, { recursive: true });
      const promptPath = join(promptDir, 'build.md');
      const originalContent = '# Build Stage\n\nOriginal content.\n';
      writeFileSync(promptPath, originalContent, 'utf-8');

      const result = updater.apply(kataDir, makeUpdate(), stageRegistry);

      expect(result.backupPath).toBeDefined();
      expect(existsSync(result.backupPath!)).toBe(true);
      const backup = readFileSync(result.backupPath!, 'utf-8');
      expect(backup).toBe(originalContent);
    });

    it('creates new file when prompt template does not exist', () => {
      const promptDir = join(kataDir, 'prompts');
      mkdirSync(promptDir, { recursive: true });

      const result = updater.apply(kataDir, makeUpdate(), stageRegistry);

      expect(result.applied).toBe(true);
      const promptPath = join(kataDir, 'prompts', 'build.md');
      const content = readFileSync(promptPath, 'utf-8');
      expect(content).toContain('## Learned Patterns (testing)');
    });

    it('returns error when no prompt path can be resolved', () => {
      const update = makeUpdate({ currentPromptPath: undefined, stageType: 'nonexistent' });
      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(false);
      expect(result.error).toContain('No prompt template found');
    });

    it('resolves prompt path from stage registry when not in update', () => {
      // Register a stage with a prompt template
      const stage = {
        type: 'build',
        artifacts: [],
        learningHooks: [],
        config: {},
        promptTemplate: 'prompts/build.md',
      };
      JsonStore.write(join(stagesDir, 'build.json'), stage, StageSchema);

      const promptDir = join(kataDir, 'prompts');
      mkdirSync(promptDir, { recursive: true });

      const update = makeUpdate({ currentPromptPath: undefined });
      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(true);
      const content = readFileSync(join(kataDir, 'prompts', 'build.md'), 'utf-8');
      expect(content).toContain('## Learned Patterns (testing)');
    });

    it('rejects path traversal via ../ sequences', () => {
      const update = makeUpdate({ currentPromptPath: '../../../etc/passwd' });
      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(false);
      expect(result.error).toContain('No prompt template found');
    });

    it('rejects absolute path outside kataDir', () => {
      const update = makeUpdate({ currentPromptPath: '/tmp/evil.md' });
      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(false);
      expect(result.error).toContain('No prompt template found');
    });

    it('rejects path with null byte', () => {
      const update = makeUpdate({ currentPromptPath: 'prompts/build.md\x00.txt' });
      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(false);
      expect(result.error).toContain('No prompt template found');
    });

    it('handles update to nested directory path', () => {
      const update = makeUpdate({
        currentPromptPath: 'prompts/stages/deep/build.md',
      });

      const result = updater.apply(kataDir, update, stageRegistry);

      expect(result.applied).toBe(true);
      const content = readFileSync(join(kataDir, 'prompts', 'stages', 'deep', 'build.md'), 'utf-8');
      expect(content).toContain('## Learned Patterns');
    });
  });

  describe('preview', () => {
    it('generates a diff-like preview with existing prompt path', () => {
      const update = makeUpdate();
      const preview = updater.preview(update);

      expect(preview).toContain('--- prompts/build.md');
      expect(preview).toContain('+++ prompts/build.md (updated)');
      expect(preview).toContain('@@ Section: testing @@');
      expect(preview).toContain('+ ## Learned Patterns (testing)');
      expect(preview).toContain('+ - Always run tests first');
      expect(preview).toContain('Rationale:');
    });

    it('shows (new) marker when no current prompt path', () => {
      const update = makeUpdate({ currentPromptPath: undefined });
      const preview = updater.preview(update);

      expect(preview).toContain('--- (new: build)');
      expect(preview).toContain('+++ (new: build) (updated)');
    });

    it('includes all suggestion lines as additions', () => {
      const update = makeUpdate({
        suggestion: 'Line 1\nLine 2\nLine 3',
      });
      const preview = updater.preview(update);

      expect(preview).toContain('+ Line 1');
      expect(preview).toContain('+ Line 2');
      expect(preview).toContain('+ Line 3');
    });

    it('includes rationale', () => {
      const update = makeUpdate({ rationale: 'Important reason for change.' });
      const preview = updater.preview(update);

      expect(preview).toContain('Rationale: Important reason for change.');
    });
  });
});
