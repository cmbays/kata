#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const ref = process.argv[2] ?? 'origin/main';

function runGit(args) {
  return spawnSync('git', args, {
    encoding: 'utf-8',
  });
}

function resolveBaseline(refName) {
  const hasRef = runGit(['rev-parse', '--verify', refName]);
  if (hasRef.status === 0) {
    const forkPoint = runGit(['merge-base', '--fork-point', refName, 'HEAD']);
    if (forkPoint.status === 0 && forkPoint.stdout.trim()) {
      return forkPoint.stdout.trim();
    }

    const mergeBase = runGit(['merge-base', refName, 'HEAD']);
    if (mergeBase.status === 0 && mergeBase.stdout.trim()) {
      return mergeBase.stdout.trim();
    }
  }

  const headParent = runGit(['rev-parse', '--verify', 'HEAD^']);
  if (headParent.status === 0 && headParent.stdout.trim()) {
    return headParent.stdout.trim();
  }

  return null;
}

const base = resolveBaseline(ref);
if (!base) {
  console.log(`Unable to resolve a CRAP diff baseline from ${ref}; skipping analysis.`);
  process.exit(0);
}

const diff = runGit(['diff', '--name-only', '--diff-filter=ACMR', base, '--']);
if (diff.status !== 0) {
  process.stderr.write(diff.stderr || `git diff failed for baseline ${base}\n`);
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
  console.log(`No changed production TypeScript files to analyze against ${base}.`);
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
  encoding: 'utf-8',
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
