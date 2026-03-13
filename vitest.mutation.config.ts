import { defineConfig } from 'vitest/config';
import { mutationTestFiles } from './vitest.test-groups.js';
import { sharedVitestConfig } from './vitest.shared.js';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    name: 'mutation',
    include: mutationTestFiles,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
