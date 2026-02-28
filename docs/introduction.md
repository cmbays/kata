---
title: Introduction
description: Kata is a development methodology engine that encodes Shape Up as executable, composable stages with a self-improving knowledge system.
---

# Kata

**Development Methodology Engine** — encode methodology (Shape Up) as executable, composable stages with a self-improving knowledge system.

Package: `@withkata/core`

## What it does

Kata gives AI agents a structured framework to follow when building software. Instead of ad-hoc execution, agents work through defined methodology stages (research, plan, build, review) with explicit gates, tracked decisions, and captured learnings that feed back into the next cycle.

## Quick start

```bash
npm install -g @withkata/core
kata init
kata cycle new "My first cycle" --budget 200000
kata cycle start <cycle-id>
```

## Key concepts

| Term | Alias | What it is |
|------|-------|-----------|
| Stage | `gyo` | One of four methodology phases: research, plan, build, review |
| Flavor | `ryu` | A named composition of steps for a stage |
| Step | `waza` | An atomic methodology unit within a flavor |
| Cycle | `keiko` | A time-boxed work period with token budgets and bets |
| Execution | `kiai` | Running a stage against a bet |
| Cooldown | `ma` | Post-cycle reflection and learning capture |

See the [System Guide](/docs/kata-system-guide) for the full architecture and vocabulary reference.

## Installation

```bash
# npm
npm install @withkata/core

# Run without installing
npx @withkata/core init
```

Requires Node.js 20+.
