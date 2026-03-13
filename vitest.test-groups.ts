export const integrationTestFiles = [
  'src/cli/integration.test.ts',
  'src/cli/commands/cycle.test.ts',
  'src/features/cycle-management/cooldown-session.test.ts',
  'src/features/cycle-management/cooldown-session-prepare.test.ts',
  'src/infrastructure/execution/session-bridge.test.ts',
];

export const mutationTestFiles = [
  'src/cli/commands/execute.test.ts',
  'src/features/execute/workflow-runner.test.ts',
  'src/features/cycle-management/cooldown-session.test.ts',
  'src/features/cycle-management/cooldown-session-prepare.test.ts',
  'src/infrastructure/execution/session-bridge.test.ts',
  'src/features/kata-agent/kata-agent-confidence-calculator.test.ts',
  'src/features/kata-agent/kata-agent-observability-aggregator.test.ts',
];

export const e2eTestPatterns = [
  'tests/e2e/**/*.e2e.test.ts',
];
