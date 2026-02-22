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
    expect(commandNames).toContain('rei');
    expect(commandNames).toContain('form');
    expect(commandNames).toContain('flow');
    expect(commandNames).toContain('enbu');
    expect(commandNames).toContain('bunkai');
    expect(commandNames).toContain('ma');
    expect(commandNames).toContain('kiai');
  });

  it('form has list and inspect subcommands', () => {
    const program = createProgram();
    const form = program.commands.find((c) => c.name() === 'form');
    const subcommands = form!.commands.map((c) => c.name());
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('flow has start, status, and prep subcommands', () => {
    const program = createProgram();
    const flow = program.commands.find((c) => c.name() === 'flow');
    const subcommands = flow!.commands.map((c) => c.name());
    expect(subcommands).toContain('start');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('prep');
  });

  it('enbu has new, status, and focus subcommands', () => {
    const program = createProgram();
    const enbu = program.commands.find((c) => c.name() === 'enbu');
    const subcommands = enbu!.commands.map((c) => c.name());
    expect(subcommands).toContain('new');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('focus');
  });

  it('bunkai has query and stats subcommands', () => {
    const program = createProgram();
    const bunkai = program.commands.find((c) => c.name() === 'bunkai');
    const subcommands = bunkai!.commands.map((c) => c.name());
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
