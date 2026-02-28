import { z } from 'zod/v4';

/**
 * A single edge in the bunkai (knowledge) graph — links a learning to an observation.
 *
 * Stored as a flat array in `.kata/knowledge/graph-index.json`.
 * This lightweight index makes the graph traversable without loading every learning file.
 */
export const GraphEdgeSchema = z.object({
  learningId: z.string().uuid(),
  observationId: z.string().uuid(),
  /** Edge type — why these two nodes are linked */
  edgeType: z.enum([
    'citation',       // Learning was created from this observation
    'reinforcement',  // Observation later strengthened the learning
    'derivation',     // Learning was derived/synthesized from another learning
  ]),
  createdAt: z.string().datetime(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

/**
 * The full graph index stored at `.kata/knowledge/graph-index.json`.
 *
 * Each entry in `edges` links a learning to an observation (or to another learning
 * via a derivation edge). The index is append-only in practice — edges are added
 * when learnings are created or reinforced, but never removed.
 */
export const GraphIndexSchema = z.object({
  /** Graph format version for forward-compatibility */
  version: z.number().int().min(1).default(1),
  edges: z.array(GraphEdgeSchema).default([]),
  updatedAt: z.string().datetime(),
});

export type GraphIndex = z.infer<typeof GraphIndexSchema>;
