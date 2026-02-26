import { describe, it, expect } from 'vitest';
import { createProgram } from '../program.js';

describe('kata watch command', () => {
  it('is registered in the program', () => {
    const program = createProgram();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain('watch');
  });

  it('has --cycle option', () => {
    const program = createProgram();
    const watchCmd = program.commands.find((c) => c.name() === 'watch');
    expect(watchCmd).toBeDefined();
    const optionLongs = watchCmd!.options.map((o) => o.long);
    expect(optionLongs).toContain('--cycle');
  });

  it('has alias "kanshi"', () => {
    const program = createProgram();
    const watchCmd = program.commands.find((c) => c.name() === 'watch');
    expect(watchCmd?.alias()).toBe('kanshi');
  });

  it('description mentions real-time and TUI', () => {
    const program = createProgram();
    const watchCmd = program.commands.find((c) => c.name() === 'watch');
    const desc = watchCmd?.description() ?? '';
    expect(desc.toLowerCase()).toContain('watch');
  });
});
