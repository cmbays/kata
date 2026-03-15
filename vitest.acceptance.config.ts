import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';
import { sharedVitestConfig } from './vitest.shared.js';

export default defineConfig({
  ...sharedVitestConfig,
  plugins: [quickpickle()],
  test: {
    ...sharedVitestConfig.test,
    name: 'acceptance',
    include: ['src/**/*.feature'],
    setupFiles: ['./src/acceptance/setup.ts'],
    testTimeout: 10_000,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
