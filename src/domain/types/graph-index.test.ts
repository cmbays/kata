import { randomUUID } from 'node:crypto';
import { GraphEdgeSchema, GraphIndexSchema } from './graph-index.js';

const L_ID = randomUUID();
const O_ID = randomUUID();
const NOW  = '2024-01-01T00:00:00.000Z';

describe('GraphEdgeSchema', () => {
  it('parses a citation edge', () => {
    const edge = GraphEdgeSchema.parse({
      learningId: L_ID,
      observationId: O_ID,
      edgeType: 'citation',
      createdAt: NOW,
    });
    expect(edge.edgeType).toBe('citation');
    expect(edge.learningId).toBe(L_ID);
  });

  it('parses all edge types', () => {
    for (const edgeType of ['citation', 'reinforcement', 'derivation'] as const) {
      const edge = GraphEdgeSchema.parse({
        learningId: L_ID,
        observationId: O_ID,
        edgeType,
        createdAt: NOW,
      });
      expect(edge.edgeType).toBe(edgeType);
    }
  });

  it('rejects invalid UUIDs', () => {
    const result = GraphEdgeSchema.safeParse({
      learningId: 'not-a-uuid',
      observationId: O_ID,
      edgeType: 'citation',
      createdAt: NOW,
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown edge types', () => {
    const result = GraphEdgeSchema.safeParse({
      learningId: L_ID,
      observationId: O_ID,
      edgeType: 'unknown',
      createdAt: NOW,
    });
    expect(result.success).toBe(false);
  });
});

describe('GraphIndexSchema', () => {
  it('parses an empty graph index', () => {
    const idx = GraphIndexSchema.parse({ updatedAt: NOW });
    expect(idx.version).toBe(1);
    expect(idx.edges).toEqual([]);
  });

  it('parses a graph index with edges', () => {
    const idx = GraphIndexSchema.parse({
      version: 1,
      edges: [
        { learningId: L_ID, observationId: O_ID, edgeType: 'citation', createdAt: NOW },
        { learningId: L_ID, observationId: O_ID, edgeType: 'reinforcement', createdAt: NOW },
      ],
      updatedAt: NOW,
    });
    expect(idx.edges).toHaveLength(2);
    expect(idx.edges[0].edgeType).toBe('citation');
    expect(idx.edges[1].edgeType).toBe('reinforcement');
  });

  it('defaults version to 1', () => {
    const idx = GraphIndexSchema.parse({ updatedAt: NOW });
    expect(idx.version).toBe(1);
  });
});
