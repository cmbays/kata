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
    expect(commandNames).toContain('begin');
    expect(commandNames).toContain('form');
    expect(commandNames).toContain('sequence');
    expect(commandNames).toContain('practice');
    expect(commandNames).toContain('memory');
    expect(commandNames).toContain('reflect');
    expect(commandNames).toContain('focus');
  });

  it('form has list and inspect subcommands', () => {
    const program = createProgram();
    const form = program.commands.find((c) => c.name() === 'form');
    const subcommands = form!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('sequence has start, status, and define subcommands', () => {
    const program = createProgram();
    const sequence = program.commands.find((c) => c.name() === 'sequence');
    const subcommands = sequence!.commands.map((c) => c.name());
    expect(subcommands).toContain('start');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('define');
  });

  it('practice has new, status, and focus subcommands', () => {
    const program = createProgram();
    const practice = program.commands.find((c) => c.name() === 'practice');
    const subcommands = practice!.commands.map((c) => c.name());
    expect(subcommands).toContain('new');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('focus');
  });

  it('memory has query and stats subcommands', () => {
    const program = createProgram();
    const memory = program.commands.find((c) => c.name() === 'memory');
    const subcommands = memory!.commands.map((c) => c.name());
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
});
