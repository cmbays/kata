# Kata System Guide

> Living reference for how Kata works — its primitives, data flows, and the meta-learning loop that makes the system compound over time. Written for humans.
>
> **Companion documents** (deep dives):
> - [Product Design](v1-product-spec.md) — User stories, interaction breadboards, and agent interface patterns
> - [Design Rationale](v1-design-vision.md) — Why Kata is built the way it is: architectural trade-offs and decisions
> - [Kataka Architecture](kataka-architecture.md) — Agent system deep dive: kataka, skills, three-layer model, gap bridging
> - [Implementation Roadmap](unified-roadmap.md) — Waves, dependencies, and what's left to build
>
> **Implementation status key**: Features marked with a wave label like *(Wave F)* are designed but not yet implemented. Unmarked features are shipped and tested.

---

## 1. What Kata Is

Kata is a **development methodology engine**. It encodes how AI agents should approach complex work — providing structure, tracking execution, capturing decisions, and driving self-improvement.

Kata is the railroad tracks. The AI agent is the train. Different trains (Claude Code, Composio, future tools) run on the same tracks.

**What Kata does:**
- Defines methodology as composable stages, flavors, and steps
- Tracks execution state through structured run files
- Captures every non-deterministic decision with full context
- Observes patterns, frictions, and outcomes during execution *(observation system ships in Wave F)*
- Builds a knowledge graph that improves agents over time *(knowledge graph enrichment ships in Waves F–I)*
- Reflects during cooldown to extract and consolidate learnings

**What Kata does NOT do:**
- Execute agents or make LLM calls itself
- Enforce hard blocks (v1 gates are checklists with cues, not barriers)
- Require specific AI providers or tools

---

## 2. The Execution Hierarchy

Kata organizes work into three tiers:

```
Stage (mode of work — research, plan, build, review, wrap-up)
  └─ Flavor (named composition of steps — "tdd-build", "pair-review")
       └─ Step (atomic unit — entry gates, exit gates, artifacts, prompts)
```

### Stages
Five fixed categories representing fundamentally different modes of work. Each stage has an orchestrator that selects flavors, manages execution, and produces a synthesis artifact as handoff to the next stage.

### Flavors
User-configurable compositions of steps. A build stage might run a "tdd" flavor (write-tests → implement → refactor) alongside a "pair-review" flavor. Multiple flavors can run within a stage, parallel or sequential.

### Steps
Atomic work units. Each step has entry/exit gates, produces artifacts, can require human approval, and has a prompt template that guides the agent. Steps are reusable across flavors.

---

## 3. The Execution Lifecycle

A single execution flows through this lifecycle:

```
Cycle (time-boxed work period with budget)
  └─ Bet (scoped unit of work — "Build user auth")
       └─ Run (execution of a bet through its stage sequence)
            └─ Stage execution (per stage in sequence)
                 └─ Flavor execution (per selected flavor)
                      └─ Step execution (per step in flavor)
```

### Cycles and Bets
A **cycle** is a time-boxed work period (inspired by Shape Up's 6-week cycles) with a token budget. Each cycle contains **bets** — scoped units of work with an appetite (budget allocation) and an expected outcome.

### Runs
When a bet starts execution, it creates a **run** — a directory tree that tracks everything that happens:

```
.kata/runs/{run-id}/
  run.json                          # Run metadata, status, stage sequence
  decisions.jsonl                   # Every decision made during the run
  decision-outcomes.jsonl           # Retrospective quality assessments
  artifact-index.jsonl              # Registry of all produced artifacts
  observations.jsonl                # Cross-stage observations (Wave F)
  stages/{category}/
    state.json                      # Stage status, selected flavors, gaps
    observations.jsonl              # Stage-scoped observations (Wave F)
    reflections.jsonl               # Stage-scoped reflections (Wave F)
    flavors/{name}/
      state.json                    # Flavor status, step progress
      observations.jsonl            # Flavor-scoped observations (Wave F)
      artifact-index.jsonl          # Flavor's artifacts
      artifacts/                    # Actual artifact files
      synthesis.md                  # Flavor synthesis output
    synthesis.md                    # Stage synthesis (handoff to next stage)
```

Every file in the run tree is append-only or write-once. Nothing is deleted during execution. This creates a complete, auditable record of what happened.

> **Status**: Run tree, state files, decisions, artifacts, and decision-outcomes are implemented and tested. Observation and reflection JSONL files at stage/flavor/step levels ship in Wave F.

### Cooldown
After all bets complete, the cycle enters **cooldown** — a structured reflection phase:

1. Record bet outcomes (complete / partial / abandoned)
2. Enrich with token usage data
3. Load run summaries (stages completed, gaps found, decisions made)
4. Generate proposals for the next cycle
5. Surface rule suggestions from the orchestration engine
6. Capture learnings into the knowledge store
7. Write a diary entry (narrative reflection for the Dojo)
8. Transition cycle to complete

---

## 4. The Data Model

Kata uses four categories of persistent data:

### Configuration (write-rarely)
- `.kata/config.json` — Project settings (methodology, adapter, confidence threshold, experience level)
- `.kata/stages/` — Step definitions, flavor compositions, stage vocabularies
- `.kata/rules/` — Accumulated orchestration rules (boost, penalize, require, exclude)

### Execution State (write-during-run)
- `.kata/runs/` — Run trees with state files, decisions, artifacts, observations
- `.kata/cycles/` — Cycle records with bets, budgets, outcomes
- `.kata/tracking/` — Token usage per run

### Knowledge (write-during-cooldown)
- `.kata/knowledge/` — Individual learning files + graph index
- `.kata/dojo/diary/` — Narrative reflections per cycle
- `.kata/dojo/sessions/` — Generated Dojo training sessions

### Context *(Wave F)* (write-at-init, refresh-at-cooldown)
- `.kata/KATA.md` — Project context file for all agents and skills

---

## 5. The Observation System *(Wave F)*

> This section describes the observation system designed for Wave F. The schema and infrastructure are not yet implemented.

Observations are the raw signals captured during execution — the primary input to the entire meta-learning system.

### Seven Observation Types

| Type | What it captures | Example |
|------|-----------------|---------|
| **Decision** | A choice made among options | "Selected TDD flavor for build stage (confidence: 0.85)" |
| **Prediction** | An expected outcome to verify later | "This approach will reduce test failures by 50%" |
| **Friction** | A contradiction or tension detected | "Style guide says X but codebase uses Y" |
| **Gap** | A capability or knowledge missing | "No tests for error handling paths" |
| **Outcome** | What actually happened | "Build completed in 3 minutes, 0 failures" |
| **Assumption** | Something taken as true without verification | "Assuming the API supports pagination" |
| **Insight** | A mid-execution realization | "This pattern appears in 3 other modules" |

### Hierarchy
Observations can be captured at any level of the execution hierarchy:
- **Run-level**: Cross-stage insights
- **Stage-level**: Stage-wide patterns
- **Flavor-level**: Flavor-specific signals
- **Step-level**: Granular per-step observations

### Immutability
Observations are **append-only JSONL**. Once written, they are never modified or deleted. This creates an immutable audit trail and ensures the knowledge graph has stable foundations.

---

## 6. The Knowledge Graph *(Waves F–I)*

> The knowledge store exists today (learnings, capture, query, loading). The enrichments described here — citations, reinforcement, versioning, graph index, and LLM synthesis — ship progressively across Waves F through I.

The knowledge graph is the architectural heart of Kata's meta-learning system. It transforms raw observations into working knowledge that improves agent behavior over time.

### Three Layers

```
Layer 3: GRAPH INDEX
  .kata/knowledge/graph-index.json
  Lightweight connective tissue — IDs and edges only.
  Makes the graph traversable without loading every learning file.
      │
      ▼
Layer 2: LEARNINGS (mutable, versioned)
  .kata/knowledge/learnings/{uuid}.json
  Working knowledge derived from observations.
  Each learning has citations, lineage, versions, confidence.
      │
      ▼
Layer 1: OBSERVATIONS (immutable, append-only)
  .kata/runs/{id}/stages/{cat}/observations.jsonl
  Raw signals captured during execution. Never modified.
```

### How Knowledge Emerges

The graph is not designed top-down — it emerges from bottom-up evidence accumulation:

**1. Capture** — During execution, observations accumulate as timestamped JSONL entries. No relationships exist yet. Just raw events.

**2. Pattern detection** — During cooldown, the LearningExtractor reads observations across a run. It finds patterns: "friction about test coverage appeared in 3 different stages" or "predictions about build time were consistently off." Each pattern becomes a learning candidate.

**3. Learning creation with citations** — When a learning is created, it carries `citations[]` — direct links back to the raw observations that spawned it. This is the first graph edge. The learning knows exactly what evidence supports it.

```
Learning: "TDD significantly reduces rework in this codebase"
  ├── Citation: run-1/build/obs-3 (friction: "had to rewrite without tests")
  ├── Citation: run-2/build/obs-7 (outcome: "TDD run had 0 rework cycles")
  └── Citation: run-3/build/obs-2 (insight: "test-first caught design issue early")
```

**4. Reinforcement** — In subsequent runs, similar observations appear. Instead of creating duplicate learnings, the system finds the existing one and adds to `reinforcedBy[]`. The learning's confidence increases based on real evidence count, not LLM estimation.

**5. Synthesis** — During cooldown (Wave I), LLM synthesis reads multiple related learnings and may consolidate them. "These 4 stage-level learnings about test coverage are really one category-level insight." The synthesized learning gets `derivedFrom[]` — creating parent-child relationships in the graph.

```
Category Learning: "Test coverage correlates with code stability"
  ├── derivedFrom: "TDD reduces rework" (stage learning, build)
  ├── derivedFrom: "Untested modules have 3x more bugs" (stage learning, review)
  └── derivedFrom: "Coverage gaps predict production issues" (stage learning, review)
```

**6. Versioning** — If a learning is updated (new evidence contradicts it, user overrides it), the previous state is pushed to `versions[]` with a `citationsDiff` showing what evidence changed. The graph preserves its full history — you can always see how knowledge evolved.

### Learning Schema (key fields)

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Unique identifier |
| `tier` | enum | Scope: step, flavor, stage, category, agent |
| `content` | string | The knowledge itself |
| `confidence` | 0–1 | Computed from evidence count and consistency |
| `citations` | Citation[] | Links to source observations *(Wave F)* |
| `derivedFrom` | UUID[] | Parent learnings this was synthesized from *(Wave F)* |
| `reinforcedBy` | Reinforcement[] | Additional evidence that strengthened this *(Wave F)* |
| `usageCount` | number | Times injected into agent prompts *(Wave F)* |
| `lastUsedAt` | datetime | When last used in a prompt *(Wave F)* |
| `versions` | Version[] | Full mutation history with citation diffs *(Wave F)* |
| `archived` | boolean | Soft-delete (never hard-deleted — provenance) *(Wave F)* |

### What the Graph Enables

| Capability | How |
|-----------|-----|
| **Provenance** | "Why does Kata believe X?" → follow citations to raw observations |
| **Evidence-based confidence** | More citations + reinforcements = higher confidence (quantitative, not hallucinated) |
| **Contradiction detection** | Two learnings with conflicting content + overlapping citations = friction signal |
| **Knowledge decay** | Learnings without recent reinforcement lose relevance over time |
| **Impact analysis** | "If I archive this observation, which learnings lose evidence?" |
| **Synthesis quality** | LLM sees full evidence chains when consolidating — better reasoning |
| **Agent context** | Kataka agents receive learnings with provenance, can assess trustworthiness |
| **Resurrection** | Archived learning matching new observations → unarchive with fresh citations |

### How Agents Use the Graph

When a kataka agent starts a stage, the ManifestBuilder injects relevant learnings into its prompt. With the graph, those learnings come with provenance:

```
Learning: "TDD approach reduces rework by ~40% in this codebase"
  Confidence: 0.85 (based on 6 observations across 3 runs)
  Reinforced: 2 times in the last cycle
  Derived from: 2 stage-level learnings about test coverage
```

The agent can make informed decisions about how much to trust each learning. A learning with 6 citations across 3 runs is more trustworthy than one with 1 citation from 1 run. This is **quantitative trust from structure** — not hallucinated confidence scores.

---

## 7. The Self-Improvement Loop

The complete loop that makes Kata compound over time:

```
                    ┌─────────────────────┐
                    │   EXECUTION         │
                    │   Agent runs stages  │
                    │   Observations pile  │
                    │   up as JSONL        │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   COOLDOWN          │
                    │   Pattern detection  │
                    │   Learning creation  │
                    │   Synthesis          │
                    │   Graph updates      │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   KNOWLEDGE STORE   │
                    │   Learnings + graph  │
                    │   Citations + edges  │
                    │   Confidence scores  │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   MANIFEST BUILDER  │
                    │   Reads learnings    │
                    │   Injects into       │
                    │   agent prompts      │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   NEXT EXECUTION    │
                    │   Agent has better   │
                    │   context from       │
                    │   accumulated        │
                    │   knowledge          │
                    └─────────────────────┘
```

Each cycle through the loop adds observations, strengthens or creates learnings, updates the graph, and produces better prompts for the next run. The system gets better through use — not through manual configuration.

### Observation Capture → Learning Extraction

The LearningExtractor detects patterns across observations:
- **Frequency patterns**: Same observation type appearing 3+ times → potential learning
- **Prediction calibration**: Predictions checked against outcomes → confidence adjustment
- **Friction clustering**: Related frictions across stages → systemic issue
- **Gap recurrence**: Same gap appearing across runs → unaddressed problem

### Learning Injection → Better Decisions

The ManifestBuilder reads learnings relevant to the upcoming stage and injects them into the agent's prompt context. The agent then has accumulated project knowledge — not just the current task description — when making decisions.

### Decision Tracking → Outcome Measurement

Every decision is logged with context, options, reasoning, and confidence. Later, outcomes are recorded against those decisions. Over time, this reveals which types of decisions lead to good outcomes and which don't — enabling the system to adjust confidence thresholds and rule weights.

---

## 8. The Dojo — Personal Training Environment *(Wave K — Shipped)*

The Dojo transforms Kata's execution data into an interactive training experience for the developer. It has four knowledge directions:

| Direction | What it covers | Data sources |
|-----------|---------------|-------------|
| **Backward** | What happened, what worked, what didn't | Diary entries, run summaries, decision outcomes |
| **Inward** | Current project state, personal focus areas | Knowledge stats, flavor frequency, user reflections |
| **Outward** | Industry best practices for your stack | Curated external sources, research agents |
| **Forward** | What's next, what to prepare for | Proposals, roadmap items, open questions |

### Diary Entries
After each cooldown, a diary entry captures the narrative of the cycle — wins, pain points, open questions, mood. This bridges structured data and the conversational Dojo experience.

### Sessions
Each Dojo session is a self-contained HTML experience generated through conversation with Claude. Sessions are saved for later review, building up a personal training archive.

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
Every observation, decision, and artifact can be attributed to a specific kataka via `katakaId`. This enables per-agent performance analysis: which agents make good decisions? Which ones produce frictions?

---

## 10. Data Store Summary

| Store | Location | Format | Write pattern | Read pattern |
|-------|----------|--------|--------------|-------------|
| Config | `.kata/config.json` | JSON | Write-once at init | Read at every command |
| Steps | `.kata/stages/{category}/steps/` | JSON | CRUD via CLI | Read by ManifestBuilder |
| Flavors | `.kata/stages/{category}/flavors/` | JSON | CRUD via CLI | Read by orchestrator |
| Cycles | `.kata/cycles/{id}.json` | JSON | Created by `kata cycle new` | Read by cooldown |
| Runs | `.kata/runs/{id}/` | JSON + JSONL | Written during execution | Read by cooldown, Dojo |
| Decisions | `.kata/runs/{id}/decisions.jsonl` | JSONL (append-only) | Appended during execution | Read by cooldown, Dojo |
| Observations | `.kata/runs/{id}/**/observations.jsonl` | JSONL (append-only) | Appended during execution | Read by LearningExtractor |
| Learnings | `.kata/knowledge/learnings/{id}.json` | JSON (versioned) | Created/updated in cooldown | Read by ManifestBuilder |
| Graph Index | `.kata/knowledge/graph-index.json` | JSON | Updated in cooldown | Read for traversal |
| Rules | `.kata/rules/{id}.json` | JSON | Created in cooldown | Read by orchestrator |
| Diary | `.kata/dojo/diary/{cycle-id}.json` | JSON | Written in cooldown | Read by Dojo |
| Sessions | `.kata/dojo/sessions/{id}/` | JSON + HTML | Generated by Dojo | Opened in browser |
| Sources | `.kata/dojo/sources.json` | JSON | CRUD via CLI | Read by research agents |
| Context | `.kata/KATA.md` | Markdown | Init + cooldown refresh | Read by all agents |
| Token Usage | `.kata/tracking/` | JSON | Written during execution | Read by cooldown |

---

## 11. CLI Command Map

| Domain | Command | Alias | Purpose | Status |
|--------|---------|-------|---------|--------|
| Init | `kata init` | `kata rei` | Initialize a project | Shipped |
| Stage | `kata stage` | `kata gyo` | Manage the 4 stage categories | Shipped |
| Step | `kata step` | `kata waza` | CRUD for atomic work units | Shipped |
| Flavor | `kata flavor` | `kata ryu` | Manage step compositions | Shipped |
| Cycle | `kata cycle` | `kata keiko` | Time-boxed work periods | Shipped |
| Execute | `kata execute` | `kata kiai` | Run stage orchestration | Shipped |
| Decision | `kata decision` | `kata kime` | Record and review decisions | Shipped |
| Knowledge | `kata knowledge` | `kata bunkai` | Query and manage learnings | Shipped |
| Cooldown | `kata cooldown` | `kata ma` | Cycle reflection | Shipped |
| Config | `kata config` | `kata seido` | Interactive methodology editor | Shipped |
| Dojo | `kata dojo` | — | Personal training environment | Shipped |
| Status | `kata status` | — | Project overview | Shipped |
| Stats | `kata stats` | — | Aggregate analytics | Shipped |
| Watch | `kata watch` | `kata kanshi` | Live execution TUI | Shipped |
| Approve | `kata approve` | — | Approve pending human gates | Shipped |
| Artifact | `kata artifact` | — | Record artifacts with provenance | Shipped |
| Rule | `kata rule` | — | Accept/reject rule suggestions | Shipped |
| Observe | `kata observe` | `kata kansatsu` | Record runtime observations | Wave F |
| Agent | `kata agent` | `kata kataka` | Manage kataka agents | Wave G |
| Lexicon | `kata lexicon` | `kata kotoba` | Interactive vocabulary table | Wave G |

---

## 12. Design Principles

1. **Schema-first types.** All types are Zod schemas. Schemas are the source of truth — no separate interface definitions.

2. **Append-only execution data.** Run files (decisions, observations, artifacts) are never modified after writing. This ensures auditability and stable graph foundations.

3. **Quantitative from structure, qualitative from LLM.** Confidence scores come from citation counts and evidence consistency — not from asking an LLM "how confident are you?" LLMs provide the qualitative synthesis; structure provides the numbers.

4. **Progressive improvement.** Zero configuration still works. Rules, learnings, and vocabulary expand organically through use. A fresh Kata project and a mature one use the same primitives — the mature one just has more accumulated knowledge.

5. **Capture all, analyze selectively.** Observations are captured at every hierarchy level during execution (cheap, append-only). Analysis happens only during cooldown (expensive, LLM-powered). This separates hot-path writes from cold-path reasoning.

6. **Soft delete only.** Learnings are never hard-deleted — they're archived. The graph preserves provenance even for knowledge that has been superseded. You can always trace back to the raw observations.

7. **The skill file is the primary interface.** For AI consumers, a well-written skill package is more important than a complex API. The agent reads methodology instructions, uses CLI for structured operations, and reads state files directly.

---

*Last updated: 2026-02-28. Waves 0–E + K shipped (2148 tests, 109 files). This is a living document — updated as new waves ship.*
