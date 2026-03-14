const recommended = require('./node_modules/dependency-cruiser/configs/recommended-strict.cjs');

const withoutNoOrphans = recommended.forbidden.filter((rule) => rule.name !== 'no-orphans');

module.exports = {
  ...recommended,
  forbidden: [
    ...withoutNoOrphans,
    {
      name: 'domain-no-outward-imports',
      comment: 'Domain code should not depend on infrastructure, features, or CLI modules.',
      severity: 'error',
      from: {
        path: '^src/domain/',
        pathNot: '\\.(test|steps)\\.[cm]?[jt]sx?$',
      },
      to: {
        path: '^src/(infrastructure|features|cli)/',
      },
    },
    {
      name: 'infrastructure-no-features-or-cli',
      comment: 'Infrastructure should not depend on higher-level features or CLI wiring.',
      severity: 'error',
      from: {
        path: '^src/infrastructure/',
        pathNot: '\\.(test|steps)\\.[cm]?[jt]sx?$',
      },
      to: {
        path: '^src/(features|cli)/',
      },
    },
    {
      name: 'features-no-cli',
      comment: 'Features should stay CLI-agnostic.',
      severity: 'error',
      from: {
        path: '^src/features/',
        pathNot: '\\.(test|steps)\\.[cm]?[jt]sx?$',
      },
      to: {
        path: '^src/cli/',
      },
    },
    {
      name: 'shared-no-features-or-cli',
      comment: 'Shared utilities should not reach up into features or CLI modules.',
      severity: 'error',
      from: {
        path: '^src/shared/',
        pathNot: '\\.(test|steps)\\.[cm]?[jt]sx?$',
      },
      to: {
        path: '^src/(features|cli)/',
      },
    },
  ],
  options: {
    ...recommended.options,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
};
