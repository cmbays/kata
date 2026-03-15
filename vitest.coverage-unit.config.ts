import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.unit.config.js';

export default defineConfig({
  ...unitConfig,
  test: {
    ...unitConfig.test,
    coverage: {
      ...unitConfig.test?.coverage,
      thresholds: {
        statements: 0,
        branches: 0,
        functions: 0,
        lines: 0,
      },
    },
  },
});
