import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

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

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': boundaryElements,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: boundaryRules,
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'coverage/', 'node_modules/', 'stages/', 'templates/'],
  },
);
