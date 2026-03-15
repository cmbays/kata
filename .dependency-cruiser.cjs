const recommended = require('./node_modules/dependency-cruiser/configs/recommended-strict.cjs');
const { dependencyCruiserForbidden } = require('./tooling/layer-policy.cjs');

const withoutNoOrphans = recommended.forbidden.filter((rule) => rule.name !== 'no-orphans');

module.exports = {
  ...recommended,
  forbidden: [
    ...withoutNoOrphans,
    ...dependencyCruiserForbidden,
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
