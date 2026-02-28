import { THEMATIC, PLAIN, getLexicon, cap, pl } from './lexicon.js';

describe('THEMATIC lexicon', () => {
  it('has all required keys', () => {
    const keys: (keyof typeof THEMATIC)[] = [
      'stage', 'step', 'flavor', 'cycle', 'gate', 'entryGate', 'exitGate',
      'decision', 'knowledge', 'cooldown', 'execute', 'dojo', 'config',
      'observation', 'agent', 'artifact',
    ];
    for (const key of keys) {
      expect(THEMATIC[key]).toBeDefined();
      expect(typeof THEMATIC[key]).toBe('string');
    }
  });

  it('uses kansatsu for observation', () => {
    expect(THEMATIC.observation).toBe('kansatsu');
  });

  it('uses kataka for agent', () => {
    expect(THEMATIC.agent).toBe('kataka');
  });

  it('uses maki for artifact', () => {
    expect(THEMATIC.artifact).toBe('maki');
  });
});

describe('PLAIN lexicon', () => {
  it('has all required keys', () => {
    const keys: (keyof typeof PLAIN)[] = [
      'stage', 'step', 'flavor', 'cycle', 'gate', 'entryGate', 'exitGate',
      'decision', 'knowledge', 'cooldown', 'execute', 'dojo', 'config',
      'observation', 'agent', 'artifact',
    ];
    for (const key of keys) {
      expect(PLAIN[key]).toBeDefined();
      expect(typeof PLAIN[key]).toBe('string');
    }
  });

  it('uses plain English for Wave F terms', () => {
    expect(PLAIN.observation).toBe('observation');
    expect(PLAIN.agent).toBe('agent');
    expect(PLAIN.artifact).toBe('artifact');
  });
});

describe('getLexicon', () => {
  it('returns THEMATIC when plain is false', () => {
    expect(getLexicon(false).observation).toBe('kansatsu');
  });

  it('returns THEMATIC when plain is undefined', () => {
    expect(getLexicon().observation).toBe('kansatsu');
  });

  it('returns PLAIN when plain is true', () => {
    expect(getLexicon(true).observation).toBe('observation');
  });
});

describe('cap', () => {
  it('capitalizes space-separated words', () => {
    expect(cap('entry gate')).toBe('Entry Gate');
  });

  it('capitalizes hyphenated terms', () => {
    expect(cap('iri-mon')).toBe('Iri-Mon');
  });
});

describe('pl', () => {
  it('does not pluralize in thematic mode', () => {
    expect(pl('kansatsu', false)).toBe('kansatsu');
  });

  it('pluralizes in plain mode', () => {
    expect(pl('observation', true)).toBe('observations');
  });

  it('skips pluralization when count is 1', () => {
    expect(pl('agent', true, 1)).toBe('agent');
  });

  it('pluralizes when count > 1', () => {
    expect(pl('agent', true, 2)).toBe('agents');
  });
});
