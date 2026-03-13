import { defineConfig } from 'vitest/config';
import { e2eTestPatterns, integrationTestFiles } from './vitest.test-groups.js';
import { sharedVitestConfig } from './vitest.shared.js';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    name: 'unit',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: [...integrationTestFiles, ...e2eTestPatterns],
  },
});
