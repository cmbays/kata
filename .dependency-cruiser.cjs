const fs = require('node:fs');
const path = require('node:path');

function findDependencyCruiserConfig(startDir) {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, 'node_modules', 'dependency-cruiser', 'configs', 'recommended-strict.cjs');

    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error('Could not locate dependency-cruiser recommended config');
    }

    currentDir = parentDir;
  }
}

const recommended = require(findDependencyCruiserConfig(__dirname));
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
