import { describe, it, expect } from 'vitest';
import { createProgram } from './program.js';

describe('createProgram', () => {
  it('creates a commander program with the correct name', () => {
    const program = createProgram();
    expect(program.name()).toBe('kata');
  });

  it('has the expected top-level commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('init');
    expect(commandNames).toContain('stage');
    expect(commandNames).toContain('pipeline');
    expect(commandNames).toContain('cycle');
    expect(commandNames).toContain('knowledge');
    expect(commandNames).toContain('cooldown');
    expect(commandNames).toContain('execute');
  });

  it('stage has list and inspect subcommands', () => {
    const program = createProgram();
    const stage = program.commands.find((c) => c.name() === 'stage');
    const subcommands = stage!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('pipeline has start, status, and prep subcommands', () => {
    const program = createProgram();
    const pipeline = program.commands.find((c) => c.name() === 'pipeline');
    const subcommands = pipeline!.commands.map((c) => c.name());
    expect(subcommands).toContain('start');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('prep');
  });

  it('cycle has new, status, and focus subcommands', () => {
    const program = createProgram();
    const cycle = program.commands.find((c) => c.name() === 'cycle');
    const subcommands = cycle!.commands.map((c) => c.name());
    expect(subcommands).toContain('new');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('focus');
  });

  it('knowledge has query and stats subcommands', () => {
    const program = createProgram();
    const knowledge = program.commands.find((c) => c.name() === 'knowledge');
    const subcommands = knowledge!.commands.map((c) => c.name());
    expect(subcommands).toContain('query');
    expect(subcommands).toContain('stats');
  });

  it('has global --json, --verbose, and --cwd options', () => {
    const program = createProgram();
    const optionNames = program.options.map((o) => o.long);
    expect(optionNames).toContain('--json');
    expect(optionNames).toContain('--verbose');
    expect(optionNames).toContain('--cwd');
  });

  describe('command aliases', () => {
    it('init has alias "rei"', () => {
      const program = createProgram();
      const init = program.commands.find((c) => c.name() === 'init');
      expect(init!.alias()).toBe('rei');
    });

    it('stage has alias "form"', () => {
      const program = createProgram();
      const stage = program.commands.find((c) => c.name() === 'stage');
      expect(stage!.alias()).toBe('form');
    });

    it('pipeline has alias "flow"', () => {
      const program = createProgram();
      const pipeline = program.commands.find((c) => c.name() === 'pipeline');
      expect(pipeline!.alias()).toBe('flow');
    });

    it('cycle has alias "enbu"', () => {
      const program = createProgram();
      const cycle = program.commands.find((c) => c.name() === 'cycle');
      expect(cycle!.alias()).toBe('enbu');
    });

    it('cooldown has alias "ma"', () => {
      const program = createProgram();
      const cooldown = program.commands.find((c) => c.name() === 'cooldown');
      expect(cooldown!.alias()).toBe('ma');
    });

    it('knowledge has alias "bunkai"', () => {
      const program = createProgram();
      const knowledge = program.commands.find((c) => c.name() === 'knowledge');
      expect(knowledge!.alias()).toBe('bunkai');
    });

    it('execute has alias "kiai"', () => {
      const program = createProgram();
      const execute = program.commands.find((c) => c.name() === 'execute');
      expect(execute!.alias()).toBe('kiai');
    });
  });
});
