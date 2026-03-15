import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';
import layerPolicy from './tooling/layer-policy.cjs';

const { boundaryElements, boundaryRules } = layerPolicy;

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
