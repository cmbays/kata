import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Command } from 'commander';
import { registerDecisionCommands } from './decision.js';
import { createRunTree, readStageState, runPaths } from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { DecisionEntrySchema, DecisionOutcomeEntrySchema } from '@domain/types/run-state.js';
import type { Run, DecisionEntry } from '@domain/types/run-state.js';

function tempBase(): string {
  return join(tmpdir(), `kata-decision-test-${randomUUID()}`);
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: randomUUID(),
    cycleId: randomUUID(),
    betId: randomUUID(),
    betPrompt: 'Implement auth',
    stageSequence: ['research', 'plan'],
    currentStage: null,
    status: 'running',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('registerDecisionCommands — decision record', () => {
  let baseDir: string;
  let kataDir: string;
  let runsDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = tempBase();
    kataDir = join(baseDir, '.kata');
    runsDir = join(kataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
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
    registerDecisionCommands(program);
    return program;
  }

  const BASE_ARGS = (runId: string, cwd: string) => [
    'node', 'test', '--cwd', cwd,
    'decision', 'record', runId,
    '--stage', 'research',
    '--flavor', 'technical-research',
    '--step', 'gather-context',
    '--type', 'flavor-selection',
    '--context', '{"betType":"auth"}',
    '--options', '["technical-research","codebase-analysis"]',
    '--selected', 'technical-research',
    '--confidence', '0.87',
    '--reasoning', 'Best match for auth bet',
  ];

  it('appends a decision entry to decisions.jsonl', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync(BASE_ARGS(run.id, baseDir));

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].stageCategory).toBe('research');
    expect(entries[0].flavor).toBe('technical-research');
    expect(entries[0].step).toBe('gather-context');
    expect(entries[0].decisionType).toBe('flavor-selection');
    expect(entries[0].confidence).toBe(0.87);
    expect(entries[0].selection).toBe('technical-research');
    expect(entries[0].id).toBeDefined();
    expect(entries[0].decidedAt).toBeDefined();
  });

  it('outputs recorded decision as JSON with --json flag', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    const args = ['node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a","b"]',
      '--selected', 'a',
      '--confidence', '0.9',
      '--reasoning', 'Test reasoning',
    ];
    await program.parseAsync(args);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.decisionType).toBe('flavor-selection');
    expect(parsed.selection).toBe('a');
    expect(parsed.id).toBeDefined();
  });

  it('allows null flavor and step (stage-level decision)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'capability-analysis',
      '--context', '{"bet":"auth"}',
      '--options', '["high","medium","low"]',
      '--selected', 'high',
      '--confidence', '0.75',
      '--reasoning', 'High capability',
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries[0].flavor).toBeNull();
    expect(entries[0].step).toBeNull();
  });

  it('warns but accepts unknown decision types', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'plan',
      '--type', 'custom-judgment',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.5',
      '--reasoning', 'Custom',
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries[0].decisionType).toBe('custom-judgment');
    warnSpy.mockRestore();
  });

  it('errors on invalid stage', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'deploy',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.5',
      '--reasoning', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid stage category'));
  });

  it('errors on invalid confidence value', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '1.5',
      '--reasoning', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('confidence'));
  });

  it('allows empty --options for gap-assessment decisions', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'gap-assessment',
      '--context', '{"phase":"analysis"}',
      '--options', '[]',
      '--selected', 'gap-identified',
      '--confidence', '0.6',
      '--reasoning', 'Identified a gap in security coverage',
    ]);

    expect(errorSpy).not.toHaveBeenCalled();
    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].options).toEqual([]);
    expect(entries[0].selection).toBe('gap-identified');
  });

  it('errors when --selected is not in --options', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["technical-research","codebase-analysis"]',
      '--selected', 'unknown-flavor',
      '--confidence', '0.8',
      '--reasoning', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"unknown-flavor"'));
  });

  it('errors on invalid context JSON', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', 'not-json',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.5',
      '--reasoning', 'Test',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('context'));
  });

  it('creates a confidence gate when confidence is below default threshold (0.7)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a","b"]',
      '--selected', 'a',
      '--confidence', '0.5',
      '--reasoning', 'Low confidence',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceGateCreated).toBe(true);

    // Verify gate written to stage state
    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeDefined();
    expect(stageState.pendingGate!.gateType).toBe('confidence-gate');
  });

  it('bypasses confidence gate with --yolo and sets lowConfidence on entry', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.4',
      '--reasoning', 'Low but yolo',
      '--yolo',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceYolo).toBe(true);
    expect(output.lowConfidence).toBe(true);
    expect(output.lowConfidenceGateCreated).toBeUndefined();

    // No pending gate should be created
    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeUndefined();
  });

  it('does not create confidence gate when confidence meets threshold', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.8',
      '--reasoning', 'Confident',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceGateCreated).toBeUndefined();

    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeUndefined();
  });

  it('respects custom confidence threshold from config.json', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // Write config with high threshold (0.9) — 0.8 confidence should trigger gate
    writeFileSync(join(kataDir, 'config.json'), JSON.stringify({
      methodology: 'shape-up',
      execution: { adapter: 'manual', config: {}, confidenceThreshold: 0.9 },
      customStagePaths: [],
      project: {},
    }));

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.8',
      '--reasoning', 'Below custom threshold',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceGateCreated).toBe(true);
  });

  it('does not create a gate at exactly the threshold boundary (< not <=)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.7', // exactly at default threshold
      '--reasoning', 'On the boundary',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceGateCreated).toBeUndefined();
    expect(output.lowConfidence).toBeUndefined();

    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeUndefined();
  });

  it('sets lowConfidence on entry even without --yolo when gate is created', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.5',
      '--reasoning', 'Low confidence triggers gate',
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries[0]!.lowConfidence).toBe(true);
  });

  // Issue #212 — optional flags
  it('records a decision with minimal required args (omitting --context, --options, --confidence, --reasoning)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'build',
      '--type', 'flavor-selection',
      '--selected', 'fast-path',
    ]);

    expect(errorSpy).not.toHaveBeenCalled();
    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    // Defaults
    expect(output.context).toEqual({});
    expect(output.options).toEqual([]);
    expect(output.confidence).toBe(1.0);
    expect(output.reasoning).toBe('');
    expect(output.selection).toBe('fast-path');
  });

  it('defaults --confidence to 1.0 when omitted (no gate created)', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'gap-assessment',
      '--selected', 'proceed',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.confidence).toBe(1.0);
    expect(output.lowConfidenceGateCreated).toBeUndefined();

    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeUndefined();
  });

  it('still validates --context JSON when the flag is provided', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'plan',
      '--type', 'flavor-selection',
      '--context', 'not-valid-json',
      '--selected', 'a',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('context'));
  });

  it('auto-populates katakaId from run.json when --kataka is not provided', async () => {
    const katakaId = randomUUID();
    const run = makeRun({ katakaId });
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--selected', 'technical-research',
      '--confidence', '0.9',
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.katakaId).toBe(katakaId);
  });

  it('explicit --kataka flag overrides katakaId from run.json', async () => {
    const runKatakaId = randomUUID();
    const explicitKatakaId = randomUUID();
    const run = makeRun({ katakaId: runKatakaId });
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--selected', 'technical-research',
      '--confidence', '0.9',
      '--kataka', explicitKatakaId,
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.katakaId).toBe(explicitKatakaId);
  });

  it('leaves katakaId undefined when run.json has no katakaId and --kataka is not provided', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--selected', 'technical-research',
      '--confidence', '0.9',
    ]);

    const decisionsPath = join(runsDir, run.id, 'decisions.jsonl');
    const entries = JsonlStore.readAll(decisionsPath, DecisionEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.katakaId).toBeUndefined();
  });

  it('does not create a second gate when pendingGate already exists', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    // First low-confidence decision creates a gate
    const program1 = createProgram();
    await program1.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a"]',
      '--selected', 'a',
      '--confidence', '0.3',
      '--reasoning', 'First low confidence',
    ]);
    consoleSpy.mockClear();

    // Second low-confidence decision should NOT overwrite the existing gate
    const program2 = createProgram();
    await program2.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', run.id,
      '--stage', 'research',
      '--type', 'capability-analysis',
      '--context', '{}',
      '--options', '["b"]',
      '--selected', 'b',
      '--confidence', '0.4',
      '--reasoning', 'Second low confidence',
    ]);

    const output = JSON.parse(consoleSpy.mock.calls[0]![0] as string);
    expect(output.lowConfidenceGateCreated).toBeUndefined(); // guard: no second gate

    // Only one gate should exist
    const stageState = readStageState(runsDir, run.id, 'research');
    expect(stageState.pendingGate).toBeDefined();
    expect(stageState.approvedGates).toHaveLength(0);
  });
});

describe('registerDecisionCommands — decision update', () => {
  let baseDir: string;
  let kataDir: string;
  let runsDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = tempBase();
    kataDir = join(baseDir, '.kata');
    runsDir = join(kataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
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
    registerDecisionCommands(program);
    return program;
  }

  async function recordDecision(runId: string): Promise<string> {
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'record', runId,
      '--stage', 'research',
      '--type', 'flavor-selection',
      '--context', '{}',
      '--options', '["a","b"]',
      '--selected', 'a',
      '--confidence', '0.8',
      '--reasoning', 'Test reasoning',
    ]);
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    consoleSpy.mockClear();
    return (JSON.parse(output) as { id: string }).id;
  }

  it('appends outcome to decision-outcomes.jsonl', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    const decisionId = await recordDecision(run.id);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'update', run.id, decisionId,
      '--outcome', 'good',
      '--notes', 'Worked perfectly',
    ]);

    const outcomesPath = join(runsDir, run.id, 'decision-outcomes.jsonl');
    const entries = JsonlStore.readAll(outcomesPath, DecisionOutcomeEntrySchema);
    expect(entries).toHaveLength(1);
    expect(entries[0].decisionId).toBe(decisionId);
    expect(entries[0].outcome).toBe('good');
    expect(entries[0].notes).toBe('Worked perfectly');
    expect(entries[0].updatedAt).toBeDefined();
  });

  it('outputs JSON with --json flag', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    const decisionId = await recordDecision(run.id);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'update', run.id, decisionId,
      '--outcome', 'partial',
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.outcome).toBe('partial');
    expect(parsed.decisionId).toBe(decisionId);
  });

  it('errors when decision ID does not exist', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'update', run.id, randomUUID(),
      '--outcome', 'good',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('errors on invalid outcome value', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    const decisionId = await recordDecision(run.id);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'update', run.id, decisionId,
      '--outcome', 'excellent',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid outcome'));
  });
});

describe('registerDecisionCommands — decision list', () => {
  let baseDir: string;
  let kataDir: string;
  let runsDir: string;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    baseDir = tempBase();
    kataDir = join(baseDir, '.kata');
    runsDir = join(kataDir, 'runs');
    mkdirSync(runsDir, { recursive: true });
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
    registerDecisionCommands(program);
    return program;
  }

  function makeDecisionEntry(overrides: Partial<DecisionEntry> = {}): DecisionEntry {
    return {
      id: randomUUID(),
      stageCategory: 'research',
      flavor: null,
      step: null,
      decisionType: 'flavor-selection',
      context: {},
      options: ['a', 'b'],
      selection: 'a',
      reasoning: 'Best fit',
      confidence: 0.9,
      decidedAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it('lists decisions for a single run via --run', async () => {
    const run = makeRun();
    createRunTree(runsDir, run);
    const paths = runPaths(runsDir, run.id);

    const entry = makeDecisionEntry();
    JsonlStore.append(paths.decisionsJsonl, entry, DecisionEntrySchema);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'list', '--run', run.id,
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Array<{ id: string; runId: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(entry.id);
    expect(parsed[0].runId).toBe(run.id);
  });

  it('lists decisions across all runs in a cycle via --cycle', async () => {
    const cycleId = randomUUID();
    const run1 = makeRun({ cycleId });
    const run2 = makeRun({ cycleId });
    createRunTree(runsDir, run1);
    createRunTree(runsDir, run2);

    const d1 = makeDecisionEntry({ decisionType: 'flavor-selection' });
    const d2 = makeDecisionEntry({ decisionType: 'execution-mode' });

    JsonlStore.append(runPaths(runsDir, run1.id).decisionsJsonl, d1, DecisionEntrySchema);
    JsonlStore.append(runPaths(runsDir, run2.id).decisionsJsonl, d2, DecisionEntrySchema);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'list', '--cycle', cycleId,
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Array<{ id: string; runId: string }>;
    expect(parsed).toHaveLength(2);
    const ids = parsed.map((d) => d.id);
    expect(ids).toContain(d1.id);
    expect(ids).toContain(d2.id);
  });

  it('filters by --type when --cycle is provided', async () => {
    const cycleId = randomUUID();
    const run = makeRun({ cycleId });
    createRunTree(runsDir, run);

    const d1 = makeDecisionEntry({ decisionType: 'flavor-selection' });
    const d2 = makeDecisionEntry({ decisionType: 'execution-mode' });
    const paths = runPaths(runsDir, run.id);
    JsonlStore.append(paths.decisionsJsonl, d1, DecisionEntrySchema);
    JsonlStore.append(paths.decisionsJsonl, d2, DecisionEntrySchema);

    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--json', '--cwd', baseDir,
      'decision', 'list', '--cycle', cycleId, '--type', 'flavor-selection',
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(output) as Array<{ decisionType: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0].decisionType).toBe('flavor-selection');
  });

  it('shows empty message when no runs exist for cycle', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'list', '--cycle', randomUUID(),
    ]);

    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toContain('No runs found');
  });

  it('errors when neither --run nor --cycle is provided', async () => {
    const program = createProgram();
    await program.parseAsync([
      'node', 'test', '--cwd', baseDir,
      'decision', 'list',
    ]);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--run'));
  });
});
