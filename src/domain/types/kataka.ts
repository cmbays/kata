import { z } from 'zod/v4';

/**
 * The role a kataka (agent) plays within the Kata system.
 *
 * - observer     — records observations during execution
 * - executor     — drives stages and produces artifacts
 * - synthesizer  — synthesizes learnings across runs
 * - reviewer     — reviews artifacts and gates
 */
export const KatakaRoleSchema = z.enum(['observer', 'executor', 'synthesizer', 'reviewer']);
export type KatakaRole = z.infer<typeof KatakaRoleSchema>;

/**
 * A kataka is a named agent persona registered in the Kata system.
 *
 * Kataka become first-class citizens in Wave G: they are discoverable,
 * registered, and observable. Observations recorded during a run can be
 * attributed to the kataka that recorded them via `katakaId`.
 */
export const KatakaSchema = z.object({
  /** UUID for this kataka. */
  id: z.string().uuid(),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** Role this agent plays in the Kata system. */
  role: KatakaRoleSchema,
  /** Skill identifiers this kataka is proficient in (e.g. "TypeScript", "domain-modeling"). */
  skills: z.array(z.string()).default([]),
  /** Optional free-text description of the kataka's purpose. */
  description: z.string().optional(),
  /**
   * Specializations within the role — narrows what this agent focuses on.
   * Examples for executor: ["frontend", "React"], for reviewer: ["security"].
   */
  specializations: z.array(z.string()).optional(),
  /** ISO 8601 timestamp when this kataka was registered. */
  createdAt: z.string().datetime(),
  /** Whether this kataka is currently active. Deactivated kataka remain registered but are excluded from active queries. */
  active: z.boolean().default(true),
});

export type Kataka = z.infer<typeof KatakaSchema>;
