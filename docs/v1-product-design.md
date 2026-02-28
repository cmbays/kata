# Kata v1 Product Design

> Linear Project Brief — what Kata is, what's in scope for v1, and how we know it's working.
>
> **Companion documents**:
> - [Design Rationale](v1-design-vision.md) — Why Kata is built the way it is
> - [User Journeys](v1-user-journeys.md) — What users can accomplish (stories + story mapping)
> - [Interaction Design](v1-interaction-design.md) — How the user interacts with the system
> - [Kata System Guide](kata-system-guide.md) — How the system works today
> - [Implementation Roadmap](unified-roadmap.md) — What's left to build

---

## Problem Statement

AI coding agents are powerful but structureless. Without methodology, they produce inconsistent results, forget context between runs, repeat mistakes, and give developers no visibility into their reasoning. Solo developers delegating to AI agents need a framework that:

- Provides repeatable structure for complex work (not just "do the thing")
- Tracks execution state so nothing falls through the cracks
- Captures every non-deterministic decision with full context
- Drives self-improvement from accumulated execution data
- Stays observable — the developer can always see what's happening and why

No existing tool fills this gap. Task managers don't encode methodology. Agent frameworks don't capture decisions. CI pipelines don't reflect and improve.

---

## What Kata Is

Kata is a **development methodology engine** — a framework that encodes how AI agents should approach complex work. It provides structure (gyo, ryu, waza, mon), tracks execution state, captures maki (artifacts) and kime (decisions), and drives self-improvement through bunkai (knowledge extraction).

**North star**: A solo developer configures Kata as their methodology framework, then delegates execution to AI agents with minimal, deliberate human touchpoints. The system is **autonomous by default, observable always, and human-in-the-loop only where explicitly configured.**

Kata is the railroad tracks. The AI agent is the train. Different trains (Claude Code, Composio, future tools) run on the same tracks.

---

## v1 Scope

### In scope

| Capability | Description |
|-----------|-------------|
| Three-tier hierarchy | Gyo → ryu → waza with mon (gates), maki (artifacts), and prompt templates |
| Keiko (cycle) management | Time-boxed work periods with bets, budgets, and outcomes |
| 6-phase orchestration | Analyze → match → plan → execute → synthesize → reflect per gyo |
| Kime (decision) tracking | Full context, options, selection, confidence, and outcomes |
| Ma (cooldown) reflection | Bet outcomes, bunkai capture, rule suggestions, proposals, diary entries |
| Dojo training environment | Diary, session generation, HTML output, source registry |
| Kansatsu (observation) system | 7-type observation schema at all hierarchy levels — [Roadmap](unified-roadmap.md) |
| Bunkai (knowledge) graph | Citation-based learnings with reinforcement and versioning — [Roadmap](unified-roadmap.md) |
| Kataka agent wrappers | Methodology-aware AI agent identities — [Roadmap](unified-roadmap.md) |
| Belt progression | Kyū/dan ranking from accumulated practice — [Roadmap](unified-roadmap.md) |

### Out of scope (v2+)

- Strict state machine enforcement (hard-blocking agents from skipping waza)
- MetaOrchestrator-driven kata selection (LLM picks kata patterns automatically)
- Pipeline DAG (non-linear gyo flows — v1 is linear only)
- Wrap-up gyo (5th gyo category after review)
- Multi-user / team coordination
- Composio adapter
- Community kataka registry

---

## Design Constraints

1. **Methodology framework, not agent runtime.** Kata defines the tracks. The agent is the train. No LLM calls, no agent spawning, no code execution.

2. **Optimistic trust in v1.** Mon (gates) are checklists with cues, not hard blocks. Confidence thresholds are cues, not enforcement. All tracing happens regardless of whether the agent follows perfectly.

3. **Schema-first types.** All types are Zod schemas. Schemas are the source of truth — no separate interface definitions.

4. **Append-only kiai data.** Run files (kime, kansatsu, maki) are never modified after writing. Auditability from day one.

5. **Progressive improvement.** Zero configuration still works. The system expands organically through use.

6. **The skill file is the primary agent interface.** A well-written skill package is more important than a complex API.

7. **Themed vocabulary.** Japanese karate aliases are the default experience. `--plain` mode shows English equivalents. See [System Guide — The Kata Lexicon](kata-system-guide.md#11-the-kata-lexicon) for the complete vocabulary.

---

## Success Criteria

1. **A solo developer can delegate a multi-stage bet to an AI agent and receive structured, auditable output.** The run tree captures every kime, maki, and state transition.

2. **Cooldown produces actionable improvements.** Rule suggestions, bunkai, proposals, and diary entries that make the next keiko measurably better.

3. **The system compounds over time.** A project with 10 keiko of history produces better orchestration decisions than a fresh project — evidenced by higher kime confidence, fewer gaps, and more targeted ryu selection.

4. **Observable at every level.** `kata status`, `kata kanshi`, and `kata stats` give complete visibility without reading raw files.

5. **Zero-to-running in under 5 minutes.** `kata rei` + a first `kata kiai` with built-in defaults — no mandatory configuration.

---

## Core Principles

1. **Methodology framework, not agent runtime.** Kata provides structure. Agents provide intelligence.

2. **Optimistic trust.** Mon are checklists, not barriers. Trust the agent to follow methodology honestly.

3. **Quantitative from structure, qualitative from LLM.** Confidence scores come from citation counts and evidence consistency — not from asking an LLM "how confident are you?"

4. **Capture all, analyze selectively.** Kansatsu are captured at every hierarchy level during kiai (cheap). Analysis happens only during ma (expensive).

5. **Soft delete only.** Bunkai is never hard-deleted — only archived. The graph preserves provenance.

6. **Progressive improvement.** A fresh project and a mature one use the same primitives — the mature one just has more accumulated bunkai.

---

*This is a living document. See [Implementation Roadmap](unified-roadmap.md) for what's shipped and what's next.*
