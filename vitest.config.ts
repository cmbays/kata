import { defineConfig } from 'vitest/config';
import { e2eTestPatterns } from './vitest.test-groups.js';
import { sharedVitestConfig } from './vitest.shared.js';

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: e2eTestPatterns,
  },
});
