const sourcePathExclusion = '\\.(test|steps)\\.[cm]?[jt]sx?$';

const boundaryElements = [
  { type: 'domain', pattern: 'src/domain/**/*' },
  { type: 'infrastructure', pattern: 'src/infrastructure/**/*' },
  { type: 'features', pattern: 'src/features/**/*' },
  { type: 'shared', pattern: 'src/shared/**/*' },
  { type: 'cli', pattern: 'src/cli/**/*' },
];

const boundaryRules = [
  { from: 'domain', allow: ['domain', 'shared'] },
  { from: 'infrastructure', allow: ['domain', 'infrastructure', 'shared'] },
  { from: 'features', allow: ['domain', 'infrastructure', 'features', 'shared'] },
  { from: 'shared', allow: ['domain', 'infrastructure', 'shared'] },
  { from: 'cli', allow: ['cli', 'domain', 'infrastructure', 'features', 'shared'] },
];

const dependencyCruiserForbidden = [
  {
    name: 'domain-no-outward-imports',
    comment: 'Domain code should not depend on infrastructure, features, or CLI modules.',
    severity: 'error',
    from: {
      path: '^src/domain/',
      pathNot: sourcePathExclusion,
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
      pathNot: sourcePathExclusion,
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
      pathNot: sourcePathExclusion,
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
      pathNot: sourcePathExclusion,
    },
    to: {
      path: '^src/(features|cli)/',
    },
  },
];

module.exports = {
  boundaryElements,
  boundaryRules,
  dependencyCruiserForbidden,
};
