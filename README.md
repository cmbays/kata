# @withkata/core

Development Methodology Engine -- TypeScript library + CLI that encodes development methodology (Shape Up) as executable, composable stages with a self-improving knowledge system.

[![CI](https://github.com/cmbays/kata/actions/workflows/ci.yml/badge.svg)](https://github.com/cmbays/kata/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)

## What is kata?

kata turns development methodology into runnable code. Instead of documenting your process in a wiki that nobody reads, kata encodes it as executable pipelines with entry/exit gates, artifact validation, and token budget tracking.

Built around the **Shape Up** methodology, kata models work as time-boxed cycles containing scoped bets. Each bet flows through a pipeline of stages -- research, shaping, building, and cooldown -- with gates that enforce quality at every transition.

The self-improving knowledge system captures patterns from your execution history, surfaces learnings at the right moment, and proposes adjustments to your methodology over time. The more you use it, the sharper it gets.

## Installation

```bash
npm install -g @withkata/core
```

Requires Node 20 or later.

## Quick Start

```bash
# 1. Initialize a kata project in the current directory
kata init

# 2. See available methodology stages
kata stage list

# 3. Start a pipeline from a built-in template
kata pipeline start vertical

# 4. Create a new time-boxed cycle
kata cycle new

# 5. Run cooldown reflection on a completed cycle
kata cooldown <cycle-id>

# 6. Review learned patterns and apply prompt improvements
kata knowledge review
```

## CLI Reference

All commands accept both English names and their Japanese aliases.

| Command | Alias | Description |
|---------|-------|-------------|
| `kata init` | `kata rei` | Initialize a new kata project |
| `kata stage list` | `kata form list` | List available methodology stages |
| `kata stage inspect <type>` | `kata form inspect <type>` | Show stage details |
| `kata pipeline start <type>` | `kata flow start <type>` | Start a pipeline from template |
| `kata pipeline status [id]` | `kata flow status [id]` | Show pipeline status |
| `kata pipeline prep <name> <stages...>` | `kata flow prep <name> <stages...>` | Create custom pipeline |
| `kata cycle new` | `kata enbu new` | Create a new cycle |
| `kata cycle status [id]` | `kata enbu status [id]` | Show cycle status |
| `kata cycle focus <id>` | `kata enbu focus <id>` | Add a bet to a cycle |
| `kata cooldown <cycle-id>` | `kata ma <cycle-id>` | Run cooldown reflection |
| `kata knowledge query` | `kata bunkai query` | Query learned patterns |
| `kata knowledge stats` | `kata bunkai stats` | Show knowledge statistics |
| `kata knowledge review` | `kata bunkai review` | Interactive pattern review |
| `kata execute run <stage>` | `kata kiai run <stage>` | Run execution session (coming soon) |

## Global Options

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format |
| `--verbose` | Enable verbose logging and stack traces |
| `--cwd <path>` | Set working directory |

## The Kata Lexicon

Japanese karate aliases are available for a themed experience. The domain code keeps standard names (Stage, Pipeline, Cycle, Learning); the themed aliases are a CLI presentation layer.

| Alias | Japanese meaning | Maps to |
|-------|-----------------|---------|
| **rei** | The bow | `kata init` |
| **form** | Kata / pattern | `kata stage` |
| **flow** | Flow of forms | `kata pipeline` |
| **enbu** | Group performance | `kata cycle` |
| **kiai** | Spirit shout | `kata execute` |
| **bunkai** | The breakdown | `kata knowledge` |
| **ma** | The space between | `kata cooldown` |

## Architecture

```
src/
  domain/types/       # Zod schemas -- the core model
  domain/services/    # Pipeline composition, manifest building, cycle management
  infrastructure/     # Persistence, registries, adapters, tracking
  features/           # Application-level use cases
  shared/lib/         # Logger, error hierarchy
  cli/                # Commander.js program
```

Key design decisions:

- **Schema-first types** -- All types are Zod v4 schemas with inferred TypeScript types. Schemas are the single source of truth; there are no separate interface definitions.
- **Clean architecture** -- Strict dependency direction: domain -> infrastructure -> features -> cli. Each layer only depends on the layers beneath it.
- **ESM-only** -- The package uses `"type": "module"` with `.js` import extensions throughout.
- **JSON file persistence** -- No database. All state lives in a `.kata/` project directory as validated JSON files.
- **Two entrypoints** -- `cli/index` for the binary and `domain/types/index` for library consumers importing schemas and types.

## Development

```bash
npm run build          # Build with tsup (ESM output)
npm run dev            # Run CLI in dev mode via tsx
npm test               # Run all tests (vitest)
npm run test:watch     # Watch mode
npm run test:coverage  # Coverage report (v8, 80% threshold)
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

## License

MIT
