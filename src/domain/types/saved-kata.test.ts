import { FlavorHintSchema, SavedKataSchema } from './saved-kata.js';

describe('FlavorHintSchema', () => {
  it('parses valid hint with explicit strategy', () => {
    const result = FlavorHintSchema.parse({
      recommended: ['bugfix-ts', 'bugfix-python'],
      strategy: 'restrict',
    });
    expect(result.recommended).toEqual(['bugfix-ts', 'bugfix-python']);
    expect(result.strategy).toBe('restrict');
  });

  it('defaults strategy to "prefer"', () => {
    const result = FlavorHintSchema.parse({
      recommended: ['bugfix-ts'],
    });
    expect(result.strategy).toBe('prefer');
  });

  it('rejects empty recommended array', () => {
    expect(() => FlavorHintSchema.parse({ recommended: [] })).toThrow();
  });

  it('rejects recommended with empty string', () => {
    expect(() => FlavorHintSchema.parse({ recommended: [''] })).toThrow();
  });

  it('rejects invalid strategy', () => {
    expect(() =>
      FlavorHintSchema.parse({ recommended: ['a'], strategy: 'force' }),
    ).toThrow();
  });
});

describe('SavedKataSchema', () => {
  it('parses without flavorHints (backward compat)', () => {
    const result = SavedKataSchema.parse({
      name: 'bug-fix',
      stages: ['build', 'review'],
    });
    expect(result.flavorHints).toBeUndefined();
    expect(result.stages).toEqual(['build', 'review']);
  });

  it('parses with flavorHints', () => {
    const result = SavedKataSchema.parse({
      name: 'bug-fix',
      description: 'Bug fix workflow',
      stages: ['build', 'review'],
      flavorHints: {
        build: {
          recommended: ['bugfix-ts', 'bugfix-python'],
          strategy: 'prefer',
        },
        review: {
          recommended: ['bugfix-verify'],
          strategy: 'restrict',
        },
      },
    });
    expect(result.flavorHints).toBeDefined();
    expect(result.flavorHints!.build!.recommended).toEqual(['bugfix-ts', 'bugfix-python']);
    expect(result.flavorHints!.build!.strategy).toBe('prefer');
    expect(result.flavorHints!.review!.strategy).toBe('restrict');
  });

  it('allows flavorHints for only some stages', () => {
    const result = SavedKataSchema.parse({
      name: 'partial',
      stages: ['research', 'build'],
      flavorHints: {
        build: { recommended: ['tdd-build'] },
      },
    });
    expect(result.flavorHints!.build).toBeDefined();
    expect(result.flavorHints!.research).toBeUndefined();
  });

  it('rejects flavorHints with invalid stage category key', () => {
    expect(() =>
      SavedKataSchema.parse({
        name: 'bad',
        stages: ['build'],
        flavorHints: {
          deploy: { recommended: ['foo'] },
        },
      }),
    ).toThrow();
  });

  it('rejects flavorHints where recommended is empty', () => {
    expect(() =>
      SavedKataSchema.parse({
        name: 'bad',
        stages: ['build'],
        flavorHints: {
          build: { recommended: [] },
        },
      }),
    ).toThrow();
  });

  it('defaults strategy in flavorHints to prefer', () => {
    const result = SavedKataSchema.parse({
      name: 'default-strat',
      stages: ['build'],
      flavorHints: {
        build: { recommended: ['my-flavor'] },
      },
    });
    expect(result.flavorHints!.build!.strategy).toBe('prefer');
  });
});
