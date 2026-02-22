import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { ExecutionHistoryEntrySchema, type ExecutionHistoryEntry } from '@domain/types/history.js';
import { StageSchema } from '@domain/types/stage.js';
import { JsonStore } from '@infra/persistence/json-store.js';
import { KnowledgeStore } from '@infra/knowledge/knowledge-store.js';
import { registerKnowledgeCommands } from './knowledge.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  select: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
}));

function makeHistoryEntry(overrides: Partial<ExecutionHistoryEntry> = {}): ExecutionHistoryEntry {
  const now = new Date().toISOString();
  return ExecutionHistoryEntrySchema.parse({
    id: randomUUID(),
    pipelineId: randomUUID(),
    stageType: 'build',
    stageIndex: 0,
    adapter: 'manual',
    artifactNames: [],
    learningIds: [],
    startedAt: now,
    completedAt: now,
    ...overrides,
  });
}

describe('bunkai review command', () => {
  const baseDir = join(tmpdir(), `kata-review-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const kataDir = join(baseDir, '.kata');
  const historyDir = join(kataDir, 'history');
  const knowledgeDir = join(kataDir, 'knowledge');
  const stagesDir = join(kataDir, 'stages');
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mkdirSync(historyDir, { recursive: true });
    mkdirSync(join(knowledgeDir, 'learnings'), { recursive: true });
    mkdirSync(stagesDir, { recursive: true });
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  function createProgram(): Command {
    const program = new Command();
    program.option('--json').option('--verbose').option('--cwd <path>');
    program.exitOverride();
    registerKnowledgeCommands(program);
    return program;
  }

  function seedHistory(entries: ExecutionHistoryEntry[]): void {
    for (const entry of entries) {
      JsonStore.write(
        join(historyDir, `${entry.id}.json`),
        entry,
        ExecutionHistoryEntrySchema,
      );
    }
  }

  function seedStage(type: string, promptTemplate?: string): void {
    const stage = {
      type,
      artifacts: [],
      learningHooks: [],
      config: {},
      promptTemplate,
    };
    JsonStore.write(join(stagesDir, `${type}.json`), stage, StageSchema);
  }

  it('shows message when no history exists', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No execution history found');
  });

  it('shows message when no patterns meet criteria', async () => {
    // Seed history with too few entries to form a pattern
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: true }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No patterns found');
  });

  it('auto-accepts all suggestions with --skip-prompts', async () => {
    // Seed history with enough gate failures to trigger a pattern
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: true }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('=== Suggested Learning ===');
    expect(output).toContain('[Auto-accepted]');
    expect(output).toContain('=== Knowledge Review Summary ===');
    expect(output).toContain('Learnings accepted:  ');
  });

  it('filters by stage type', async () => {
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'research', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts', '--stage', 'build',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('build');
    // Should only show build patterns, not research
    const lines = output.split('\n');
    const stageLines = lines.filter((l) => l.includes('Stage:'));
    for (const line of stageLines) {
      expect(line).toContain('build');
    }
  });

  it('outputs JSON when --json flag set', async () => {
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'knowledge', 'review',
    ]);

    const firstCall = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(firstCall);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].tier).toBeDefined();
    expect(parsed[0].category).toBeDefined();
  });

  it('filters by min-confidence', async () => {
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: true }),
    ]);

    const program = createProgram();
    // Use a very high confidence threshold to filter out suggestions
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts', '--min-confidence', '0.99',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('No patterns found');
  });

  it('handles interactive accept flow', async () => {
    const { confirm } = await import('@inquirer/prompts');
    const confirmMock = vi.mocked(confirm);
    confirmMock.mockResolvedValue(true);

    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review',
    ]);

    expect(confirmMock).toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Captured!');
    expect(output).toContain('=== Knowledge Review Summary ===');
  });

  it('handles interactive reject flow', async () => {
    const { confirm } = await import('@inquirer/prompts');
    const confirmMock = vi.mocked(confirm);
    confirmMock.mockResolvedValue(false);

    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('Skipped.');
    expect(output).toContain('Learnings rejected:');
  });

  it('captures learning to knowledge store on accept', async () => {
    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    // Verify learning was captured in the knowledge store
    const store = new KnowledgeStore(knowledgeDir);
    const learnings = store.query({});
    expect(learnings.length).toBeGreaterThan(0);
    expect(learnings[0].tier).toBeDefined();
    expect(learnings[0].category).toBeDefined();
  });

  it('shows error when .kata does not exist', async () => {
    const noKataDir = join(tmpdir(), `kata-no-kata-review-${Date.now()}`);
    mkdirSync(noKataDir, { recursive: true });

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', noKataDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    expect(errorSpy).toHaveBeenCalled();
    rmSync(noKataDir, { recursive: true, force: true });
  });

  it('suggests and applies prompt updates with --skip-prompts', async () => {
    // Seed a stage with a prompt template
    seedStage('build', 'prompts/build.md');

    // Create the prompt template file
    const promptDir = join(kataDir, 'prompts');
    mkdirSync(promptDir, { recursive: true });
    writeFileSync(join(promptDir, 'build.md'), '# Build Stage\n', 'utf-8');

    seedHistory([
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
      makeHistoryEntry({ stageType: 'build', entryGatePassed: false }),
    ]);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'knowledge', 'review', '--skip-prompts',
    ]);

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('=== Knowledge Review Summary ===');
    // The auto-accept flow should have captured learnings and potentially suggested prompt updates
    expect(output).toContain('Learnings accepted:');
  });
});
