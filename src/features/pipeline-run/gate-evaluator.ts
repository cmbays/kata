import { spawnSync } from 'node:child_process';
import type { Gate, GateCondition, GateResult } from '@domain/types/gate.js';

/**
 * Context provided to the gate evaluator for checking conditions.
 */
export interface GateEvalContext {
  /** Artifacts available from previous stage completions */
  availableArtifacts: string[];
  /** Completed stage types in this pipeline */
  completedStages: string[];
  /** Whether a human has approved (for human-approved gates) */
  humanApproved?: boolean;
}

/**
 * Result of evaluating a single gate condition.
 */
export interface ConditionResult {
  condition: GateCondition;
  passed: boolean;
  detail?: string;
}

/**
 * Evaluate all conditions in a gate against the given context.
 *
 * Rules:
 * - `artifact-exists`: passes if `condition.artifactName` is in `context.availableArtifacts`
 * - `predecessor-complete`: passes if `condition.predecessorType` is in `context.completedStages`
 * - `human-approved`: passes if `context.humanApproved` is true (defaults to false)
 * - `schema-valid`: always passes (validation happens at capture time)
 *
 * The gate passes if:
 * - `gate.required` is false (non-required gates always pass), OR
 * - ALL conditions pass
 */
export async function evaluateGate(gate: Gate, context: GateEvalContext): Promise<GateResult> {
  const results: ConditionResult[] = gate.conditions.map((condition) =>
    evaluateCondition(condition, context),
  );

  const allConditionsPassed = results.every((r) => r.passed);

  // Non-required gates always pass overall, but individual condition results are still reported
  const passed = !gate.required || allConditionsPassed;

  return {
    gate,
    passed,
    results: results.map((r) => ({
      condition: r.condition,
      passed: r.passed,
      detail: r.detail,
    })),
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Evaluate a single gate condition against the context.
 */
function evaluateCondition(condition: GateCondition, context: GateEvalContext): ConditionResult {
  switch (condition.type) {
    case 'artifact-exists': {
      if (!condition.artifactName) {
        return {
          condition,
          passed: false,
          detail: 'artifact-exists condition missing artifactName',
        };
      }
      const found = context.availableArtifacts.includes(condition.artifactName);
      return {
        condition,
        passed: found,
        detail: found
          ? `Artifact "${condition.artifactName}" is available`
          : `Artifact "${condition.artifactName}" not found in available artifacts`,
      };
    }

    case 'predecessor-complete': {
      if (!condition.predecessorType) {
        return {
          condition,
          passed: false,
          detail: 'predecessor-complete condition missing predecessorType',
        };
      }
      const done = context.completedStages.includes(condition.predecessorType);
      return {
        condition,
        passed: done,
        detail: done
          ? `Predecessor "${condition.predecessorType}" is complete`
          : `Predecessor "${condition.predecessorType}" has not been completed`,
      };
    }

    case 'human-approved': {
      const approved = context.humanApproved === true;
      return {
        condition,
        passed: approved,
        detail: approved
          ? 'Human approval granted'
          : 'Human approval not yet granted',
      };
    }

    case 'schema-valid': {
      // Schema validation is deferred to capture time — always passes at gate evaluation
      return {
        condition,
        passed: true,
        detail: 'Schema validation deferred to capture time',
      };
    }

    case 'command-passes': {
      if (!condition.command) {
        return {
          condition,
          passed: false,
          detail: 'command-passes condition missing command string',
        };
      }
      const proc = spawnSync(condition.command, { shell: true, encoding: 'utf8', timeout: 30_000 });
      if (proc.error) {
        throw new Error(
          `command-passes: failed to spawn shell for "${condition.command}": ${proc.error.message}`,
        );
      }
      if (proc.status === 0) {
        return { condition, passed: true, detail: `Command exited 0` };
      }
      const MAX_OUTPUT = 500;
      const truncate = (s: string) =>
        s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '... (truncated)' : s;
      const stderr = truncate(proc.stderr ?? '');
      const stdout = truncate(proc.stdout ?? '');
      const output = [stderr, stdout].filter(Boolean).join(' | ');
      const exitDescription =
        proc.status !== null
          ? `exited ${proc.status}`
          : proc.signal
            ? `killed by signal ${proc.signal}`
            : 'exited with null status';
      return {
        condition,
        passed: false,
        detail: `Command ${exitDescription}${output ? `: ${output}` : ''}`,
      };
    }

    default: {
      const _exhaustive: never = condition.type;
      return {
        condition,
        passed: false,
        detail: `Unknown condition type: ${_exhaustive}`,
      };
    }
  }
}
