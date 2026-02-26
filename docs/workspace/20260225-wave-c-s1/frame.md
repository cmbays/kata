---
shaping: true
---

# Wave C Session 1 — Frame

## Source

> Wave C Session 1 — Orchestration Rule Wiring + Reflect Phase
>
> Issues: #103 (rule wiring), #104 (gap analysis), #105 (resources), #49 (reflect phase), #45 (cooldown integration)
>
> Reference files:
> - docs/v1-product-spec.md — authoritative spec
> - skill/orchestration.md — current orchestration rules and gaps
> - src/domain/types/run-state.ts — Decision/StageState schemas
> - src/infrastructure/orchestration/ — RuleRegistry, DecisionRegistry, MetaOrchestrator
>
> Acceptance criteria: At least one GitHub issue closed with tests passing, a completed
> breadboard-reflection doc, and skill/orchestration.md updated to remove any remaining
> gaps addressed.

---

## Problem

The 6-phase orchestration loop (`BaseStageOrchestrator`) has all its intelligence
phases implemented as stubs:

1. **Rules have no effect** — `computeRuleAdjustments()` returns 0. The RuleRegistry
   is fully built (CRUD, suggest/accept/reject) but rules never change flavor scores.
   Boost/penalize/require/exclude effects are all no-ops. (#103)

2. **Gaps are never detected** — `ExecutionPlan.gaps` exists in the schema and the
   plan phase runs, but coverage analysis is never performed. Gap data doesn't flow
   into stage state.json or any downstream consumer. (#104)

3. **Reflect phase never suggests rules** — `reflect()` has the structure to generate
   `ruleSuggestions` but the code is explicitly marked "no-op — infrastructure ready."
   The self-improvement loop cannot operate. (#49)

The result: every run is blind. Rules learned from past executions don't influence
future flavor selection. Gaps in methodology coverage are never surfaced. The
reflect phase accumulates no learnings that feed back into improved orchestration.

The system is a skeleton with the intelligence layers unconnected.

---

## Outcome

After this session:

- Rule effects (boost/penalize/require/exclude) actively change what flavors are
  selected and how they're scored during the match phase.
- The plan phase detects coverage gaps — bet context keywords not addressed by any
  selected flavor — and stores them in stage state for downstream visibility.
- The reflect phase generates concrete rule suggestions from decision outcomes and
  stores them via `RuleRegistry.suggestRule()` for the user's review workflow.
- At least one GitHub issue is closed with full test coverage.
- `skill/orchestration.md` is updated to reflect the new capabilities.

**Out of scope this session:**
- Cooldown ↔ run data integration (#45 — XL, blocked by #49)
- Orchestrator history consultation and vocabulary enrichment (#49 stretch goals)
- `kata knowledge rules --pending` CLI command (#49 stretch goal)
- Flavor-level resource aggregation and ManifestBuilder integration (#105 — step-level
  output already works via `kata step next`)
