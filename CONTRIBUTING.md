---
title: Contributing
description: How to work on the Kata codebase
---

# Contributing

Kata is a personal development methodology project. This guide covers how to work on the codebase.

## Prerequisites

- Node.js 20+
- npm

## Setup

```bash
git clone https://github.com/cmbays/kata
cd kata
npm install
```

## Development

```bash
npm run dev          # Run CLI in dev mode (tsx, no build required)
npm run build        # Build with tsup (ESM, Node 20+)
npm run test:unit    # Fast unit-focused vitest suite
npm run test:integration # Real-service / filesystem integration suite
npm run test:e2e     # Real CLI subprocess smoke tests
npm test             # Unit + integration
npm run test:all     # Unit + integration + e2e
npm run test:mutation:dry # Validate the Stryker harness quickly
npm run test:mutation # Stryker mutation tests on core lifecycle files
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint on src/
npm run verify       # Lint + typecheck + unit + integration + e2e + build
```

## Architecture

Clean architecture with strict dependency direction: **domain → infrastructure → features → shared → cli**

All types are Zod schemas (`zod/v4` import path). Schemas are the source of truth — no separate interface definitions.

See the [System Guide](docs-site/guides/system-guide.md) for a full architectural overview.

## Testing

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Vitest globals are enabled.

Test stages:
- Unit: `npm run test:unit`
- Integration: `npm run test:integration`
- E2E: `npm run test:e2e`
- Mutation dry run: `npm run test:mutation:dry`
- Mutation: `npm run test:mutation`

Coverage thresholds: 80% statements/functions/lines, 75% branches.

```bash
# Run a single file
npx vitest run src/domain/types/stage.test.ts

# Run tests matching a pattern
npx vitest run -t "StageSchema"

# Coverage report
npm run test:coverage
```

## Workflow

New work uses git worktrees on feature branches — no direct commits to `main`. All changes go through a PR.

```bash
git worktree add ../kata-my-feature -b feat/my-feature
```

## Changelog

The changelog is generated from git history using [`git-cliff`](https://git-cliff.org), a conventional-commits parser. No API keys or external services needed.

**One-time setup:**

```bash
brew install git-cliff
```

**Generate or refresh the changelog:**

```bash
npm run changelog:generate
```

This reads the full git history, groups commits by type (Features, Bug Fixes, Documentation, etc.), links issue and PR numbers to GitHub, and overwrites `changelog.md`. Configuration lives in `cliff.toml`.
