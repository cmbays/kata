# Kata v1 Design Rationale — ADR Decision Log

> Why Kata is built the way it is — architectural trade-offs and decisions that shaped the system, in ADR format (Context → Decision → Consequences).
>
> For *how* the system works, see [Kata System Guide](kata-system-guide.md).
> For *what's left to build*, see [Implementation Roadmap](unified-roadmap.md).

## Core Thesis

Kata separates **deterministic structure** (waza, mon, maki, seido) from **non-deterministic judgment** (orchestrators deciding how to compose and sequence that structure). The kime (decision) log bridges them — making non-deterministic choices visible, measurable, and learnable.

---

## ADR-1: Three-Tier Execution Hierarchy

**Context**: The original codebase had a flat "Stage" concept that conflated modes of work with atomic tasks. Users needed both fixed methodology categories and flexible, user-configurable workflows.

**Decision**: Three tiers — gyo (fixed enum: research/plan/build/review) → ryu (user-configurable compositions) → waza (atomic reusable units). Gyo are modes of work; ryu are workflows; waza are the building blocks.

**Consequences**: Clean separation of concerns. Users can customize ryu and waza without touching the fixed gyo structure. Multiple ryu can run within a single gyo (parallel or sequential). Waza are reusable across ryu (many-to-many). Hierarchical overrides allow ryu to override scoped waza properties while keeping mon conditions and maki requirements immutable.

---

## ADR-2: Kime as First-Class Domain Concept

**Context**: Existing agent frameworks don't capture decision reasoning. When an agent picks one approach over another, the reasoning and alternatives are lost.

**Decision**: Every orchestrator kime is logged with context, options, selection, confidence, and post-facto outcome. Kime are the primary input to the self-improvement system.

**Consequences**: Full observability into agent reasoning. Bunkai (learning) extraction analyzes kime quality over time. Low-confidence kime surface in ma (cooldown) for human review. `--yolo` mode bypasses human approval but preserves the kime trail for post-hoc review.

---

## ADR-3: Gyo Orchestrator as Intelligence Layer

**Context**: A simple ryu selector would be insufficient. The orchestrator needs to receive context, review available ryu, consult past kime and outcomes, and make reasoned selections.

**Decision**: Built-in orchestrator prompt per gyo type that runs a 6-phase loop: analyze → match → plan → execute → synthesize → reflect. LLM-driven kime with minimal required configuration.

**Consequences**: Orchestration improves through accumulated bunkai and rules. Gap analysis identifies uncovered areas. Synthesis is automatic (not user-configured). The reflect phase feeds rule suggestions back into the system.

---

## ADR-4: Maki Scoping Rules

**Context**: When multiple ryu run in parallel within a gyo, artifact visibility needs clear boundaries to prevent cross-contamination and ordering issues.

**Decision**: Within a ryu, a waza can reference maki from preceding waza. A waza can reference the gyo-level input maki (handoff from prior gyo). A waza **cannot** reference maki from other ryu running in parallel. Cross-ryu aggregation happens only at synthesis.

**Consequences**: Ryu are independent and parallelizable. DAG validation on save ensures each waza's iri-mon (entry gate) requirements are satisfiable. Clear error messages when ordering violates dependencies.

---

## ADR-5: Optimistic Trust in v1

**Context**: Runtime enforcement (hard-blocking agents from skipping waza) adds significant complexity and limits agent flexibility.

**Decision**: Mon are checklists with cues, not hard blocks. Confidence thresholds are cues, not enforcement. All tracing happens regardless. Strict enforcement deferred to v2/v3.

**Consequences**: Simpler implementation. Agents can work around methodology limitations when needed. Complete audit trail still captured for ma review. Risk: agents may skip steps, but the kime/maki/kansatsu trail reveals it.

---

## ADR-6: Ma as Structured Reflection

**Context**: Cooldown needs to bridge keiko — reading all run data, generating proposals, and feeding improvements forward.

**Decision**: Ma (cooldown) is a structured feature with an 8-step orchestration: bet outcomes → token enrichment → run summaries → proposals → rule suggestions → bunkai capture → diary entry → transition. Not a pipeline kind — a dedicated feature.

**Consequences**: Rich reflection without requiring pipeline infrastructure. Output (proposals, bunkai, rules) directly improves the next keiko. Diary entries feed the Dojo training environment.

---

## ADR-7: Pipeline as DAG (Design For, Not Implement)

**Context**: v1 uses linear gyo flows (research → plan → build → review). Future versions may need non-linear flows.

**Decision**: Model the data as a DAG from the start. v1 only uses linear flows. Budget constraints (token/time) would govern cycle count in future DAG mode.

**Consequences**: No data model migration needed when DAG flows ship. v1 stays simple while preserving future flexibility.

---

## ADR-8: Build Gyo Philosophy

**Context**: Kata's primary value is in research, planning, and review — structuring the thinking around work. Build is where agents do what they already do well.

**Decision**: Build gyo is lightest-touch. Iri-mon: solid implementation plan from plan gyo. De-mon: PR-ready state with passing tests. Internal orchestration is mostly "hand this to the build agent." Mini-reviews within build waves; final holistic review is a separate review gyo.

**Consequences**: Kata adds value where agents need it most (methodology) without over-structuring what they already do well (coding). Review as a separate gyo ensures quality assessment isn't rushed.

---

## ADR-9: Self-Improvement Through Structure

**Context**: AI agents need to get better over time, but "how confident are you?" produces hallucinated confidence scores.

**Decision**: Quantitative confidence from structure (citation counts, evidence consistency, reinforcement history). Qualitative synthesis from LLM. Bunkai is never hard-deleted — archived with provenance. The system improves through accumulated kansatsu and evidence-based bunkai, not through manual tuning.

**Consequences**: Confidence scores you can trust. Progressive improvement through use. Full provenance trail. The bunkai graph grows more valuable with each keiko.

---

*For the full meta-learning system, see [Meta-Learning Architecture](meta-learning-architecture.md). For implementation status, see [Roadmap](unified-roadmap.md).*
