import type { GateResult } from '@domain/types/gate.js';

/**
 * Format a gate evaluation result for human-readable display.
 */
export function formatGateResult(result: GateResult): string {
  const lines: string[] = [];

  const gateLabel = result.gate.type === 'entry' ? 'Entry Gate' : 'Exit Gate';
  const requiredLabel = result.gate.required ? 'required' : 'optional';
  const statusLabel = result.passed ? 'PASSED' : 'FAILED';

  lines.push(`${gateLabel} (${requiredLabel}): ${statusLabel}`);

  if (result.results.length === 0) {
    lines.push('  No conditions to evaluate.');
    return lines.join('\n');
  }

  for (const condResult of result.results) {
    const icon = condResult.passed ? '+' : 'x';
    const desc = condResult.condition.description ?? condResult.condition.type;
    lines.push(`  ${icon} [${condResult.condition.type}] ${desc}`);
    if (condResult.detail) {
      lines.push(`    ${condResult.detail}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format a gate evaluation result as JSON.
 */
export function formatGateResultJson(result: GateResult): string {
  return JSON.stringify(
    {
      gateType: result.gate.type,
      required: result.gate.required,
      passed: result.passed,
      evaluatedAt: result.evaluatedAt,
      conditions: result.results.map((r) => ({
        type: r.condition.type,
        description: r.condition.description,
        passed: r.passed,
        detail: r.detail,
      })),
    },
    null,
    2,
  );
}
