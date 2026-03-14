#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const ref = process.argv[2] ?? 'origin/main';

const diff = spawnSync('git', ['diff', '--name-only', ref, '--'], {
  encoding: 'utf-8',
});

if (diff.status !== 0) {
  process.stderr.write(diff.stderr || `git diff failed for ref ${ref}\n`);
  process.exit(diff.status ?? 1);
}

const changedFiles = diff.stdout
  .split('\n')
  .map((file) => file.trim())
  .filter(Boolean)
  .filter((file) => /^src\/.*\.(ts|tsx)$/.test(file))
  .filter((file) => !/\.test\.tsx?$/.test(file))
  .filter((file) => !/\.steps\.ts$/.test(file))
  .filter((file) => !file.startsWith('src/acceptance/'))
  .filter((file) => !file.endsWith('/index.ts'))
  .filter((file) => file !== 'src/cli/index.ts');

if (changedFiles.length === 0) {
  console.log(`No changed production TypeScript files to analyze against ${ref}.`);
  process.exit(0);
}

const crapArgs = [
  '--import',
  'tsx',
  './node_modules/crap4ts/src/cli/cli.ts',
  '--strict',
  '--include',
  ...changedFiles,
];

const result = spawnSync('node', crapArgs, {
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
