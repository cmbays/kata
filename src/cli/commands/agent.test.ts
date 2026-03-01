import { mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { KatakaRegistry } from '@infra/registries/kataka-registry.js';
import { registerAgentCommands } from './agent.js';
import type { Kataka } from '@domain/types/kataka.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKataDir(): string {
  const kataDir = mkdtempSync(join(tmpdir(), 'kata-agent-test-'));
  mkdirSync(join(kataDir, 'kataka'), { recursive: true });
  return kataDir;
}

function makeKataka(overrides: Partial<Kataka> = {}): Kataka {
  return {
    id: randomUUID(),
    name: 'TestAgent',
    role: 'executor',
    skills: ['TypeScript'],
    createdAt: '2026-01-01T00:00:00.000Z',
    active: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// registerAgentCommands
// ---------------------------------------------------------------------------

describe('registerAgentCommands', () => {
  it('registers agent and kataka commands on the program', () => {
    const program = new Command();
    program.option('--json').option('--plain').option('--cwd <path>');
    registerAgentCommands(program);

    const names = program.commands.map((c) => c.name());
    expect(names).toContain('agent');
  });

  it('agent command has kataka alias', () => {
    const program = new Command();
    program.option('--json').option('--plain').option('--cwd <path>');
    registerAgentCommands(program);

    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    expect(agentCmd?.alias()).toBe('kataka');
  });

  it('agent list subcommand exists', () => {
    const program = new Command();
    program.option('--json').option('--plain').option('--cwd <path>');
    registerAgentCommands(program);

    const agentCmd = program.commands.find((c) => c.name() === 'agent');
    const subNames = agentCmd?.commands.map((c) => c.name()) ?? [];
    expect(subNames).toContain('list');
    expect(subNames).toContain('inspect');
    expect(subNames).toContain('register');
  });
});

// ---------------------------------------------------------------------------
// KatakaRegistry integration (via CLI helpers)
// ---------------------------------------------------------------------------

describe('kata agent integration', () => {
  it('registers a kataka and lists it back', () => {
    const kataDir = makeKataDir();
    const registryPath = join(kataDir, 'kataka');
    const registry = new KatakaRegistry(registryPath);

    const k = makeKataka({ name: 'Seki' });
    registry.register(k);

    const list = registry.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('Seki');
  });

  it('only getActive() filters to active kataka', () => {
    const kataDir = makeKataDir();
    const registry = new KatakaRegistry(join(kataDir, 'kataka'));

    registry.register(makeKataka({ name: 'Active', active: true }));
    registry.register(makeKataka({ name: 'Inactive', active: false }));

    expect(registry.getActive()).toHaveLength(1);
    expect(registry.getActive()[0]!.name).toBe('Active');
  });

  it('inspect finds kataka by id', () => {
    const kataDir = makeKataDir();
    const registry = new KatakaRegistry(join(kataDir, 'kataka'));
    const k = makeKataka({ name: 'Mori' });
    registry.register(k);

    const found = registry.get(k.id);
    expect(found.name).toBe('Mori');
  });
});
