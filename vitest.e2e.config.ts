import { defineConfig } from 'vitest/config';
import { e2eTestPatterns } from './vitest.test-groups.js';
import { sharedVitestConfig } from './vitest.shared.js';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    name: 'e2e',
    include: e2eTestPatterns,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
