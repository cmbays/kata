import { describe, it, expect } from 'vitest';
import { ArtifactSchema, ArtifactResultSchema } from './artifact.js';

describe('ArtifactSchema', () => {
  it('parses minimal artifact', () => {
    const result = ArtifactSchema.parse({ name: 'shaping-doc' });
    expect(result.name).toBe('shaping-doc');
    expect(result.required).toBe(true);
  });

  it('parses full artifact', () => {
    const result = ArtifactSchema.parse({
      name: 'breadboard',
      description: 'Affordance tables and wiring',
      schema: 'breadboard.schema.json',
      required: false,
      extension: '.md',
    });
    expect(result.schema).toBe('breadboard.schema.json');
    expect(result.required).toBe(false);
    expect(result.extension).toBe('.md');
  });

  it('rejects empty name', () => {
    expect(() => ArtifactSchema.parse({ name: '' })).toThrow();
  });
});

describe('ArtifactResultSchema', () => {
  it('parses artifact result with path', () => {
    const now = new Date().toISOString();
    const result = ArtifactResultSchema.parse({
      name: 'shaping-doc',
      path: '.kata/artifacts/shaping.md',
      producedAt: now,
      valid: true,
    });
    expect(result.path).toBe('.kata/artifacts/shaping.md');
    expect(result.valid).toBe(true);
  });

  it('parses artifact result without optional fields', () => {
    const now = new Date().toISOString();
    const result = ArtifactResultSchema.parse({
      name: 'notes',
      producedAt: now,
    });
    expect(result.path).toBeUndefined();
    expect(result.valid).toBeUndefined();
  });

  it('rejects invalid datetime', () => {
    expect(() =>
      ArtifactResultSchema.parse({ name: 'x', producedAt: 'invalid' })
    ).toThrow();
  });
});
