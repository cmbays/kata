---
shaping: true
---

# Claude-Native Execution Adapter — Frame

**Issue:** #229
**Date:** 2026-03-01
**Status:** Draft

---

## Source

> When the sensei spawns sub-agents via the Agent tool, it completely bypasses
> kata's execution layer. No runs are written, no history, no observations —
> the intelligence system (learning, belt, cooldown) is blind to every cycle
> we run this way.

> The root cause: kata was designed to be adapter-pluggable (manual / claude-cli
> / composio), but there is no adapter for the case where a Claude session IS
> the orchestrator.

> Cycle 1 validated the team/task organizational layer. Four agents ran in
> parallel, all reported back. But zero execution data written to `.kata/`.
> Learning system, belt calculator, cooldown analysis — all blind.

---

## Problem

Kata has three execution adapters today: `manual` (prints to terminal),
`claude-cli` (subprocess via `claude` binary), and `composio` (stub). All three
model execution as **call-and-wait**: the adapter's `execute()` method sends the
manifest somewhere, blocks until it completes, and returns a result.

The Cycle-as-a-Team pattern breaks this model. When the sensei runs inside a
Claude session, execution happens via the **Agent tool** — an in-session
mechanism that the adapter layer cannot invoke. The Agent tool is only available
to the LLM orchestrator (sensei), not to TypeScript code running in a shell.

This creates a layering mismatch:

```
Current adapters (call-and-wait):

  TypeScript code → adapter.execute(manifest) → [runs somewhere] → ExecutionResult
                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                    adapter owns the full lifecycle

Claude-native (orchestrator-mediated):

  Sensei → [builds manifest via kata CLI] → [formats agent prompt] → Agent tool
       → [agent executes] → [agent writes kansatsu/maki via kata CLI]
       → [sensei closes run]
       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
       sensei owns the lifecycle; adapter only prepares and closes
```

The fundamental mismatch: `IExecutionAdapter.execute()` implies the adapter
runs the work. In the claude-native case, the adapter **cannot** run the work —
only the sensei (LLM session) can invoke the Agent tool. The adapter's role
shifts from executor to **bridge**: prepare the run, format the agent context,
and close the run after the sensei dispatches and collects results.

---

## Outcome

A developer using Claude Code with the sensei skill can run a kata cycle where:

1. Every bet execution writes real run data to `.kata/` — history, artifacts,
   observations, decisions.
2. The sensei builds agent prompts **from the manifest** (not hand-written) so
   agents get consistent, methodology-grounded instructions.
3. Agents are kata-aware by default — they know their run-id, bet-id, which
   kata CLI commands to use, and which gates they must satisfy.
4. Cooldown sees actual execution data. The belt calculator has signal. The
   learning loop closes.
5. The flow feels natural to the sensei — one command to prepare the whole
   cycle, spawn agents, one command to close. Minimal ceremony.
6. The user can ask "where are things at?" mid-cycle and get a grounded answer
   based on real `.kata/` state, not the sensei's memory.

---

## Architectural Analysis

### Why not just implement `IExecutionAdapter`?

The `IExecutionAdapter` contract is `execute(manifest) → Promise<ExecutionResult>`.
This works when the adapter controls the execution lifecycle end-to-end
(subprocess, API call, terminal output). In the claude-native case:

- The adapter **cannot** spawn agents (no Agent tool access from TypeScript).
- The execution is **async across conversation turns** — the sensei spawns an
  agent, the agent works across multiple turns, the agent reports back. This
  isn't a single `await`.
- The adapter needs to **split the lifecycle**: prepare before agent spawn,
  close after agent completion.

Forcing this into `execute()` would require the adapter to return immediately
with a "pending" result, losing the contract's guarantee that `execute()` means
"the work is done."

### The bridge model

Instead of shoehorning into `IExecutionAdapter`, the claude-native path
introduces a **session execution bridge** — a service that splits the adapter
lifecycle into three operations at two granularity levels:

```
┌────────────────────────────────────────────────────────────────────┐
│ SessionExecutionBridge                                             │
│                                                                    │
│  Cycle-level:                                                      │
│    prepareCycle(cycleId) → PreparedCycle { runs[], agentContexts }  │
│    completeCycle(cycleId) → CycleSummary { stats, tokenUsage }     │
│    getCycleStatus(cycleId) → CycleStatus { bets[], progress }      │
│                                                                    │
│  Run-level:                                                        │
│    prepare(betId) → PreparedRun { runId, manifest, ... }           │
│    formatAgentContext(prepared) → string (prompt block)             │
│    complete(runId, agentResult) → void (writes history)             │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

The **cycle-level** methods are convenience wrappers. `prepareCycle()` calls
`prepare()` for each bet in the cycle, returning all prepared runs at once so
the sensei can review the full execution plan before spawning any agents.
`completeCycle()` calls `complete()` for each run and aggregates stats.
`getCycleStatus()` reads `.kata/` state to answer "where are things at?"

The **run-level** methods are the primitives. The sensei can use either level
depending on whether it's running a full cycle or a single bet.

This is not a violation of the adapter pattern — it's a recognition that
in-session execution is a fundamentally different execution model. The existing
adapters remain unchanged. The bridge is a new entry point used exclusively by
the sensei skill.

### What the bridge does (prepare)

1. Resolves the bet from the cycle (validates bet-id, checks cycle state).
2. Reads the bet's saved kata sequence (if any) or determines stage categories
   from the bet's scope.
3. Builds `ExecutionManifest` for each stage using `ManifestBuilder`.
4. Opens a run entry: generates run-id, records start time, links to cycle/bet.
5. Returns `PreparedRun` — everything the sensei needs to format agent prompts.

### What the bridge does (formatAgentContext)

Generates a structured prompt block from the `PreparedRun`. This is the
agent-side complement described in #231 — it collapses into this method.

The context block has four sections:

```markdown
## Kata Run Context

You are executing inside a kata run. Record your work as you go.

- **Run ID**: abc-123
- **Bet ID**: def-456
- **Cycle ID**: ghi-789
- **Kata dir**: /Users/cmbays/Github/kata/.kata
- **Stage**: build
- **Flavor**: bugfix-ts

### What to produce
[From manifest.artifacts — names, descriptions, required/optional]
- Fix the bug described in the bet context
- Write tests for the fix

### Gates
**Entry gate**: artifact-exists(plan-artifact)
  → Verify this artifact exists before starting. If missing, STOP and
    report to the sensei immediately.

**Exit gate**: schema-valid(build-artifact)
  → Your output must satisfy this condition. The sensei will verify
    after you complete.

If you cannot satisfy an entry gate, do NOT proceed. Report the blocker.
Do not skip gates — the sensei will catch violations at stage boundaries.

### Record as you work
Use these commands at natural checkpoints (not after every line of code):

  kata kansatsu record --run-id abc-123 --note "..." --severity info
  kata maki record --run-id abc-123 --name "..." --path "..."
  kata kime record --run-id abc-123 --decision "..." --rationale "..."

### When you're done
Report back to the sensei with a summary of:
- What you produced (artifacts)
- Any decisions you made and why
- Any issues or blockers encountered
Do NOT close the run yourself — the sensei handles run lifecycle.
```

This block is **generated from the manifest**, not hand-written. The sensei
splices it into the Agent tool's `prompt` parameter. Gate conditions are
extracted from the manifest's `entryGate` and `exitGate` fields and rendered
as human-readable instructions.

The `### Injected Learnings` section is appended when the manifest includes
learnings (Tier 1 stage-level + Tier 2 subscriptions). This reuses the
existing `ManifestBuilder.injectLearnings()` formatting.

### What the bridge does (complete)

1. Writes `ExecutionHistoryEntry` to `.kata/history/` (same schema as
   `KiaiRunner.writeHistoryEntry()`).
2. Records token usage if available.
3. Marks the run as complete with a timestamp.
4. Optionally triggers post-run processing (e.g., learning extraction cue).

### Where this lives in the architecture

```
src/
  domain/ports/
    session-bridge.ts          ← ISessionExecutionBridge interface
  infrastructure/execution/
    session-bridge.ts          ← SessionExecutionBridge implementation
  features/execute/
    (KiaiRunner unchanged — used by non-session adapters)
```

The bridge imports from `@domain/services/manifest-builder.js` and
`@domain/types/history.js` — both already exist. It writes to `.kata/` via
the same paths KiaiRunner uses. No new schemas needed; the existing
`ExecutionHistoryEntrySchema` covers the history format.

### CLI surface

The bridge is invoked from the sensei skill via kata CLI commands:

```bash
# ── Cycle-level ──────────────────────────────────────────────

# Prepare all bets in a cycle (returns JSON array of prepared runs)
kata kiai cycle <cycle-id> --prepare --json
→ {
    cycleId: "...",
    cycleName: "Cycle 2",
    preparedRuns: [
      { betId: "...", betName: "...", runId: "...",
        agentContext: "## Kata Run Context\n...",
        isolation: "worktree" },
      { betId: "...", betName: "...", runId: "...",
        agentContext: "## Kata Run Context\n...",
        isolation: "shared" },
    ]
  }

# Check cycle progress mid-execution
kata kiai cycle <cycle-id> --status --json
→ {
    cycleName: "Cycle 2",
    bets: [
      { name: "...", runId: "...", status: "in-progress",
        kansatsuCount: 5, artifactCount: 2, lastActivity: "..." },
      { name: "...", runId: "...", status: "complete",
        kansatsuCount: 8, artifactCount: 4, duration: "1h 23m" },
    ],
    elapsed: "2h 14m",
    budgetUsed: { percent: 43, tokenEstimate: 125000 }
  }

# Complete all runs in a cycle (aggregates results)
kata kiai cycle <cycle-id> --complete --json

# ── Run-level (single bet) ───────────────────────────────────

# Prepare a single bet's run
kata kiai --bet <bet-id> --prepare --json

# Complete a single run after agent finishes
kata kiai complete <run-id> --success --artifacts '...' --notes '...'
```

**`--prepare`** is the key flag: it tells kiai to build the manifest and open
the run, but NOT execute. The response includes the formatted agent context
block that the sensei pastes into the Agent tool prompt.

**`--status`** reads `.kata/` state to aggregate run progress. It counts
kansatsu entries, artifacts, and decisions written by agents. This powers
the sensei's mid-cycle "where are things at?" answers.

**`complete`** writes the history entry and closes the run. At the cycle
level, it aggregates all runs into a cycle summary with total duration
and token usage — ready for cooldown to consume.

### Relationship to existing `StepFlavorExecutor` / `KiaiRunner`

The bridge does NOT replace KiaiRunner or StepFlavorExecutor. Those still handle
the `manual` / `claude-cli` / `composio` paths where `execute()` is synchronous.

The bridge is a parallel path for the same underlying data:

```
Traditional path (adapter controls lifecycle):
  CLI → KiaiRunner → Orchestrator → Executor → Adapter.execute() → History

Session bridge path (sensei controls lifecycle):
  CLI → Bridge.prepareCycle() → [sensei reviews plan]
      → [sensei spawns agents with agentContext]
      → [agents write kansatsu/maki/kime during execution]
      → [sensei calls Bridge.completeCycle()]
      → History + CycleSummary
```

Both paths write to the same `.kata/history/` directory, use the same
`ExecutionHistoryEntrySchema`, and feed the same cooldown/belt/learning
systems.

### End-to-end sensei flow (what the user sees)

This is the complete flow the bridge enables, from cycle planning through
cooldown:

```
User: "Let's kiai the cycle"

Sensei:
  1. kata kiai cycle <id> --prepare --json       ← Bridge: prepare all bets
  2. Review prepared runs, present plan to user
  3. User confirms → sensei spawns agents:
     For each preparedRun:
       Agent(prompt=run.agentContext,
             isolation=run.isolation,
             subagent_type="general-purpose")
  4. Agents execute, writing to shared .kata/:
       kata kansatsu record --run-id <id> ...    ← Agents self-instrument
       kata maki record --run-id <id> ...
  5. Periodically (or on user ask):
     kata kiai cycle <id> --status --json         ← Bridge: cycle status
     → sensei reports progress to user
  6. Gate surfaces:
     → sensei reads .kata/ state, catches missing entry gates
     → human-approval gates surfaced to user via conversation
  7. All agents complete:
     kata kiai cycle <id> --complete --json       ← Bridge: close all runs
  8. Sensei reports cycle summary (duration, tokens, artifacts)
  9. "Ready for cooldown?"
     kata cooldown --prepare                      ← Existing cooldown infra
     kata cooldown                                ← Interactive session
  10. Diary entries (human + Claude perspective)   ← Existing diary system
  11. kata cooldown --complete                     ← Proposals generated
  12. Session ends or /clear for next cycle
```

Steps 1, 5, 7 are the bridge. Everything else is sensei skill (#230),
existing features, or user interaction.

### Worktree investigation: `.claude/worktrees/`

**Finding**: Claude Code creates worktrees at `.claude/worktrees/`, not `.claire/`.
The `isolation: "worktree"` parameter on the Agent tool creates a git worktree
there. The existing `FlavorSchema.isolation` field (`"worktree"` | `"shared"`)
already maps to this.

**Sub-worktrees within worktrees**: Not supported. Claude Code's worktree
mechanism is flat — each agent gets its own worktree from the repo root. An
agent running inside a worktree cannot spawn sub-worktrees within `.claude/`.

**Implication for the bridge**: The bridge doesn't need to manage worktrees.
The sensei passes `isolation: "worktree"` to the Agent tool when the flavor
requires it. Claude Code handles the worktree creation. The bridge's
`formatAgentContext()` includes the **absolute** `.kata/` path so agents write
to the shared data directory regardless of their worktree CWD.

---

## Rabbit holes to avoid

1. **Don't make the bridge implement `IExecutionAdapter`**. The lifecycle split
   is fundamental — pretending it's the same interface creates leaky
   abstractions and forces `execute()` to return incomplete results.

2. **Don't build a polling/watch mechanism for agent completion**. The sensei
   knows when agents complete (they send messages or the Agent tool returns).
   The bridge just needs `complete()` to be called — it doesn't need to watch.

3. **Don't try to capture per-agent token usage automatically**. Claude Code
   doesn't expose per-subagent token metrics. Record what the agent self-reports
   (if anything). Token attribution can be approximate.

4. **Don't build the full orchestration loop into the bridge**. The bridge
   prepares and closes individual runs. Stage sequencing, flavor selection,
   and gate evaluation remain in the sensei skill (or future MetaOrchestrator
   integration). Keep the bridge thin.

5. **Don't implement a new run state machine**. Use the existing
   `ExecutionHistoryEntrySchema` for records. A "run" in the bridge is just
   an open history entry waiting to be completed.

---

## Dependency impact on #230, #231, #232

**#231 (Agent instrumentation context)**: This IS `formatAgentContext()` — it's
a method on the bridge, not a separate system. #231 collapses into #229.

**#230 (Sensei state awareness)**: Independent. The sensei skill reading
`.kata/` state (cycle, bets, run status) doesn't depend on the bridge interface.
Can be shaped and built in parallel.

**#232 (Session context detection)**: Mostly independent. Detecting whether
`.kata/` exists, what cycle is active, whether worktrees are available — this
is startup logic in the sensei skill. The bridge doesn't need to know about
launch modes. Can be shaped independently.

```
              ┌─────────────────────┐
              │  #229 Bridge        │
              │  (prepares runs,    │
              │   formats prompts,  │──────── #231 collapses into this
              │   closes runs)      │
              └──────────┬──────────┘
                         │
          depends on interface being defined
                         │
              ┌──────────▼──────────┐
              │  Sensei skill       │
              │  (uses bridge to    │
              │   run cycles)       │
              └─────────────────────┘
                    │          │
         ┌─────────┘          └──────────┐
         ▼                               ▼
  ┌──────────────┐              ┌──────────────┐
  │  #230        │              │  #232        │
  │  State       │              │  Context     │
  │  awareness   │              │  detection   │
  │  (parallel)  │              │  (parallel)  │
  └──────────────┘              └──────────────┘
```

---

## Related

- Cycle-as-a-Team learnings: `memory/cycle-as-a-team-learnings.md`
- Cycle-as-a-Team design: `memory/cycle-as-team-design.md`
- Sensei skill: `skill/kata-sensei.md`
- Sensei orchestration doc: `docs/sensei-orchestration.md`
- IExecutionAdapter port: `src/domain/ports/execution-adapter.ts`
- KiaiRunner: `src/features/execute/kiai-runner.ts`
- ManifestBuilder: `src/domain/services/manifest-builder.ts`
