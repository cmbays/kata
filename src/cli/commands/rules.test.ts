import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { RuleRegistry } from '@infra/registries/rule-registry.js';
import { registerRuleCommands } from './rules.js';

function makeSuggestionInput() {
  return {
    suggestedRule: {
      category: 'build' as const,
      name: 'Boost TypeScript flavor',
      condition: 'When tests exist',
      effect: 'boost' as const,
      magnitude: 0.3,
      confidence: 0.8,
      source: 'auto-detected' as const,
      evidence: ['decision-abc'],
    },
    triggerDecisionIds: [`00000000-0000-4000-8000-${randomUUID().slice(-12)}`],
    observationCount: 3,
    reasoning: 'Observed 3 times in build stages',
  };
}

describe('kata rule commands', () => {
  let baseDir: string;
  let kataDir: string;
  let rulesDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = join(tmpdir(), `kata-rules-cmd-test-${Date.now()}`);
    kataDir = join(baseDir, '.kata');
    rulesDir = join(kataDir, 'rules');
    mkdirSync(rulesDir, { recursive: true });

    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    vi.clearAllMocks();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerRuleCommands(program);
    return program;
  }

  describe('kata rule accept <id>', () => {
    it('accepts a pending suggestion and promotes it to an active rule', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'rule', 'accept', suggestion.id,
      ]);

      // The suggestion should now be accepted
      const refreshed = new RuleRegistry(rulesDir);
      const pending = refreshed.getPendingSuggestions();
      expect(pending).toHaveLength(0);

      const logOutput = consoleSpy.mock.calls.map((c) => c.join('')).join('\n');
      expect(logOutput).toContain('Accepted rule:');
      expect(logOutput).toContain('boost');
    });

    it('outputs JSON when --json flag is set', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'rule', 'accept', suggestion.id,
      ]);

      const logOutput = consoleSpy.mock.calls.map((c) => c.join('')).join('');
      const parsed = JSON.parse(logOutput);
      expect(parsed.id).toBe(suggestion.id);
      expect(parsed.decision).toBe('accepted');
      expect(parsed.rule).toBeDefined();
      expect(parsed.rule.effect).toBe('boost');
    });

    it('logs an error when suggestion id does not exist', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'rule', 'accept', '00000000-0000-4000-8000-000000000099',
      ]);

      // handleCommandError logs to console.error and sets exitCode — doesn't re-throw
      const errorOutput = errorSpy.mock.calls.map((c) => c.join('')).join('\n');
      expect(errorOutput).toMatch(/Error:/);
    });
  });

  describe('kata rule reject <id> --reason <reason>', () => {
    it('rejects a pending suggestion with a reason', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'rule', 'reject', suggestion.id, '--reason', 'already covered',
      ]);

      // The suggestion should be rejected on disk
      const refreshed = new RuleRegistry(rulesDir);
      const pending = refreshed.getPendingSuggestions();
      expect(pending).toHaveLength(0);

      const logOutput = consoleSpy.mock.calls.map((c) => c.join('')).join('\n');
      expect(logOutput).toContain(`Rejected suggestion ${suggestion.id}`);
    });

    it('outputs JSON when --json flag is set', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--json', '--cwd', baseDir,
        'rule', 'reject', suggestion.id, '--reason', 'not needed',
      ]);

      const logOutput = consoleSpy.mock.calls.map((c) => c.join('')).join('');
      const parsed = JSON.parse(logOutput);
      expect(parsed.id).toBe(suggestion.id);
      expect(parsed.decision).toBe('rejected');
    });

    it('exits with error when --reason is missing', async () => {
      const ruleRegistry = new RuleRegistry(rulesDir);
      const suggestion = ruleRegistry.suggestRule(makeSuggestionInput());

      const program = createProgram();
      // Commander throws when a required option is missing (exitOverride ensures it doesn't process.exit)
      await expect(
        program.parseAsync([
          'node', 'test', '--cwd', baseDir,
          'rule', 'reject', suggestion.id,
        ]),
      ).rejects.toThrow();
    });

    it('logs an error when suggestion id does not exist', async () => {
      const program = createProgram();
      await program.parseAsync([
        'node', 'test', '--cwd', baseDir,
        'rule', 'reject', '00000000-0000-4000-8000-000000000099', '--reason', 'test',
      ]);

      const errorOutput = errorSpy.mock.calls.map((c) => c.join('')).join('\n');
      expect(errorOutput).toMatch(/Error:/);
    });
  });
});
