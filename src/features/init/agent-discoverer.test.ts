import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverAndRegisterAgents } from './agent-discoverer.js';
import { KatakaRegistry } from '@infra/registries/kataka-registry.js';

function makeTempProject(): { cwd: string; kataDir: string } {
  const cwd = mkdtempSync(join(tmpdir(), 'kata-discover-test-'));
  const kataDir = join(cwd, '.kata');
  mkdirSync(kataDir, { recursive: true });
  return { cwd, kataDir };
}

describe('discoverAndRegisterAgents', () => {
  it('returns zero discovered when no agent files exist', () => {
    const { cwd, kataDir } = makeTempProject();
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.discovered).toBe(0);
    expect(result.registered).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it('discovers *.agent.ts files', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'frontend.agent.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.discovered).toBeGreaterThanOrEqual(1);
    expect(result.agents.some((a) => a.name === 'Frontend')).toBe(true);
  });

  it('discovers *.kataka.ts files', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'seki.kataka.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.agents.some((a) => a.name === 'Seki')).toBe(true);
  });

  it('discovers CLAUDE.md agent declarations', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(
      join(cwd, 'CLAUDE.md'),
      '# My Project\n\n## Agent: Sensei\n\nSome content.\n',
    );
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.agents.some((a) => a.name === 'Sensei')).toBe(true);
  });

  it('deduplicates agents with the same name', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'alpha.agent.ts'), '// stub');
    writeFileSync(join(cwd, 'alpha.kataka.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);
    // Should only register once despite two files with the same base name
    const alphas = result.agents.filter((a) => a.name.toLowerCase() === 'alpha');
    expect(alphas).toHaveLength(1);
  });

  it('persists registered agents to the KatakaRegistry', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'mori.agent.ts'), '// stub');
    discoverAndRegisterAgents(cwd, kataDir);

    const registry = new KatakaRegistry(join(kataDir, 'kataka'));
    const list = registry.list();
    expect(list.some((k) => k.name === 'Mori')).toBe(true);
  });

  it('registers agents with role executor', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'builder.agent.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);

    const registry = new KatakaRegistry(join(kataDir, 'kataka'));
    const agent = registry.get(result.agents[0]!.id);
    expect(agent.role).toBe('executor');
  });

  it('ignores node_modules directory', () => {
    const { cwd, kataDir } = makeTempProject();
    const nmDir = join(cwd, 'node_modules', 'some-pkg');
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(join(nmDir, 'helper.agent.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.discovered).toBe(0);
  });

  it('registers multiple distinct agents', () => {
    const { cwd, kataDir } = makeTempProject();
    writeFileSync(join(cwd, 'frontend.agent.ts'), '// stub');
    writeFileSync(join(cwd, 'backend.agent.ts'), '// stub');
    const result = discoverAndRegisterAgents(cwd, kataDir);
    expect(result.registered).toBe(2);
  });
});
