# Sensei Orchestration

> How sensei-driven execution actually works today, what Claude Code constrains, and what shape the orchestrator is expected to keep.
>
> Companion documents:
> - [Kataka Architecture](kataka.md) — agent identity, wrapping, attribution
> - [Project Setup](../getting-started/project-setup.md) — project-local agent context and onboarding

---

## Current Reality

The current model is **one top-level orchestrator session**.

- The sensei session owns the whole run or cycle.
- Sensei does not do the implementation work itself.
- Sensei selects the active gyo, chooses the relevant ryu/flavors, and dispatches agents to execute them.
- Those dispatched agents do the actual research, planning, building, and reviewing work.
- Sensei stays above the work: coordinating dispatch, watching progress, checking that logging and artifacts are being recorded, and deciding what happens next.

This is a **delegator-orchestrator** model, not a "single worker agent per bet" model.

---

## Core Constraint

Claude Code allows the top-level session to spawn agents, but spawned agents generally cannot keep recursively spawning more agents in a reliable tree.

That means Kata has to keep orchestration centralized:

- Sensei can fan out work.
- The spawned agents should do the assigned work.
- The spawned agents should not be expected to become orchestrators of further nested agent trees.

In practice, the execution tree is **one layer deep under sensei**.

---

## What Sensei Actually Does

Sensei is responsible for orchestration, not production work.

### Responsibilities

1. Identify the current gyo or next gyo to run.
2. Select the relevant ryu/flavors for that stage.
3. Decide whether those ryu should run in parallel or sequentially.
4. Spawn delegated worker agents to execute the selected ryu.
5. Monitor execution and make sure maki, kime, and kansatsu are being recorded.
6. Handle mon: approvals, escalations, retries, or `--yolo` continuation.
7. Detect gaps and decide whether to bridge them now or defer them.
8. Collect outputs and move the run forward.

### Non-responsibilities

- Writing the code itself.
- Performing the research itself.
- Acting as the primary reviewer of every artifact.
- Handing orchestration off to a spawned agent and expecting that agent to keep delegating.

---

## Execution Shape

The practical execution shape looks like this:

```text
Sensei (top-level orchestrator)
  ↓
select gyo
  ↓
select ryu/flavors for that gyo
  ↓
spawn one or more agents for those ryu
  ↓
agents execute the work
  ↓
sensei monitors, evaluates mon, and advances orchestration
```

If multiple ryu in the same gyo are independent, sensei can run them in parallel. If they depend on each other, sensei runs them in sequence.

The important point is that **sensei remains the orchestrator the whole time**.

---

## Across Bets

Sensei is not limited to managing one bet in isolation.

- It can manage the overall flow across multiple bets in the same cycle.
- It can decide which bet or which stage should run next.
- It can dispatch work for different bets as separate agent tasks when that is the right orchestration strategy.
- It can also serialize bets when coordination cost or dependency risk is too high.

So the architectural center of gravity is:

- one orchestrator for the whole run/cycle
- many delegated executions underneath it

not

- one self-contained worker agent that owns an entire bet from start to finish without orchestration involvement

---

## Relationship To Gyo, Ryu, and Waza

The orchestration model maps cleanly to Kata's execution hierarchy:

- **Gyo** gives sensei the current mode of work.
- **Ryu** gives sensei the available flavor choices within that gyo.
- **Waza** are executed inside the delegated agent's assigned work.

The sensei session mainly reasons at the **gyo/ryu** level. The delegated worker agents mainly operate at the **ryu/waza** level.

---

## Why This Model Fits Claude Code

This model matches the tool constraints well:

- It preserves a single place where dispatch authority lives.
- It avoids recursive agent-management assumptions.
- It allows parallelism where Claude Code supports it.
- It keeps orchestration decisions visible instead of burying them inside a worker agent.

It also keeps failure handling simpler: when something stalls, fails, or stops logging correctly, sensei is still in charge and can respond directly.

---

## Guidance For Current Work

When editing the execution model today:

- Treat sensei as a pure orchestrator/delegator.
- Assume the real work is done by spawned agents, not by sensei.
- Keep orchestration one layer deep under the top-level session.
- Describe nested or recursive agent trees as unsupported unless the platform behavior changes.
- Document stage/flavor fan-out as current behavior; document deeper autonomous delegation as non-current.

---

## Open Design Questions

1. What is the best default granularity for dispatch: per-ryu, per-bet, or hybrid?
2. When multiple bets are active, how much scheduling logic should sensei own explicitly?
3. Which orchestration checks should be automated versus surfaced as human-visible mon?
4. How much synthesis should sensei perform itself versus requiring explicit delegated synthesis passes?
