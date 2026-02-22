import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'domain/types/index': 'src/domain/types/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'node20',
    splitting: true,
  },
]);
