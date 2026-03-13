import { randomUUID } from 'node:crypto';
import { KataAgentSchema, KataAgentRoleSchema } from './kata-agent.js';

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

describe('KataAgentRoleSchema', () => {
  it('accepts all valid roles', () => {
    for (const role of ['observer', 'executor', 'synthesizer', 'reviewer']) {
      expect(() => KataAgentRoleSchema.parse(role)).not.toThrow();
    }
  });

  it('rejects unknown roles', () => {
    expect(() => KataAgentRoleSchema.parse('dancer')).toThrow();
  });
});

describe('KataAgentSchema', () => {
  it('parses a fully specified kataka', () => {
    const k = KataAgentSchema.parse(makeKataka({
      description: 'Drives builds',
      specializations: ['frontend'],
    }));
    expect(k.name).toBe('Sensei');
    expect(k.role).toBe('executor');
    expect(k.specializations).toEqual(['frontend']);
  });

  it('defaults active to true', () => {
    const k = KataAgentSchema.parse(makeKataka({ active: undefined }));
    expect(k.active).toBe(true);
  });

  it('defaults skills to empty array', () => {
    const k = KataAgentSchema.parse(makeKataka({ skills: undefined }));
    expect(k.skills).toEqual([]);
  });

  it('allows optional fields to be absent', () => {
    const k = KataAgentSchema.parse(makeKataka());
    expect(k.description).toBeUndefined();
    expect(k.specializations).toBeUndefined();
  });

  it('rejects missing id', () => {
    expect(() => KataAgentSchema.parse(makeKataka({ id: undefined }))).toThrow();
  });

  it('rejects invalid uuid for id', () => {
    expect(() => KataAgentSchema.parse(makeKataka({ id: 'not-a-uuid' }))).toThrow();
  });

  it('rejects empty name', () => {
    expect(() => KataAgentSchema.parse(makeKataka({ name: '' }))).toThrow();
  });

  it('rejects invalid role', () => {
    expect(() => KataAgentSchema.parse(makeKataka({ role: 'jester' }))).toThrow();
  });

  it('rejects invalid datetime for createdAt', () => {
    expect(() => KataAgentSchema.parse(makeKataka({ createdAt: 'not-a-date' }))).toThrow();
  });
});
