---
title: Dogfooding Roadmap
description: Using Kata to build Kata — project goals, scope, and bet backlog for v1 dogfooding.
---

# Dogfooding Roadmap

> Using Kata to build Kata. This roadmap defines the projects and bet backlog for
> dogfooding the kata system to v1 readiness. Bets are picked into time-boxed
> cycles (keiko) based on priority, dependencies, and appetite.

## How This Works

- **Projects** are high-level goals that may span multiple cycles.
- **Bets** are scoped units of work within a project. Each bet is small enough for one cycle.
- **Cycles** are time-boxed. At cycle start, pick unblocked bets from any project. At cycle end, run cooldown.
- **Emergent work** — bugs, enhancements, and new bets discovered during cycles get filed and added to the backlog.
- **System-led progression** — as we fix and use Kata, the system should naturally guide us to create skills, save katas, register agents, and build learnings. We don't force it; we follow where it leads.

## Cycle 0: Bootstrap (Complete)

First dogfooding session. Validated the core lifecycle: init → cycle → bets → execute → observe → decide → complete → cooldown. Found 15 issues (#205–#219). See diary entry for narrative.

---

## Project 1: Critical Path Fixes

> Unblock the agent workflow and fix the feedback loop. These are prerequisites
> for productive dogfooding — everything else fights broken tooling without them.

### Bets

| Bet | Issues | Blocked by | Domain |
|-----|--------|------------|--------|
| Fix malformed history files from `kata kiai` | #215 | — | data |
| Fix bet completion tracking (run completion → bet outcome) | #216 | — | data |
| Implement `kata run list` for active cycle | #209 | — | cli |
| Fix observation list aggregation across run levels | #208 | — | cli |
| Implement `--next` flag on `kata kiai` | #207 | #209 | cli |
| Wire CLI aliases: maki, hai, okite | #205 | — | cli |
| Implement `kata cycle bet list` / kadai alias | #206 | — | cli |
| Fix double error messages on validation failures | #210 | — | cli |
| Make `kime record` flags optional (context, options) | #212 | — | cli |
| Suppress noisy vocabulary file warning | #213 | — | cli |
| Add human-friendly ID references (name lookup + short hash) | #214 | — | cli |
| Cooldown should warn on incomplete cycles | #217 | — | cli |

### Exit Criteria

Agent can: create a cycle, add bets, start the cycle, `--next` through runs, record observations/decisions without UUID juggling, list runs, complete stages, run cooldown, and see accurate completion data.

---

## Project 2: CLI Command Coverage

> Systematically test every command, subcommand, and flag combination. Verify
> correct behavior, helpful error messages, consistent output formatting, and
> --json/--plain support across the board.

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Audit init flow: `kata init` with --scan, --discover-agents, --skip-prompts, --methodology, --adapter | init | — |
| Audit step commands: waza list, inspect, create, edit, delete, complete, next, rename | step CRUD | — |
| Audit flavor commands: ryu list, inspect, create, edit, delete | flavor CRUD | — |
| Audit cycle commands: keiko new, status, add-bet, update-bet, start, focus | cycle mgmt | — |
| Audit execute commands: kiai with each gyo, --dry-run, --ryu, --kata, --save-kata, --list-katas | execution | P1 fixes |
| Audit execute flags: --yolo, --bridge-gaps, --kataka | execution flags | P1 fixes |
| Audit cooldown: ma with --skip-prompts, --prepare, --yolo, --depth, complete | cooldown | P1 (history fix) |
| Audit knowledge commands: bunkai query, stats, review, archive, promote | knowledge | — |
| Audit decision + artifact + approve + gate + rule commands | supporting cmds | P1 (aliases) |
| Audit observation commands: kansatsu record (each type), list with filters | observations | P1 (#208) |
| Audit predict command with various content and flag combinations | predictions | — |
| Audit agent commands: kataka register, list, inspect, unregister | agent mgmt | — |
| Audit dojo commands: list, open, inspect, diary, diary-write, sources, generate | dojo system | — |
| Audit informational: status, stats, lexicon with --json, --plain, --verbose | output modes | — |
| Verify --json output is valid parseable JSON for every command that supports it | consistency | — |
| Verify --plain output strips all themed vocabulary consistently | consistency | — |
| Test --cwd flag on representative commands from outside the project dir | global flags | — |

### Exit Criteria

Every CLI command and flag has been exercised at least once. All bugs filed. A confidence matrix exists showing pass/fail per command.

---

## Project 3: Agent Workflow

> Build, register, and operate an actual kataka on the kata project. Test the
> full agent persona lifecycle — from registration to attributed execution to
> confidence profiling.

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Register a "kata-sensei" kataka via `kata agent register` | agent creation | P2 (agent audit) |
| Create a custom step definition for dogfooding work (e.g., "cli-audit") | step authoring | P2 (step audit) |
| Create a custom flavor using the custom step | flavor authoring | ↑ |
| Save a named kata sequence with `--save-kata` | kata persistence | P1 (--next) |
| Load a saved kata with `--kata`, verify execution matches | kata loading | ↑ |
| Run execution with `--kataka` flag, verify attribution on observations/decisions | attribution | agent registration |
| Inspect kataka via `kata agent inspect` — confidence profile, observability | agent analytics | ↑ |
| Test `kata init --discover-agents` in a project with agent files | auto-discovery | — |
| Evaluate skill files: have a fresh Claude session use only `.kata/skill/` to understand and operate kata | agent onboarding | P2 (output audit) |
| Test agent workflow end-to-end: fresh session → read KATA.md → pick up cycle → run bets → complete | full agent loop | P1 fixes, agent registration |

### Exit Criteria

A registered kataka can autonomously pick up work from a cycle, execute it with attribution, and have its confidence profile reflect the work done.

---

## Project 4: Human Experience

> Test the interactive and visual surfaces. The human drives; the agent guides
> what to test and captures observations. Focus on: does it feel good to use?

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Test `kata watch` with an active run — layout, live updates, readability | TUI | P1 fixes |
| Test `kata config` — walk through methodology editor, edit steps/flavors/patterns | TUI | — |
| Test `kata init` interactive flow (no --skip-prompts) — guided setup experience | onboarding | — |
| Test `kata cooldown` interactive flow — does it ask useful reflection questions? | collaboration | P1 (history fix) |
| Test `kata knowledge review` — interactive approve/reject flow | knowledge mgmt | — |
| Audit terminal output: alignment, truncation, color contrast at various widths | visual polish | — |
| Identify every point where the agent *should* ask the human something but doesn't | collaboration gaps | — |
| Test error recovery: what happens when you give bad input, cancel mid-flow, ctrl-C? | resilience | — |
| Evaluate help text: are --help outputs clear and complete for a new user? | onboarding | — |

### Exit Criteria

A human can comfortably use every interactive surface. TUIs render correctly. Error states are handled gracefully. The collaboration points between human and agent feel natural.

---

## Project 5: Intelligence & Learning

> Test the meta-learning loop across multiple runs. Predictions, friction
> detection, knowledge accumulation, belt progression, and the learning → behavior
> improvement arc.

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Record predictions with `kata predict`, verify calibration detection fires | predictions | P1 (history fix) |
| Generate enough observations across 3+ runs to trigger friction analysis | friction | P1 fixes |
| Test `--bridge-gaps` on a run with known gaps — capture and blocking behavior | gap bridging | P1 fixes |
| Test `--yolo` flag — verify confidence gates are actually skipped | yolo mode | P1 fixes |
| Test `kata knowledge query` with various filters — relevance of results | knowledge query | — |
| Test `kata knowledge promote` — step-tier → flavor/stage tier promotion | tier promotion | knowledge exists |
| Test `kata knowledge archive` — exclusion from queries | archival | knowledge exists |
| Belt progression: complete enough actions to reach go-kyu, then yon-kyu | progression | P1 fixes, multi-cycle |
| Verify belt thresholds feel right — early wins early, harder progression later | progression tuning | ↑ |
| Cross-cycle pattern recognition: do recurring gaps surface in later cooldowns? | pattern detection | multi-cycle data |
| Verify learnings from execution appear in subsequent execution prompts | learning → behavior | P1 (history fix) |

### Exit Criteria

The learning loop works: observations → learnings → improved prompts → better execution. Belt progression feels earned. Predictions show calibration over time.

---

## Project 6: Diary & Dojo

> The reflective soul of the system. Test the full arc from cycle reflection to
> training session generation.

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Implement three-part diary: raw data + agent perspective + human perspective | #218 | P1 (history, completion) |
| Implement collaborative cooldown reflection in non-yolo mode | #219 | #218 |
| Run a real cooldown with the new diary flow — all three parts | diary flow | #218, #219 |
| Test `kata dojo generate` — does it produce a useful session from accumulated data? | dojo generation | diary entries exist |
| Test diary → dojo connection: does narrative context make sessions more targeted? | dojo quality | ↑ |
| KATA.md refresh after cooldown — verify it updates with current state | KATA.md refresh | P1 (completion tracking) |
| Validate the dojo HTML output: open in browser, check readability and structure | dojo display | dojo generation |
| Test LLM synthesis in cooldown (--yolo path): agent-only reflection quality | yolo diary | #218 |
| Evaluate multi-cycle diary arc: does reading 3+ entries tell a coherent story? | narrative continuity | multi-cycle data |

### Exit Criteria

Cooldown produces a rich three-part diary. Dojo sessions are targeted and useful. The narrative thread across cycles tells the story of the project's evolution.

---

## Project 7: Docs, Package & Ship

> Prepare for v1 release. Documentation accuracy, package readiness, and the
> final quality bar.

### Bets

| Bet | Scope | Blocked by |
|-----|-------|------------|
| Mintlify site audit: every page renders, no broken links, content is current | docs | — |
| Verify skill/ directory matches actual CLI behavior post-fixes | docs accuracy | P1, P2 |
| Update kata-system-guide.md with dogfooding-era changes | system guide | P2 |
| Write npm README: installation, quick start, what it does | package | — |
| Add LICENSE file (decide: MIT, Apache 2.0, or other) | legal | — |
| Polish CONTRIBUTING.md | community | — |
| Generate changelog with git-cliff | changelog | — |
| Audit `package.json` files field — verify `npm pack` ships the right things | package | — |
| Test `npx @withkata/core` installation experience from scratch | package | npm publish |
| Version bump, GitHub release, npm publish | ship | all above |
| Close or triage all remaining open issues | cleanup | — |
| Update unified-roadmap.md to reflect completed dogfooding | docs | — |

### Exit Criteria

`npm install -g @withkata/core && kata init` works for a new user. Docs are accurate. Package is published. Open issues are triaged.

---

## Dependency Graph (Projects)

```
P1 (Critical Fixes) ──────→ P2 (CLI Audit) ──→ P3 (Agent Workflow)
       │                          │                     │
       │                          ↓                     ↓
       └──────────────────→ P4 (Human Experience)  P5 (Intelligence)
                                                        │
                                                        ↓
                                                   P6 (Diary & Dojo)
                                                        │
                                                        ↓
                                                   P7 (Docs & Ship)
```

P1 unblocks nearly everything. P2–P4 can run in parallel after P1. P5–P6 need accumulated data from multiple cycles. P7 is the final pass.

## Picking Bets Into Cycles

At the start of each cycle:

1. Check what's unblocked (dependencies met, no upstream bugs blocking)
2. Pick bets that fit the cycle's appetite
3. Mix project work with any emergent bugs/enhancements from prior cycles
4. Let the system guide: if cooldown proposes "create a custom step," do it — that's the system working

The first few cycles will be heavily P1 + P2. As fixes land, P3–P6 bets become available. P7 is the final cycle(s).
