# Kata System Guide

> Living reference for how Kata works — its primitives, data flows, and the meta-learning loop that makes the system compound over time. Written for humans.
>
> **Companion documents** (deep dives):
> - [Product Design](v1-product-spec.md) — User stories, interaction breadboards, and agent interface patterns
> - [Design Rationale](v1-design-vision.md) — Why Kata is built the way it is: architectural trade-offs and decisions
> - [Meta-Learning Architecture](meta-learning-architecture.md) — Observation system, knowledge graph, self-improvement loop
> - [Dojo Architecture](dojo-architecture.md) — Personal training environment: diary, sessions, design system
> - [Kataka Architecture](kataka-architecture.md) — Agent system deep dive: kataka, skills, three-layer model, gap bridging
> - [Implementation Roadmap](unified-roadmap.md) — Waves, dependencies, and what's left to build
>
> **Implementation status key**: Features marked with a wave label like *(Wave F)* are designed but not yet implemented. Unmarked features are shipped and tested.

---

## 1. What Kata Is

Kata is a **development methodology engine**. It encodes how AI agents should approach complex work — providing structure, tracking execution, capturing decisions, and driving self-improvement.

Kata is the railroad tracks. The AI agent is the train. Different trains (Claude Code, Composio, future tools) run on the same tracks.

**What Kata does:**
- Defines methodology as composable gyo (stages), ryu (flavors), and waza (steps)
- Tracks execution state through structured run files
- Captures every non-deterministic kime (decision) with full context
- Observes patterns, frictions, and outcomes during execution *(kansatsu observation system ships in Wave F)*
- Builds a bunkai (knowledge) graph that improves agents over time *(enrichment ships in Waves F–I)*
- Reflects during ma (cooldown) to extract and consolidate learnings

**What Kata does NOT do:**
- Execute agents or make LLM calls itself
- Enforce hard blocks (v1 mon (gates) are checklists with cues, not barriers)
- Require specific AI providers or tools

---

## 2. The Execution Hierarchy

Kata organizes work into three tiers:

```
Gyo (stage — mode of work: research, plan, build, review, wrap-up)
  └─ Ryu (flavor — named composition of steps: "tdd-build", "pair-review")
       └─ Waza (step — atomic unit: mon, artifacts, prompts)
```

### Gyo (Stages)
Five fixed categories representing fundamentally different modes of work. Each gyo has an orchestrator that selects ryu, manages execution, and produces a synthesis artifact as handoff to the next gyo.

### Ryu (Flavors)
User-configurable compositions of waza. A build gyo might run a "tdd" ryu (write-tests → implement → refactor) alongside a "pair-review" ryu. Multiple ryu can run within a gyo, parallel or sequential.

### Waza (Steps)
Atomic work units. Each waza has iri-mon / de-mon (entry/exit gates), produces artifacts, can require human approval, and has a prompt template that guides the agent. Waza are reusable across ryu.

---

## 3. The Execution Lifecycle

A single kiai (execution) flows through this lifecycle:

```
Keiko (cycle — time-boxed work period with budget)
  └─ Bet (scoped unit of work — "Build user auth")
       └─ Run (execution of a bet through its gyo sequence)
            └─ Gyo execution (per stage in sequence)
                 └─ Ryu execution (per selected flavor)
                      └─ Waza execution (per step in flavor)
```

### Keiko (Cycles) and Bets
A **keiko** (cycle) is a time-boxed work period (inspired by Shape Up's 6-week cycles) with a token budget. Each keiko contains **bets** — scoped units of work with an appetite (budget allocation) and an expected outcome.

### Runs
When a bet starts execution, it creates a **run** — a directory tree that tracks everything that happens:

```
.kata/runs/{run-id}/
  run.json                          # Run metadata, status, gyo sequence
  decisions.jsonl                   # Every kime made during the run
  decision-outcomes.jsonl           # Retrospective quality assessments
  artifact-index.jsonl              # Registry of all produced artifacts
  observations.jsonl                # Cross-stage observations (Wave F)
  stages/{category}/
    state.json                      # Gyo status, selected ryu, gaps
    observations.jsonl              # Gyo-scoped kansatsu (Wave F)
    reflections.jsonl               # Gyo-scoped reflections (Wave F)
    flavors/{name}/
      state.json                    # Ryu status, waza progress
      observations.jsonl            # Ryu-scoped kansatsu (Wave F)
      artifact-index.jsonl          # Ryu's artifacts
      artifacts/                    # Actual artifact files
      synthesis.md                  # Ryu synthesis output
    synthesis.md                    # Gyo synthesis (handoff to next gyo)
```

Every file in the run tree is append-only or write-once. Nothing is deleted during execution. This creates a complete, auditable record of what happened.

> **Status**: Run tree, state files, kime, artifacts, and kime outcomes are implemented and tested. Kansatsu (observation) and reflection JSONL files at gyo/ryu/waza levels ship in Wave F.

### Ma (Cooldown)
After all bets complete, the keiko enters **ma** (cooldown) — a structured reflection phase:

1. Record bet outcomes (complete / partial / abandoned)
2. Enrich with token usage data
3. Load run summaries (gyo completed, gaps found, kime made)
4. Generate proposals for the next keiko
5. Surface rule suggestions from the orchestration engine
6. Capture bunkai (learnings) into the knowledge store
7. Write a diary entry (narrative reflection for the Dojo)
8. Transition keiko to complete

---

## 4. The Data Model

Kata uses four categories of persistent data:

### Seido (Configuration) — write-rarely
- `.kata/config.json` — Project settings (methodology, adapter, confidence threshold, experience level)
- `.kata/stages/` — Waza definitions, ryu compositions, gyo vocabularies
- `.kata/rules/` — Accumulated orchestration rules (boost, penalize, require, exclude)

### Kiai (Execution State) — write-during-run
- `.kata/runs/` — Run trees with state files, kime, artifacts, kansatsu
- `.kata/cycles/` — Keiko records with bets, budgets, outcomes
- `.kata/tracking/` — Token usage per run

### Bunkai (Knowledge) — write-during-ma
- `.kata/knowledge/` — Individual learning files + graph index
- `.kata/dojo/diary/` — Narrative reflections per keiko
- `.kata/dojo/sessions/` — Generated Dojo training sessions

### Context *(Wave F)* (write-at-init, refresh-at-cooldown)
- `.kata/KATA.md` — Project context file for all agents and skills

---

## 5. The Kansatsu (Observation) System *(Wave F)*

> See [Meta-Learning Architecture](meta-learning-architecture.md) for the full deep dive on kansatsu, the knowledge graph, and the self-improvement loop.

Kansatsu (observations) are the raw signals captured during kiai — the primary input to the entire meta-learning system. Seven types (kime, prediction, friction, gap, outcome, assumption, insight) are recorded as append-only JSONL at every level of the execution hierarchy (run, gyo, ryu, waza). Once written, kansatsu are never modified — creating an immutable audit trail that the bunkai graph builds on.

---

## 6. The Bunkai (Knowledge) Graph *(Waves F–I)*

> See [Meta-Learning Architecture](meta-learning-architecture.md) for the full deep dive including learning schema fields, graph emergence, detection engines, and LLM synthesis.

The bunkai graph transforms raw kansatsu into working knowledge. It has three layers: **kansatsu** (immutable JSONL), **learnings** (versioned JSON with citations, confidence, lineage), and a **graph index** (lightweight edges making the graph traversable). Knowledge emerges bottom-up — kansatsu accumulate, pattern detection creates learnings with citations, reinforcement strengthens them, and LLM synthesis consolidates them into higher-order insights. The basic bunkai store (learnings, capture, query, loading) is shipped. Graph enrichments — citations, reinforcement, versioning, permanence, detection engines, LLM synthesis — ship progressively across Waves F through I.

---

## 7. The Self-Improvement Loop

> See [Meta-Learning Architecture](meta-learning-architecture.md) for the full loop diagram and detailed walkthrough of each phase.

The self-improvement loop is the mechanism that makes Kata compound over time: **Kiai** (agents run gyo, kansatsu pile up) → **Ma** (pattern detection, learning creation, synthesis) → **Bunkai Store** (learnings with citations, confidence scores, graph edges) → **Manifest Builder** (reads learnings, injects into agent prompts) → **Next Kiai** (agent has better context). Each keiko adds kansatsu, strengthens learnings, and produces better prompts. The system gets better through use — not through manual configuration.

---

## 8. The Dojo — Personal Training Environment *(Wave K — Shipped)*

> See [Dojo Architecture](dojo-architecture.md) for the full deep dive on diary entries, session generation, the design system, and the source registry.

The Dojo transforms Kata's kiai (execution) data into an interactive training experience for the developer. Each session covers four knowledge directions: **ushiro** (backward — what happened), **uchi** (inward — current state + personal focus), **soto** (outward — industry best practices), and **mae** (forward — what's next). After each ma (cooldown), a diary entry captures the keiko's narrative. Sessions are self-contained HTML experiences with a Japanese dojo theme, generated through conversation with Claude and saved as a personal training archive.

---

## 9. The Kataka System — Methodology-Aware Agents *(Wave G)*

> The kataka system is designed and architected. Implementation ships in Wave G. See [Kataka Architecture](kataka-architecture.md) for the full deep dive.

Kataka (型家, "kata practitioner") is the Kata-native AI agent wrapper. The `-ka` suffix signals a methodology-aware agent.

### Three-Layer Agent Model

```
Context Layer    KATA.md — project-wide context, always loaded
                 ↕
Skill Layer      verb-object naming (e.g., run-stage, review-code)
                 Instructions that guide agent behavior
                 ↕
Agent Layer      noun-ka naming (e.g., scout-ka, architect-ka)
                 Claude Code subagent definitions wrapping skills
```

### Agent Attribution
Every kansatsu, kime, and artifact can be attributed to a specific kataka via `katakaId`. This enables per-agent performance analysis: which kataka make good kime? Which ones produce frictions?

---

## 10. Data Store Summary

| Store | Location | Format | Write pattern | Read pattern |
|-------|----------|--------|--------------|-------------|
| Seido (config) | `.kata/config.json` | JSON | Write-once at rei | Read at every command |
| Waza (steps) | `.kata/stages/{category}/steps/` | JSON | CRUD via CLI | Read by ManifestBuilder |
| Ryu (flavors) | `.kata/stages/{category}/flavors/` | JSON | CRUD via CLI | Read by orchestrator |
| Keiko (cycles) | `.kata/cycles/{id}.json` | JSON | Created by `kata keiko new` | Read by ma |
| Runs | `.kata/runs/{id}/` | JSON + JSONL | Written during kiai | Read by ma, Dojo |
| Kime (decisions) | `.kata/runs/{id}/decisions.jsonl` | JSONL (append-only) | Appended during kiai | Read by ma, Dojo |
| Kansatsu (observations) | `.kata/runs/{id}/**/observations.jsonl` | JSONL (append-only) | Appended during kiai | Read by LearningExtractor |
| Bunkai (learnings) | `.kata/knowledge/learnings/{id}.json` | JSON (versioned) | Created/updated in ma | Read by ManifestBuilder |
| Graph Index | `.kata/knowledge/graph-index.json` | JSON | Updated in ma | Read for traversal |
| Rules | `.kata/rules/{id}.json` | JSON | Created in ma | Read by orchestrator |
| Diary | `.kata/dojo/diary/{keiko-id}.json` | JSON | Written in ma | Read by Dojo |
| Sessions | `.kata/dojo/sessions/{id}/` | JSON + HTML | Generated by Dojo | Opened in browser |
| Sources | `.kata/dojo/sources.json` | JSON | CRUD via CLI | Read by research kataka |
| Context | `.kata/KATA.md` | Markdown | Rei + ma refresh | Read by all kataka |
| Token Usage | `.kata/tracking/` | JSON | Written during kiai | Read by ma |

---

## 11. CLI Command Map

Themed aliases are the default experience. Use `--plain` to see English equivalents.

| Themed | English | Purpose | Status |
|--------|---------|---------|--------|
| `kata rei` | `kata init` | Initialize a project | Shipped |
| `kata gyo` | `kata stage` | Manage the 4 gyo (stage categories) | Shipped |
| `kata waza` | `kata step` | CRUD for atomic waza (work units) | Shipped |
| `kata ryu` | `kata flavor` | Manage ryu (step compositions) | Shipped |
| `kata keiko` | `kata cycle` | Time-boxed keiko (work periods) | Shipped |
| `kata kiai` | `kata execute` | Run gyo orchestration | Shipped |
| `kata kime` | `kata decision` | Record and review kime (decisions) | Shipped |
| `kata bunkai` | `kata knowledge` | Query and manage learnings | Shipped |
| `kata ma` | `kata cooldown` | Keiko reflection | Shipped |
| `kata seido` | `kata config` | Interactive methodology editor | Shipped |
| `kata dojo` | `kata dojo` | Personal training environment | Shipped |
| `kata status` | `kata status` | Project overview | Shipped |
| `kata stats` | `kata stats` | Aggregate analytics | Shipped |
| `kata kanshi` | `kata watch` | Live kiai TUI | Shipped |
| `kata approve` | `kata approve` | Approve pending mon (human gates) | Shipped |
| `kata artifact` | `kata artifact` | Record artifacts with provenance | Shipped |
| `kata rule` | `kata rule` | Accept/reject rule suggestions | Shipped |
| `kata kansatsu` | `kata observe` | Record runtime kansatsu (observations) | Wave F |
| `kata kataka` | `kata agent` | Manage kataka (agents) | Wave G |
| `kata kotoba` | `kata lexicon` | Interactive vocabulary table | Wave G |

---

## 12. Design Principles

1. **Schema-first types.** All types are Zod schemas. Schemas are the source of truth — no separate interface definitions.

2. **Append-only kiai data.** Run files (kime, kansatsu, artifacts) are never modified after writing. This ensures auditability and stable graph foundations.

3. **Quantitative from structure, qualitative from LLM.** Confidence scores come from citation counts and evidence consistency — not from asking an LLM "how confident are you?" LLMs provide the qualitative synthesis; structure provides the numbers.

4. **Progressive improvement.** Zero seido (configuration) still works. Rules, bunkai, and vocabulary expand organically through use. A fresh Kata project and a mature one use the same primitives — the mature one just has more accumulated bunkai.

5. **Capture all, analyze selectively.** Kansatsu are captured at every hierarchy level during kiai (cheap, append-only). Analysis happens only during ma (expensive, LLM-powered). This separates hot-path writes from cold-path reasoning.

6. **Soft delete only.** Learnings are never hard-deleted — they're archived. The graph preserves provenance even for bunkai that has been superseded. You can always trace back to the raw kansatsu.

7. **The skill file is the primary interface.** For AI consumers, a well-written skill package is more important than a complex API. The agent reads methodology instructions, uses CLI for structured operations, and reads state files directly.

---

*Last updated: 2026-02-28. Waves 0–E + K shipped (2148 tests, 109 files). This is a living document — updated as new waves ship.*
