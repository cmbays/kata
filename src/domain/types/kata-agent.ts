import { z } from 'zod/v4';

/**
 * The role a kata agent plays within the Kata system.
 *
 * - observer     — records observations during execution
 * - executor     — drives stages and produces artifacts
 * - synthesizer  — synthesizes learnings across runs
 * - reviewer     — reviews artifacts and gates
 */
export const KataAgentRoleSchema = z.enum(['observer', 'executor', 'synthesizer', 'reviewer']);
export type KataAgentRole = z.infer<typeof KataAgentRoleSchema>;

/**
 * A registered kata agent persona.
 *
 * "kataka" remains the themed alias in the CLI and docs, but the canonical
 * code model stays in plain English.
 */
export const KataAgentSchema = z.object({
  /** UUID for this agent. */
  id: z.string().uuid(),
  /** Human-readable display name. */
  name: z.string().min(1),
  /** Role this agent plays in the Kata system. */
  role: KataAgentRoleSchema,
  /** Skill identifiers this agent is proficient in (e.g. "TypeScript", "domain-modeling"). */
  skills: z.array(z.string()).default([]),
  /** Optional free-text description of the agent's purpose. */
  description: z.string().optional(),
  /**
   * Specializations within the role — narrows what this agent focuses on.
   * Examples for executor: ["frontend", "React"], for reviewer: ["security"].
   */
  specializations: z.array(z.string()).optional(),
  /** ISO 8601 timestamp when this agent was registered. */
  createdAt: z.string().datetime(),
  /** Whether this agent is currently active. */
  active: z.boolean().default(true),
});

export type KataAgent = z.infer<typeof KataAgentSchema>;
