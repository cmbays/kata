import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/index': 'src/cli/index.ts',
    'domain/types/index': 'src/domain/types/index.ts',
  },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
  splitting: true,
  banner: {
    // Add shebang to CLI entry point
    js: (ctx) =>
      ctx.options.entry &&
      Object.keys(ctx.options.entry).some((e) => e.includes('cli'))
        ? '#!/usr/bin/env node'
        : '',
  },
});
