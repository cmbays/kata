# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is kata?

A Development Methodology Engine — TypeScript library + CLI that encodes development methodology (Shape Up) as executable, composable stages with a self-improving knowledge system. Package: `@withkata/core`.

## Commands

```bash
npm run build          # Build with tsup (ESM, Node 20+)
npm run dev            # Run CLI in dev mode: tsx src/cli/index.ts
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage (v8, thresholds: 80% statements/functions/lines, 75% branches)
npm run lint           # ESLint on src/
npm run typecheck      # tsc --noEmit
```

Run a single test file:
```bash
npx vitest run src/domain/types/stage.test.ts
```

Run tests matching a pattern:
```bash
npx vitest run -t "StageSchema"
```

## Architecture

Clean architecture with strict dependency direction: **domain → infrastructure → features → shared → cli**.

```
src/
  domain/types/       # Zod schemas and inferred types — the core model
  infrastructure/     # Persistence (JsonStore), future: registries, adapters, tracking
  features/           # Application-level use cases (not yet built)
  shared/lib/         # Logger, domain error hierarchy
  cli/                # Commander.js program — thin wrapper over features
```

### Key design decisions

- **Schema-first types**: All types are Zod schemas (`z.object(...)`) with inferred TypeScript types. Schemas are the source of truth — no separate interface definitions.
- **Zod v4**: Uses `zod/v4` import path (not default `zod`). All schema files import from `'zod/v4'`.
- **ESM-only**: `"type": "module"` in package.json. All internal imports use `.js` extensions.
- **No database**: JSON files in a `.kata/` project directory. `JsonStore` handles typed read/write/validate against Zod schemas.
- **Two entrypoints** via tsup: `cli/index` (bin) and `domain/types/index` (library exports).

### Path aliases

Configured in both `tsconfig.json` and `vitest.config.ts`:

| Alias | Maps to |
|-------|---------|
| `@domain/*` | `src/domain/*` |
| `@infra/*` | `src/infrastructure/*` |
| `@features/*` | `src/features/*` |
| `@shared/*` | `src/shared/*` |
| `@cli/*` | `src/cli/*` |

### Domain model (10 Zod schemas)

The type system models a methodology pipeline engine:

- **Stage** — a reusable methodology step (research, shape, build, etc.) with entry/exit gates and artifacts
- **Pipeline** — an ordered sequence of stages with state tracking per-stage
- **Cycle** — a time-boxed work period (Shape Up cycle) containing bets with token/time budgets
- **Bet** — a scoped unit of work within a cycle, with appetite and outcome tracking
- **Gate** — entry/exit conditions for stages (artifact-exists, schema-valid, human-approved, predecessor-complete)
- **Artifact** — named outputs produced by stages, validated against Zod schemas
- **Learning** — extracted patterns with 3-tier loading (stage, category, agent) and confidence scoring
- **Manifest** — fully resolved execution payload sent to an adapter (manual, claude-cli, composio)
- **History** — execution records with token usage tracking
- **Config** — project-level `.kata/config.json` settings

### CLI vocabulary (thematic naming)

Internal domain terms map to themed CLI commands:

| Domain term | CLI command | Description |
|-------------|------------|-------------|
| Stage | `kata form` | Manage methodology steps |
| Pipeline | `kata sequence` | Manage stage compositions |
| Cycle | `kata practice` | Manage time-boxed work periods |
| Learning | `kata memory` | Manage extracted patterns |
| Init | `kata begin` | Initialize a project |
| Cooldown | `kata reflect` | Run cycle retrospective |
| Execution | `kata focus` | Run focused sessions |

### Tests

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Vitest globals are enabled — no need to import `describe`/`it`/`expect`. Coverage excludes test files and `src/cli/index.ts`.

## Implementation status

**Wave 0 (Foundation) is complete.** All types, persistence, CLI skeleton, and shared utilities are built.

The implementation plan (`docs/pipeline/plan.md`) defines 5 waves with 9 sessions. Waves 1–4 are not yet started. The next wave (Wave 1) builds domain services: stage registry, pipeline composer, cycle manager, knowledge store, and execution adapters.
