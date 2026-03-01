import { Command } from 'commander';
import { registerLexiconCommand } from './lexicon.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runLexicon(args: string[]): Promise<{ stdout: string; stderr: string }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => stdout.push(a.map(String).join(' '));
  console.error = (...a: unknown[]) => stderr.push(a.map(String).join(' '));
  try {
    const program = new Command();
    program
      .option('--json')
      .option('--plain')
      .option('--cwd <path>')
      .exitOverride();
    registerLexiconCommand(program);
    await program.parseAsync(['node', 'kata', ...args]);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerLexiconCommand', () => {
  it('registers lexicon and kotoba commands', () => {
    const program = new Command();
    program.option('--json').option('--plain');
    registerLexiconCommand(program);
    const names = program.commands.flatMap((c) => [c.name(), ...c.aliases()]);
    expect(names).toContain('lexicon');
    expect(names).toContain('kotoba');
  });

  it('renders table with domain, CLI, alias, description columns', async () => {
    const { stdout } = await runLexicon(['lexicon']);
    expect(stdout).toContain('Domain');
    expect(stdout).toContain('CLI Command');
    expect(stdout).toContain('Alias');
    expect(stdout).toContain('Description');
  });

  it('includes core vocabulary entries', async () => {
    const { stdout } = await runLexicon(['lexicon']);
    expect(stdout).toContain('kata stage');
    expect(stdout).toContain('kata kiai');
    expect(stdout).toContain('kata kotoba');
    expect(stdout).toContain('kataka');
  });

  it('outputs JSON when --json is set', async () => {
    const { stdout } = await runLexicon(['--json', 'lexicon']);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty('domain');
    expect(parsed[0]).toHaveProperty('cli');
    expect(parsed[0]).toHaveProperty('alias');
    expect(parsed[0]).toHaveProperty('description');
  });

  it('responds to kotoba alias', async () => {
    const { stdout } = await runLexicon(['kotoba']);
    expect(stdout).toContain('kata kiai');
  });

  it('shows plain header (no kotoba suffix) when --plain is set', async () => {
    const { stdout } = await runLexicon(['--plain', 'lexicon']);
    expect(stdout).toContain('Kata Vocabulary');
    // Plain mode omits the "(kotoba)" suffix in the title
    expect(stdout.split('\n')[0]).not.toContain('kotoba');
  });

  it('shows thematic header with kotoba suffix by default', async () => {
    const { stdout } = await runLexicon(['lexicon']);
    // First line includes (kotoba) in thematic mode
    expect(stdout.split('\n')[0]).toContain('kotoba');
  });
});
