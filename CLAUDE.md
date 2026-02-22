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

### CLI vocabulary — The Kata Lexicon

CLI commands use English names as primary, with Japanese karate aliases for a themed experience. Domain code keeps standard names (Stage, Pipeline, Cycle, Learning); the themed aliases are the CLI presentation layer.

| Domain term | CLI command | Japanese alias | Description |
|-------------|------------|----------------|-------------|
| Stage | `kata stage` | `kata form` | Manage methodology steps |
| Pipeline | `kata pipeline` | `kata flow` | Manage ordered compositions of stages |
| Cycle | `kata cycle` | `kata enbu` | Manage time-boxed work periods with budgets |
| Setup/Init | `kata init` | `kata rei` | Initialize a project |
| Execution | `kata execute` | `kata kiai` | Run focused execution sessions |
| Learning | `kata knowledge` | `kata bunkai` | Manage patterns extracted from practice |
| Cooldown | `kata cooldown` | `kata ma` | Run reflection on a completed cycle |

### Tests

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Vitest globals are enabled — no need to import `describe`/`it`/`expect`. Coverage excludes test files and `src/cli/index.ts`.

### Service and feature layer

- **StageRegistry** (`@infra/registries/`) — register, get, list, loadBuiltins, loadCustom
- **PipelineComposer** (`@domain/services/`) — define, validate, loadTemplates, instantiate
- **ManifestBuilder** (`@domain/services/`) — build, resolveRefs, attachGates, injectLearnings
- **CycleManager** (`@domain/services/`) — create, get, list, addBet, getBudgetStatus, generateCooldown
- **KnowledgeStore** (`@infra/knowledge/`) — capture, query, loadForStage, loadForSubscriptions, stats
- **AdapterResolver** (`@infra/execution/`) — resolve(config) → IExecutionAdapter (manual, claude-cli, composio)
- **TokenTracker** (`@infra/tracking/`) — recordUsage, getUsage, getTotalUsage, checkBudget
- **PipelineRunner** (`@features/pipeline-run/`) — orchestration loop with gate evaluation, retry logic, result capture
- **GateEvaluator** (`@features/pipeline-run/`) — evaluateGate with exhaustive condition checking
- **ResultCapturer** (`@features/pipeline-run/`) — pure history writer (token tracking is in PipelineRunner)
- **InitHandler** (`@features/init/`) — project detection, interactive setup, builtin loading
- **LearningExtractor** (`@features/self-improvement/`) — pattern detection across execution history, learning/prompt-update suggestions
- **PromptUpdater** (`@features/self-improvement/`) — applies prompt template changes with backup, preview diffs
- **CooldownSession** (`@features/cycle-management/`) — full cooldown orchestration with token enrichment, bet outcomes, proposal generation
- **ProposalGenerator** (`@features/cycle-management/`) — next-cycle proposals from unfinished work, learnings, dependencies

### CLI command modules

Each module exports `registerXCommand(parent: Command)` in `src/cli/commands/`:
- `init.ts` → `kata init`
- `stage.ts` → `kata stage list`, `kata stage inspect`
- `pipeline.ts` → `kata pipeline start`, `kata pipeline status`, `kata pipeline prep`
- `cycle.ts` → `kata cycle new`, `kata cycle status`, `kata cycle focus`; `kata cooldown` (interactive cooldown with proposals)
- `knowledge.ts` → `kata knowledge query`, `kata knowledge stats`
- `learning-review.ts` → `kata knowledge review` (interactive learning review + prompt updates)
- `execute` commands remain stubs (future wave)

CLI utility `src/cli/utils.ts`: `resolveKataDir()`, `getGlobalOptions()`
Formatters in `src/cli/formatters/`: stage, pipeline, cycle, gate, knowledge, learning (all support `--json`)

## Implementation status

**Waves 0-4 are complete.** 704 tests passing across 52 test files.

The implementation plan (`docs/pipeline/plan.md`) defines 5 waves with 9 sessions.
