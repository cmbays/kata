import { z } from 'zod/v4';
import { GateSchema } from './gate.js';
import { ArtifactSchema } from './artifact.js';

export const StageType = z.enum([
  'research',
  'interview',
  'shape',
  'breadboard',
  'plan',
  'build',
  'review',
  'wrap-up',
  'custom',
]);

export type StageType = z.infer<typeof StageType>;

export const StageRefSchema = z.object({
  type: z.string().min(1),
  flavor: z.string().optional(),
});

export type StageRef = z.infer<typeof StageRefSchema>;

export const StageToolSchema = z.object({
  /** Display name for the tool (e.g. "tsc"). Must be non-empty. */
  name: z.string().min(1),
  /** Human-readable explanation of why this tool is relevant. Must be non-empty. */
  purpose: z.string().min(1),
  /**
   * Optional invocation hint shown as an inline code block in the prompt
   * (e.g. "npx tsc --noEmit"). This is a display string for the agent,
   * NOT a shell command executed by the runtime — unlike GateConditionSchema.command.
   */
  command: z.string().optional(),
});

export type StageTool = z.infer<typeof StageToolSchema>;

/**
 * Hint for an agent (spawned via the Task tool) or skill (invoked via the Skill tool).
 * Separate arrays on StageResourcesSchema distinguish the two invocation semantics,
 * even though the hint shape is identical.
 */
export const StageAgentHintSchema = z.object({
  /** Fully-qualified agent or skill name (e.g. "everything-claude-code:build-error-resolver"). Must be non-empty. */
  name: z.string().min(1),
  /** Optional condition under which to invoke (e.g. "when build fails"). */
  when: z.string().optional(),
});

export type StageAgentHint = z.infer<typeof StageAgentHintSchema>;

/**
 * Structured tool/agent/skill hints attached to a stage definition.
 *
 * - `tools`: CLI tools the agent may find useful (shown as inline code hints in the prompt).
 * - `agents`: Sub-agents to spawn via the Task tool under stated conditions.
 * - `skills`: Skills to invoke via the Skill tool under stated conditions.
 *
 * ManifestBuilder serializes these into a "## Suggested Resources" section appended
 * to the stage prompt. Hints are guidance for the executing agent, not hard-wired invocations.
 */
export const StageResourcesSchema = z.object({
  tools: z.array(StageToolSchema).default([]),
  agents: z.array(StageAgentHintSchema).default([]),
  skills: z.array(StageAgentHintSchema).default([]),
});

export type StageResources = z.infer<typeof StageResourcesSchema>;

export const StageSchema = z.object({
  type: z.string().min(1),
  flavor: z.string().optional(),
  description: z.string().optional(),
  entryGate: GateSchema.optional(),
  exitGate: GateSchema.optional(),
  artifacts: z.array(ArtifactSchema).default([]),
  /** $ref path to prompt template .md file */
  promptTemplate: z.string().optional(),
  learningHooks: z.array(z.string()).default([]),
  /** Arbitrary stage-specific configuration */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Structured tool/agent/skill hints serialized into the system prompt */
  resources: StageResourcesSchema.optional(),
});

export type Stage = z.infer<typeof StageSchema>;
