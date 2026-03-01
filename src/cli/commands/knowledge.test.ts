import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { registerKnowledgeCommands } from './knowledge.js';

describe('registerKnowledgeCommands', () => {
  const baseDir = join(tmpdir(), `kata-knowledge-cmd-test-${Date.now()}`);
  const kataDir = join(baseDir, '.kata');
  const knowledgeDir = join(kataDir, 'knowledge');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(knowledgeDir, { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>').option('--plain');
    program.exitOverride();
    registerKnowledgeCommands(program);
    return program;
  }

  describe('knowledge query', () => {
    it('shows empty result when no learnings exist', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'knowledge', 'query']);

      expect(consoleSpy).toHaveBeenCalledWith('No learnings found.');
    });

    it('queries learnings with filters', async () => {
      // Seed some learnings
      const store = new KnowledgeStore(knowledgeDir);
      store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Always mock external services',
        confidence: 0.9,
        stageType: 'build',
        evidence: [],
      });
      store.capture({
        tier: 'category',
        category: 'architecture',
        content: 'Use clean architecture layers',
        confidence: 0.7,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'query', '--tier', 'stage',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('testing');
      expect(output).toContain('stage');
      expect(output).not.toContain('architecture');
    });

    it('outputs JSON', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Test everything',
        confidence: 0.8,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'query',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].tier).toBe('stage');
    });

    it('filters by category', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Write tests first',
        confidence: 0.8,
        evidence: [],
      });
      store.capture({
        tier: 'stage',
        category: 'design',
        content: 'Design before coding',
        confidence: 0.6,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'query', '--category', 'testing',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].category).toBe('testing');
    });
  });

  describe('knowledge stats', () => {
    it('shows stats for empty store', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', baseDir, 'knowledge', 'stats']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Total Learnings: 0');
    });

    it('shows stats with data', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Test learning',
        confidence: 0.8,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--plain', '--cwd', baseDir, 'knowledge', 'stats']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('Total Learnings: 1');
      expect(output).toContain('Stage:    1');
    });

    it('shows stats as JSON', async () => {
      const program = createProgram();
      await program.parseAsync(['node', 'test', '--json', '--cwd', baseDir, 'knowledge', 'stats']);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.total).toBeDefined();
      expect(parsed.byTier).toBeDefined();
    });

    it('shows error when .kata does not exist', async () => {
      const noKataDir = join(tmpdir(), `kata-no-kata-knowledge-${Date.now()}`);
      mkdirSync(noKataDir, { recursive: true });

      const program = createProgram();
      await program.parseAsync(['node', 'test', '--cwd', noKataDir, 'knowledge', 'stats']);

      expect(errorSpy).toHaveBeenCalled();
      rmSync(noKataDir, { recursive: true, force: true });
    });
  });

  describe('knowledge archive', () => {
    it('archives an existing learning', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Old pattern to archive',
        confidence: 0.6,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'archive', learning.id,
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain(`Archived learning ${learning.id}`);

      // Verify archived in store
      const updated = store.get(learning.id);
      expect(updated.archived).toBe(true);
    });

    it('archives with a reason', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Outdated pattern',
        confidence: 0.5,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'archive', learning.id,
        '--reason', 'Replaced by a better approach',
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0] as string).join('\n');
      expect(output).toContain('Reason: Replaced by a better approach');
    });

    it('outputs JSON on success', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'To be archived',
        confidence: 0.5,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'archive', learning.id,
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe(learning.id);
      expect(parsed[0].archived).toBe(true);
    });

    it('prints error and sets exitCode=1 for unknown ID', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'archive', 'nonexistent-id',
      ]);

      expect(errorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0; // reset
    });

    it('outputs JSON error for unknown ID with --json', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'archive', 'nonexistent-id',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.error).toBeDefined();
      process.exitCode = 0; // reset
    });
  });

  describe('knowledge promote', () => {
    it('promotes a learning to a higher permanence tier', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'architecture',
        content: 'Use dependency injection',
        confidence: 0.85,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'promote', learning.id,
        '--permanence', 'operational',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain(learning.id);
      expect(output).toContain('operational');
    });

    it('outputs JSON on success', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'architecture',
        content: 'Layered architecture',
        confidence: 0.9,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'promote', learning.id,
        '--permanence', 'strategic',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe(learning.id);
      expect(parsed[0].permanence).toBe('strategic');
    });

    it('rejects invalid permanence level', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Some learning',
        confidence: 0.7,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'promote', learning.id,
        '--permanence', 'invalid-level',
      ]);

      expect(errorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0; // reset
    });

    it('outputs JSON error for invalid permanence with --json', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'stage',
        category: 'testing',
        content: 'Some learning',
        confidence: 0.7,
        evidence: [],
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'knowledge', 'promote', learning.id,
        '--permanence', 'invalid-level',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      const parsed = JSON.parse(output);
      expect(parsed.error).toBeDefined();
      process.exitCode = 0; // reset
    });

    it('prints error and sets exitCode=1 for unknown ID', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'promote', 'nonexistent-id',
        '--permanence', 'operational',
      ]);

      expect(errorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0; // reset
    });

    it('supports constitutional permanence level', async () => {
      const store = new KnowledgeStore(knowledgeDir);
      const learning = store.capture({
        tier: 'agent',
        category: 'architecture',
        content: 'Constitutional-level principle',
        confidence: 0.95,
        evidence: [],
        agentId: 'kata-sensei',
      });

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'knowledge', 'promote', learning.id,
        '--permanence', 'constitutional',
      ]);

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain('constitutional');
    });
  });
});
