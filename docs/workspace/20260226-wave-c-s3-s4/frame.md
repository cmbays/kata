---
shaping: true
---

# Wave C — Session 3 + 4: Cooldown Feedback Loop — Frame

## Source

> Issue #45: feat: cooldown ↔ run data integration — cross-run aggregation, suggestions, next-cycle proposals
>
> Wire the cooldown/reflection system to read all run data from a completed cycle, aggregate
> patterns across bets, and surface actionable suggestions for methodology improvement. Currently,
> CooldownSession uses legacy pipeline/history data — it needs to read from the new `.kata/runs/`
> state files.
>
> Acceptance criteria (abridged):
> - Cooldown reads all `.kata/runs/` data for the cycle's runs ✅ (done in S2)
> - Cross-run pattern detection: flavor frequency, gap patterns, confidence patterns, outcome patterns
> - Aggregates pending rule suggestions from all reflect phases in the cycle
> - Interactive suggestion review: accept/reject/defer each suggestion
> - Accepted rules applied to rule registry
> - Learnings captured with cross-run evidence
> - Next-cycle bet proposals generated with kata pattern recommendations
> - `--json` output for agent-driven cooldown

## Problem

PR #131 (Wave C S2) wired the per-bet `RunSummary` into cooldown and surfaces gap-severity and
confidence proposals. Two critical gaps remain:

1. **The rule feedback loop is broken end-to-end.** `KiaiRunner` never instantiates `RuleRegistry`
   — so rule suggestions from the reflect phase are never created at all. Even if they were, nothing
   reads them during `kata cooldown`. Suggestions accumulate invisibly, the rule registry stays
   empty, and the orchestrator never improves between cycles.

2. **Cross-run patterns are invisible.** Each bet's `RunSummary` is analyzed in isolation. Recurring
   gaps (same gap across 3 bets), unused flavors (never selected in the entire cycle), and
   --yolo decisions flagged for review exist in the raw data but are never aggregated.

## Outcome

After `kata cooldown`:

1. Practitioners see pending rule suggestions generated during the cycle's runs and can
   accept, reject, or defer each one interactively.
2. Accepted rules are immediately applied to the rule registry and influence the next cycle's
   orchestration.
3. Recurring patterns across all runs in the cycle surface as enriched proposals — recurring gaps
   get higher-priority proposals with multi-bet evidence, unused flavors get visibility.
4. `--yolo` low-confidence decisions are counted and surfaced so practitioners know where
   confidence coverage is thin.

## Scope boundary

**In scope:**
- KiaiRunner → RuleRegistry wiring (prerequisite)
- CooldownSession rule suggestion aggregation and interactive review
- Cross-run flavor frequency and recurring gap analysis
- --yolo decision counting and surfacing

**Out of scope (no infrastructure):**
- Vocabulary seeding from gap patterns (no VocabularyStore, no CLI — future work)
- `decision-outcomes.jsonl` quality-based pattern analysis (minor enrichment, not on critical path)
