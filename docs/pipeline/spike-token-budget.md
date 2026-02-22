---
shaping: true
---

# S3 Spike: Token Budget Estimation

## Context

Cycles are budget-bounded (R3). We need to estimate and track token costs per stage and
pipeline to enable budget-aware planning. The question: how do we estimate upfront, and
how do we track actuals?

## Goal

Determine how token budget estimation and tracking should work across the maturity
gradient (null state → full integration).

## Questions

| #       | Question                                                      |
| ------- | ------------------------------------------------------------- |
| **Q1**  | What data sources exist for token usage?                      |
| **Q2**  | Can we estimate before execution, or only track after?        |
| **Q3**  | How does budget management work at the cycle level?           |

## Findings

### Q1: Token Usage Data Sources

| Source | What It Provides | Availability |
| ------ | --------------- | ------------ |
| **Claude Code JSONL session files** | Per-turn token counts (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) | Available after execution. Files at `~/.claude/projects/{encoded-path}/*.jsonl` |
| **Claude API responses** | `usage` object with token counts per request | Available if using API directly (not our case for v1) |
| **Composio agent-orchestrator** | Session-level cost tracking (planned, not yet shipped) | Future integration point |
| **Claude Code `/cost` command** | Session cost summary | Human-readable, not machine-parseable |
| **Anthropic billing dashboard** | Account-level usage | Not per-session granular |

**Key insight**: Claude Code's JSONL files are the richest data source we have access to.
They contain per-turn token counts with cache breakdowns. The methodology engine can read
these post-execution to calculate actual token usage per stage.

### Q2: Estimation vs. Tracking

**Estimation (before execution)** is unreliable for v1:
- Token usage varies wildly based on task complexity, agent behavior, number of tool calls
- A "research" stage might use 50K tokens for a simple topic or 500K for a complex one
- No historical data exists at null state — nothing to estimate from

**Tracking (after execution)** is reliable and immediately useful:
- Read JSONL files after stage completion → calculate actual tokens used
- Accumulate per-stage-type averages over time
- After N executions, historical averages become usable estimates

**Phased approach:**

| Phase | Capability | Data Source |
| ----- | ---------- | ----------- |
| **v1: Track actuals** | Record tokens used per stage execution. Display cumulative usage per pipeline and cycle. | Claude Code JSONL files (primary), manual entry (fallback) |
| **v2: Historical estimates** | Calculate median tokens per stage type from history. Show confidence intervals. Warn when a stage is running over typical. | Accumulated execution history |
| **v3: Predictive budgeting** | Estimate pipeline cost before execution based on stage composition × historical averages. Factor in complexity signals (issue size, artifact count). | Historical data + complexity heuristics |

### Q3: Cycle Budget Management

The cycle budget is a **constraint, not a prediction**. It works like Shape Up's appetite:
"We're willing to spend X tokens/dollars on this cycle."

```
Cycle Budget: 2M tokens
  ├── Bet A (appetite: 40%) → 800K tokens allocated
  │     ├── Pipeline 1: 300K used
  │     ├── Pipeline 2: 250K used
  │     └── Remaining: 250K
  ├── Bet B (appetite: 35%) → 700K tokens allocated
  │     └── Pipeline 1: 150K used (in progress)
  ├── Bet C (appetite: 15%) → 300K tokens allocated
  │     └── Not started
  └── Cooldown (appetite: 10%) → 200K tokens reserved
```

**Budget alerts:**
- 75% consumed → info notification ("Bet A is 75% through budget")
- 90% consumed → warning ("Bet A approaching budget limit — consider wrapping up")
- 100% consumed → action required ("Bet A has exceeded budget — stop or extend?")

**Budget doesn't hard-stop execution** — it's a signal, not a kill switch. The user
decides whether to extend or stop. This matches Shape Up's philosophy: appetite is about
discipline, not enforcement.

### Token-to-Cost Mapping

For subscription plans (Claude Pro, Max, etc.) with weekly limits:
- Map token usage to approximate cost using public pricing
- Track against weekly reset cycles
- "You've used ~60% of your weekly Claude Max budget across all cycles"

This is a v2+ feature — requires knowing the user's plan and pricing tiers.

## Acceptance

Spike complete — we can describe:
- Data sources for token tracking (JSONL files primary) ✅
- Phased approach: track first, estimate later, predict last ✅
- Budget management model (constraint, not hard stop) ✅
- Integration with subscription plans (v2+ feature) ✅
