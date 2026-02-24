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
    expect(commandNames).toContain('step');
    expect(commandNames).toContain('flavor');
    expect(commandNames).toContain('cycle');
    expect(commandNames).toContain('knowledge');
    expect(commandNames).toContain('cooldown');
    expect(commandNames).toContain('execute');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('stats');
  });

  it('stage has list and inspect subcommands', () => {
    const program = createProgram();
    const stage = program.commands.find((c) => c.name() === 'stage');
    const subcommands = stage!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('step has list, inspect, create, edit, delete, and rename subcommands', () => {
    const program = createProgram();
    const step = program.commands.find((c) => c.name() === 'step');
    const subcommands = step!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
    expect(subcommands).toContain('create');
    expect(subcommands).toContain('edit');
    expect(subcommands).toContain('delete');
    expect(subcommands).toContain('rename');
  });

  it('flavor has list, inspect, create, delete, and validate subcommands', () => {
    const program = createProgram();
    const flavor = program.commands.find((c) => c.name() === 'flavor');
    const subcommands = flavor!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
    expect(subcommands).toContain('create');
    expect(subcommands).toContain('delete');
    expect(subcommands).toContain('validate');
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

  it('execute has status and stats subcommands', () => {
    const program = createProgram();
    const execute = program.commands.find((c) => c.name() === 'execute');
    const subcommands = execute!.commands.map((c) => c.name());
    expect(subcommands).toContain('status');
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

    it('stage has alias "gyo"', () => {
      const program = createProgram();
      const stage = program.commands.find((c) => c.name() === 'stage');
      expect(stage!.alias()).toBe('gyo');
    });

    it('step has alias "waza"', () => {
      const program = createProgram();
      const step = program.commands.find((c) => c.name() === 'step');
      expect(step!.alias()).toBe('waza');
    });

    it('flavor has alias "ryu"', () => {
      const program = createProgram();
      const flavor = program.commands.find((c) => c.name() === 'flavor');
      expect(flavor!.alias()).toBe('ryu');
    });

    it('cycle has alias "keiko"', () => {
      const program = createProgram();
      const cycle = program.commands.find((c) => c.name() === 'cycle');
      expect(cycle!.alias()).toBe('keiko');
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
