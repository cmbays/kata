export default {
  threshold: 8,
  coverageMetric: 'line',
  include: ['src/**/*.ts', 'src/**/*.tsx'],
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
    'src/**/*.steps.ts',
    'src/acceptance/**',
    'src/cli/index.ts',
    'src/**/index.ts',
    'dist/**',
    'coverage/**',
    'node_modules/**',
  ],
  thresholds: {
    'src/cli/**': 20,
  },
};
