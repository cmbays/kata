# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is kata?

A Development Methodology Engine — TypeScript library + CLI that encodes development methodology (Shape Up) as executable, composable stages with a self-improving knowledge system. Package: `@withkata/core`.

## Commands

```bash
npm run build          # Build with tsup (ESM, Node 20+)
npm run dev            # Run CLI in dev mode: tsx src/cli/index.ts
npm run test:unit      # Fast unit-focused vitest suite
npm run test:integration # Real-service / filesystem integration suite
npm run test:acceptance # Gherkin acceptance scenarios via quickpickle + Vitest
npm run test:e2e       # Real CLI subprocess smoke tests
npm test               # Unit + integration
npm run test:all       # Unit + integration + acceptance + e2e
npm run test:mutation:dry # Validate the Stryker harness quickly
npm run test:mutation  # Stryker mutation tests on core lifecycle files
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage (v8, thresholds: 80% statements/functions/lines, 75% branches)
npm run test:coverage:unit # Unit-only coverage artifact generation for CRAP analysis
npm run test:crap      # CRAP analysis against changed files
npm run test:arch      # dependency-cruiser architecture checks
npm run test:arch:unit # ArchUnit structural rules (LCOM, naming, layer deps, custom)
npm run lint           # ESLint on src/
npm run typecheck      # tsc --noEmit
npm run verify         # Lint + typecheck + unit + integration + e2e + build
npm run verify:quality # Coverage generation + CRAP + architecture (dep-cruiser + ArchUnit)
```

Run a single test file: `npx vitest run src/path/to/file.test.ts`
Run tests by pattern: `npx vitest run -t "PatternName"`

## Cross-repo context

Read `MEMORY.md` for the Cross-Repo Registry and current ops entrypoints. Do not hardcode private `ops` paths in tracked docs.

## Architecture

**Dependency direction**: domain → infrastructure → features → shared → cli (strict, no reverse imports)

```
src/
  domain/types/       # Zod schemas — the source of truth for all types
  domain/services/    # Pipeline composition, manifest building, cycle management
  domain/ports/       # Interfaces (IPersistence, IStageRegistry, IRefResolver)
  infrastructure/     # Persistence (JsonStore), registries, adapters, tracking
  features/           # Application-level use cases
  shared/lib/         # Logger, domain error hierarchy
  shared/constants/   # KATA_DIRS path constants
  cli/                # Commander.js — thin wrapper over features
```

**Non-negotiable rules**:
- Schema-first: All types are Zod schemas (`zod/v4` import path). No separate interface definitions.
- ESM-only: `"type": "module"`, `.js` extensions on all internal imports.
- No database: JSON files in `.kata/`. `JsonStore` handles typed read/write against Zod schemas.
- Two entrypoints via tsup: `cli/index` (bin) and `domain/types/index` (library exports).
- SessionExecutionBridge is NOT an IExecutionAdapter — it splits lifecycle into prepare/complete.

**Path aliases** (tsconfig.json + vitest.config.ts):

| Alias | Maps to |
|-------|---------|
| `@domain/*` | `src/domain/*` |
| `@infra/*` | `src/infrastructure/*` |
| `@features/*` | `src/features/*` |
| `@shared/*` | `src/shared/*` |
| `@cli/*` | `src/cli/*` |

## Tests

Colocated: `*.test.ts` next to `*.ts`. Vitest globals enabled — no need to import `describe`/`it`/`expect`.

Test stages:
- Unit: `vitest.unit.config.ts`
- Integration: `vitest.integration.config.ts`
- E2E: `vitest.e2e.config.ts` using the built CLI entrypoint from `dist/cli/index.js`
- Mutation: `vitest.mutation.config.ts` + `stryker.config.mjs`

Coverage excludes test files and `src/cli/index.ts`.

## GitHub PR operations — use REST API

`gh pr create`, `gh pr view --json`, and `gh pr merge` all use GitHub GraphQL (5000/hr quota). With parallel agents this drains fast. Always use the REST API for PR operations during agent runs:

```bash
# Create PR
gh api repos/{owner}/{repo}/pulls -X POST \
  --field title="..." --field body="..." \
  --field head="branch-name" --field base="main"

# Get PR number by branch
gh api "repos/{owner}/{repo}/pulls?head={owner}:branch-name"

# Merge PR
gh api repos/{owner}/{repo}/pulls/NNN/merge -X PUT --field merge_method=squash

# List reviews
gh api repos/{owner}/{repo}/pulls/NNN/reviews
```

## Implementation status

**Keiko 5 complete.** ~3013 tests across 147 files. See `MEMORY.md` for current state and cross-repo entrypoints.
