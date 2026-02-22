---
shaping: true
---

# S5+S6 Spike: Dashboard Technology & Package Naming

## S5: Dashboard Technology

### Decision: Deferred to Phase 5 (confirmed)

The dashboard is a Nice-to-have (R7) and adds significant scope to the initial build.
Deferring is correct. However, noting two considerations for when we get there:

**TUI-first option (Phase 3-4 stretch):**
- **Ink** (React for terminals) — could provide a lightweight pipeline status view
  (`me dashboard`) earlier than a full web UI
- Matches the CLI-first philosophy of the tool
- Low investment, high utility for power users

**Web option (Phase 5):**
- Next.js dashboard (like Composio's `ao dashboard`)
- Richer visualization: pipeline graphs, cycle timelines, learning evolution
- Could be a separate `@methodology/dashboard` package

**Architecture note:** Design the core engine with a clean query API from day one so that
both TUI and web dashboards can consume the same data layer. No dashboard-specific logic
in the core.

---

## S6: Package Naming

### Constraints

1. CLI command should be short (2-3 characters ideal for frequent use)
2. npm package name must be available
3. Name should convey "development methodology" not "agent orchestrator"
4. Should work as both a library import and a CLI tool name
5. Ideally memorable and slightly opinionated (not generic)

### Options Explored

| Name | CLI Command | Conveys | Concerns |
| ---- | ----------- | ------- | -------- |
| `methodology-engine` | `me` | Exactly what it is | Generic. `me` command is fun ("me init" = "help me get started") but potentially conflicts with existing tools |
| `methodic` | `methodic` | Systematic methodology | Too long for a CLI command (8 chars). `mtc` abbreviation is awkward |
| `cadence` | `cadence` | Rhythmic work cycles | Beautiful name. 7 chars is borderline. Conveys cycles well but not methodology |
| `forge` | `forge` | Where things are shaped | Strong. 5 chars. But overloaded (Electron Forge, Minecraft Forge, etc.) |
| `tempo` | `tempo` | Rhythm, pacing, cycles | 5 chars. Clean. But more about timing than methodology |
| `loom` | `loom` | Weaving stages together | 4 chars. Evocative. Not overloaded. Unique in dev tooling |
| `shapework` | `sw` | Shape Up methodology | Too tied to one framework. 2-char CLI is nice |
| `devmethod` | `dm` | Development methodology | Abbreviation feels clinical. `dm` conflicts with "direct message" |
| `pipeweave` | `pw` | Weaving pipelines | Creative but unclear |

### Evaluation Criteria (weighted)

| Criterion | Weight | Notes |
| --------- | ------ | ----- |
| CLI ergonomics | 30% | Typed hundreds of times per day |
| Conceptual clarity | 25% | New users should intuit what it does |
| Uniqueness | 20% | Not overloaded with other tools |
| Memorability | 15% | Sticks after first encounter |
| npm availability | 10% | Hard requirement but most names are taken at top level |

### Top Candidates

**1. `cadence`** — "Development has a cadence: research, shape, build, review, learn,
repeat." The cycle metaphor is central to the product. CLI: `cadence init`,
`cadence pipeline start`, `cadence cycle new`. At 7 characters it's borderline but
tab-completable. Could alias to `cdc` for power users.

**2. `loom`** — "Weave stages into pipelines, pipelines into cycles." Visual metaphor
of threads coming together. CLI: `loom init`, `loom pipeline start`. 4 characters.
Unique in dev tooling. Less immediately obvious what it does.

**3. `forge`** — "Where methodology is forged." Strong, active verb energy. CLI:
`forge init`, `forge pipeline start`. 5 characters. Risk: overloaded name in the
ecosystem.

**4. `methodology-engine` with `me` CLI** — Most literal. `me init`, `me pipeline start`.
The `me` command is playful and short. Risk: `me` might conflict with existing tools
on some systems.

### Decision: Deferred to user

This is a taste/brand decision. Presenting top candidates for user input. The package
can use a scoped name (`@4ink/cadence`, `@4ink/loom`) to avoid npm conflicts while the
CLI command is the short form.

## Acceptance

- S5: Dashboard deferred to Phase 5, architecture note captured ✅
- S6: Top naming candidates identified with evaluation criteria ✅
- S6: Needs user decision — presenting options ✅
