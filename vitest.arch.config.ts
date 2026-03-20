import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tooling/**/*.test.ts'],
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@infra': resolve('src/infrastructure'),
      '@features': resolve('src/features'),
      '@shared': resolve('src/shared'),
      '@cli': resolve('src/cli'),
    },
  },
});
