/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  $schema: './node_modules/@stryker-mutator/core/schema/stryker-schema.json',
  testRunner: 'vitest',
  checkers: ['typescript'],
  ignorePatterns: [
    '/.kata',
    '/dist',
    '/docs-site',
    '/tmp',
  ],
  disableTypeChecks: '{src,test}/**/*.{js,ts,jsx,tsx,cts,mts}',
  mutate: [
    'src/features/execute/workflow-runner.ts',
    'src/infrastructure/execution/session-bridge.ts',
    'src/cli/commands/execute.ts',
    'src/features/cycle-management/bridge-run-syncer.ts',
    'src/features/cycle-management/cooldown-session.ts',
    'src/features/kata-agent/kata-agent-confidence-calculator.ts',
    'src/features/kata-agent/kata-agent-observability-aggregator.ts',
  ],
  vitest: {
    configFile: 'vitest.mutation.config.ts',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'html'],
  thresholds: {
    high: 90,
    low: 80,
    break: 70,
  },
  concurrency: 2,
  incremental: true,
  ignoreStatic: true,
};
