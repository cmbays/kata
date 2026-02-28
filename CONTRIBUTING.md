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
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint on src/
```

## Architecture

Clean architecture with strict dependency direction: **domain → infrastructure → features → shared → cli**

All types are Zod schemas (`zod/v4` import path). Schemas are the source of truth — no separate interface definitions.

See the [System Guide](/docs/kata-system-guide) for a full architectural overview.

## Testing

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Vitest globals are enabled.

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

The changelog is generated from git history using `mintlify-changelog` (managed via `uv tool`).

**One-time setup:**

```bash
# Install the tool
uv tool install mintlify-changelog

# Store your Anthropic API key
mintlify-changelog --set-api-key
```

**Generate or refresh the changelog:**

```bash
npm run changelog:generate
```

This reads the last 60 commits, uses Claude to write narrative entries, and overwrites `changelog.md`.
