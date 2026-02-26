---
shaping: true
---

# Wave C Session 2 — Frame

## Source

> Wave C Session 2 — Flavor Resources + Cooldown Run Data Wiring
>
> Issues: #105 (flavor-level resource aggregation), #45 (cooldown ↔ run data integration),
> #112 (cooldown run data — scoped Wave C deliverable)
>
> Reference files:
> - docs/v1-product-spec.md — authoritative spec (Sections 3.4, 4.6, 4.7, US-5)
> - src/domain/types/flavor.ts — FlavorSchema (no resources field yet)
> - src/domain/types/step.ts — StepResources schema (tools/agents/skills)
> - src/domain/services/manifest-builder.ts — serializeResources() already wired at step level
> - src/cli/commands/step.ts — kata step next returns step-level resources only
> - src/features/cycle-management/cooldown-session.ts — reads legacy pipeline/history data
> - src/features/cycle-management/proposal-generator.ts — cycle-level data only, no run data
> - src/infrastructure/persistence/run-store.ts — run paths, read/write helpers
> - src/domain/types/bet.ts — BetSchema (no runId field)

---

## Problem

Two wiring gaps remain in Wave C. Both involve existing schemas and infrastructure that
are not yet connected to their consumers.

### Gap 1: Flavor-level resources (#105)

`serializeResources()` and step-level resources are fully wired — agents executing
`kata step next` already receive the step's tools, agents, and skills. But:

1. **Flavors can't declare additional resources.** `FlavorSchema` has no `resources`
   field. If a flavor (e.g., a `nextjs` build flavor) needs tools beyond what individual
   steps define, there is no way to express that.

2. **`kata step next` only returns the step's own resources.** When an agent starts a
   step, it only sees resources attached to that specific step — not resources added at
   the flavor level. The agent's tool guidance is incomplete.

### Gap 2: Cooldown sees no run data (#112 / partial #45)

`kata cycle start` creates a run for every bet and stores `betId` on each run. But:

1. **`BetSchema` has no `runId` field.** There is no forward link from bet → run. Lookups
   require scanning all runs and filtering by `betId`.

2. **`CooldownSession` reads legacy pipeline/history data.** When `kata cooldown` runs,
   it uses `ExecutionHistoryEntry` from the old pipeline system. It never reads the new
   `.kata/runs/` state files that contain decisions, gap reports, artifact indexes, and
   stage states.

3. **`ProposalGenerator` has no run data awareness.** Proposals are generated from bet
   outcomes and learnings only. Gap severity from run data, decision confidence patterns,
   and actual execution artifacts are invisible to the next-cycle planning process.

The result: cooldown reflection is blind to the actual execution. Every cooldown works
from high-level cycle data only. The richer signal the orchestration system captures
(decisions, gaps, confidence levels) never feeds back into planning.

---

## Outcome

After this session:

- `FlavorSchema` has an optional `resources` field. Flavors can declare tools, agents,
  and skills beyond what their steps define.
- `kata step next` returns merged resources — the step's own plus any flavor-level
  additions — deduplicated by name.
- `ManifestBuilder.build()` accepts optional flavor resources and merges them with
  the step's resources before prompt serialization.
- `BetSchema` has `runId?: string`. `kata cycle start` sets it when creating each run.
- `CooldownSession` reads `.kata/runs/` data when `runsDir` is provided: decisions,
  gap reports, artifact indexes, and stage states for all runs in the cycle.
- `ProposalGenerator.generate()` accepts optional run summaries and produces additional
  proposals from gap severity and low-confidence decision patterns.
- `kata cooldown`/`kata ma` `--json` output includes per-bet run summaries.

**Out of scope this session:**
- Interactive suggestion review workflow in cooldown (accept/reject/defer rules/vocab)
- Rule application from accepted cooldown suggestions
- Vocabulary additions from decision context analysis
- `kata cooldown start <cycle-id>` redesign as a new subcommand
- Cross-run flavor frequency and outcome pattern detection (full #45 stretch)
