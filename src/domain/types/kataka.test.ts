import { randomUUID } from 'node:crypto';
import { KatakaSchema, KatakaRoleSchema } from './kataka.js';

function makeKataka(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    name: 'Sensei',
    role: 'executor',
    skills: ['TypeScript'],
    createdAt: '2026-01-01T00:00:00.000Z',
    active: true,
    ...overrides,
  };
}

describe('KatakaRoleSchema', () => {
  it('accepts all valid roles', () => {
    for (const role of ['observer', 'executor', 'synthesizer', 'reviewer']) {
      expect(() => KatakaRoleSchema.parse(role)).not.toThrow();
    }
  });

  it('rejects unknown roles', () => {
    expect(() => KatakaRoleSchema.parse('dancer')).toThrow();
  });
});

describe('KatakaSchema', () => {
  it('parses a fully specified kataka', () => {
    const k = KatakaSchema.parse(makeKataka({
      description: 'Drives builds',
      specializations: ['frontend'],
    }));
    expect(k.name).toBe('Sensei');
    expect(k.role).toBe('executor');
    expect(k.specializations).toEqual(['frontend']);
  });

  it('defaults active to true', () => {
    const k = KatakaSchema.parse(makeKataka({ active: undefined }));
    expect(k.active).toBe(true);
  });

  it('defaults skills to empty array', () => {
    const k = KatakaSchema.parse(makeKataka({ skills: undefined }));
    expect(k.skills).toEqual([]);
  });

  it('allows optional fields to be absent', () => {
    const k = KatakaSchema.parse(makeKataka());
    expect(k.description).toBeUndefined();
    expect(k.specializations).toBeUndefined();
  });

  it('rejects missing id', () => {
    expect(() => KatakaSchema.parse(makeKataka({ id: undefined }))).toThrow();
  });

  it('rejects invalid uuid for id', () => {
    expect(() => KatakaSchema.parse(makeKataka({ id: 'not-a-uuid' }))).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => KatakaSchema.parse(makeKataka({ name: '' }))).toThrow();
  });

  it('rejects invalid role', () => {
    expect(() => KatakaSchema.parse(makeKataka({ role: 'jester' }))).toThrow();
  });

  it('rejects invalid datetime for createdAt', () => {
    expect(() => KatakaSchema.parse(makeKataka({ createdAt: 'not-a-date' }))).toThrow();
  });
});
