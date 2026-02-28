import { createProgram } from '../program.js';

describe('kata config command', () => {
  it('is registered in the program', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('config');
  });

  it('has alias "seido"', () => {
    const program = createProgram();
    const configCmd = program.commands.find((c) => c.name() === 'config');
    expect(configCmd?.alias()).toBe('seido');
  });

  it('description mentions methodology editor and TUI', () => {
    const program = createProgram();
    const configCmd = program.commands.find((c) => c.name() === 'config');
    const desc = configCmd?.description() ?? '';
    expect(desc).toContain('editor');
    expect(desc).toContain('TUI');
  });
});
