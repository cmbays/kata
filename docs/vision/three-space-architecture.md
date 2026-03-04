# Three-Space Architecture Vision — San-Ma (三間)

> How Kata's `.kata/` directory evolves from a flat collection of 22 mixed-purpose subdirectories into a three-space architecture that structurally encodes data durability, enables single-root agent bootstrapping, unlocks cross-run knowledge queries, and prepares the foundation for nanograph integration.
>
> **Companion documents**:
> - [Knowledge Graph Vision — nanograph Integration](knowledge-graph-vision.md) — nanograph depends on three-space separation as a prerequisite
> - [Meta-Learning Architecture](../meta-learning-architecture.md) — Observation system, knowledge graph, and self-improvement loop
> - [Spike: Knowledge Graph](../pipeline/spike-knowledge-graph.md) — Early design exploration on graph implementation
> - [Dogfooding Roadmap](../dogfooding-roadmap.md) — Projects and bet backlog for v1
>
> **Status**: Vision document. Three-space separation is a v1 foundational feature that precedes nanograph integration.
>
> **Thematic name**: San-Ma (三間) — "three spaces" or "three intervals." In martial arts, *ma* (間) refers to the space between things — the interval that gives structure its meaning.

---

## Why Three Spaces

### The Problem

Kata's `.kata/` directory currently contains 22 top-level subdirectories with fundamentally different lifecycles, durability requirements, and query patterns — all at the same level:

```
.kata/
├── config.json          # Permanent project identity
├── stages/              # Reference methodology (changes rarely)
├── bridge-runs/         # Per-session scaffolding (temporal)
├── knowledge/           # Durable learnings (compounds over time)
├── runs/                # Execution trees (temporal, high volume)
├── tracking/            # Operational metrics (temporal)
├── kataka/              # Agent registry (permanent, slow change)
├── dojo/                # Reflections (permanent knowledge)
├── cycles/              # Active work periods (temporal)
├── ... (12 more directories)
```

There is no structural signal about which data is permanent vs. temporal, which should be loaded at session start vs. on-demand, or which compounds in value vs. flows through and gets processed.

### What This Causes

**1. Agent bootstrapping is scatter-gather.** A kataka agent needs identity from `kataka/`, methodology from `stages/` + `flavors/` + `pipelines/`, capabilities from `skill/` + `prompts/`, and project context from `config.json` + `KATA.md`. That's 7+ directories to establish "who am I and how do I work."

**2. Knowledge is trapped in operational scaffolding.** Observations, decisions, and artifacts are recorded inside `runs/<id>/` — locked in the execution tree. Querying "all friction observations across 10 keikos" requires walking every run directory, reading every observation JSONL file, and aggregating. The knowledge is there but structurally inaccessible.

**3. Conflation of lifecycles causes predictable failures.** When permanent knowledge (learnings) sits next to temporal state (bridge-runs) with no structural distinction:
- Agents waste context loading operational scaffolding when seeking knowledge
- Archival decisions are unclear — what can be cleaned up vs. what must be preserved?
- Growth patterns clash — knowledge grows steadily; operations fluctuate wildly

**4. nanograph integration has no clear scope.** When everything is flat, what gets indexed? Graphing operational scaffolding alongside durable knowledge produces noise. The graph needs a clean, well-defined input.

### The Insight

Ars Contexta's three-space architecture (Heinrich, 2026) demonstrates that separating data by **durability, growth pattern, and query pattern** prevents these failures structurally. The key insight: these aren't organizational preferences — they're failure-mode prevention. Data with different lifecycles in the same space will eventually degrade both.

Kata already implicitly has three spaces. The data naturally falls into identity, knowledge, and operations. Three-space separation makes this explicit, giving agents and humans structural signals about what data means and how to interact with it.

---

## The Three Spaces

### self/ — Identity & Methodology

> *Japanese alias: shin (心) — heart, core, mind*
>
> "Who am I? How do I work?"

| Property | Value |
|----------|-------|
| **Durability** | Permanent, evolves slowly |
| **Growth** | Tens of files, changes deliberately |
| **Load pattern** | Full load at session start |
| **Update frequency** | Methodology changes per-keiko at most; config changes at init |
| **Content** | Project config, agent constitution, stage definitions, flavors, pipelines, templates, prompts, skills, vocabularies, saved katas, agent registry |

```
.kata/self/
├── config.json                    # Project settings
├── KATA.md                        # Agent constitution
├── methodology/                   # How work gets done
│   ├── stages/                    # Stage definitions (builtin + custom)
│   ├── flavors/                   # Named step compositions
│   ├── pipelines/                 # Stage sequences
│   └── templates/                 # Pipeline templates
├── capabilities/                  # What agents can do
│   ├── skill/                     # Agent skill files
│   ├── prompts/                   # LLM instruction templates
│   ├── vocabularies/              # Domain terminology
│   └── katas/                     # Saved kata sequences
└── agents/                        # Who the agents are
    └── <kataka-id>.json           # Kataka registration
```

**Why this grouping**: Everything in `self/` answers the question an agent asks on boot: "What is this project, how does it work, and what can I do?" Loading `self/` completely gives an agent full orientation. Nothing temporal, nothing that changes mid-session.

**Evolution pattern**: New flavors emerge from friction patterns (promoted from cooldown). New katas crystallize from successful sequences. New agents get registered. The methodology itself improves — but deliberately, as a result of the learning loop. `self/` is the *output* of methodology evolution, not the process.

### knowledge/ — Accumulated Wisdom

> *Japanese alias: chi (智) — wisdom*
>
> "What have we learned?"

| Property | Value |
|----------|-------|
| **Durability** | Permanent, worth finding again |
| **Growth** | Steady, compounds over time (10-50 items per keiko) |
| **Load pattern** | Progressive disclosure — filter by stage/category/domain, then load details |
| **Update frequency** | Learnings: versioned mutations. Promoted items: write-once. Dojo: per-cycle. |
| **Content** | Learnings, promoted observations, promoted decisions, artifacts index, governance rules, execution history, dojo reflections |

```
.kata/knowledge/
├── learnings/                     # Extracted patterns (versioned)
│   └── <id>.json
├── observations/                  # Promoted from runs (durable)
│   └── <id>.json
├── decisions/                     # Promoted from runs (durable)
│   └── <id>.json
├── artifacts/                     # Global artifact index
│   └── <id>.json
├── rules/                         # Extracted governance
│   └── <id>.json
├── history/                       # Execution records (append-only)
│   └── <id>.json
└── dojo/                          # Reflections & training
    ├── diary/                     # Per-cycle journal
    │   └── <cycle-id>.json
    ├── sessions/                  # Learning artifacts
    │   └── <id>.json
    └── sources.json               # Reference sources
```

**Why this grouping**: Everything in `knowledge/` answers the question: "What does this project know?" Learnings compound. Promoted observations are worth finding again. History provides provenance. Dojo provides reflection. All queryable, all permanent, all growing in value.

**The promotion concept**: Raw observations and decisions are captured in `ops/runs/` during execution. During cooldown (or via manual `kata promote`), significant items get **promoted** to `knowledge/`. The original stays in the run tree (append-only, never modified). The promoted copy lives in `knowledge/` where it's queryable across all runs without walking the run tree.

**Content moves from temporal to durable, never backward.** An observation promoted to `knowledge/observations/` is a declaration: "This is worth remembering." It becomes a node that nanograph can index, that dojo can query, that cooldown can aggregate across cycles.

### ops/ — Active Operations

> *Japanese alias: do (動) — action, movement*
>
> "What's happening right now?"

| Property | Value |
|----------|-------|
| **Durability** | Temporal, flows through and gets processed |
| **Growth** | Fluctuating — fills during active work, can be archived after cooldown |
| **Load pattern** | Targeted — active cycle, current run, today's session |
| **Update frequency** | High during execution, dormant between cycles |
| **Content** | Active cycles, execution run trees, bridge-run metadata, token tracking, session logs |

```
.kata/ops/
├── cycles/                        # Cycle definitions
│   └── <id>.json
├── runs/                          # Execution trees
│   └── <run-id>/
│       ├── run.json               # Run metadata
│       ├── observations.jsonl     # Raw observations (append-only)
│       ├── decisions.jsonl        # Raw decisions (append-only)
│       ├── artifact-index.jsonl   # Artifact references
│       └── stages/                # Per-stage execution state
│           └── <category>/
│               ├── state.json
│               ├── observations.jsonl
│               └── flavors/...
├── bridge-runs/                   # Session bridge metadata
│   └── <run-id>.json
├── tracking/                      # Token/cost usage
│   └── usage.json
└── sessions/                      # Session logs
    └── <id>.json
```

**Why this grouping**: Everything in `ops/` answers: "What's in motion?" Active cycles, running executions, session state. This data is important *now* but its long-term value is in what gets promoted to `knowledge/`, not in the raw operational detail.

**Archival pattern**: After cooldown completes and knowledge promotion runs, the cycle's operational data has been processed. Run trees can be archived (compressed, moved to `ops/archive/`) without losing any durable value — that value now lives in `knowledge/`. This keeps `ops/` lean and current.

---

## The Self-Improvement Loop Through Three Spaces

The three spaces map directly to the phases of Kata's learning loop:

```
                    ┌─────────────────────────────────────┐
                    │                                     │
                    ▼                                     │
            ┌──────────────┐                              │
            │   self/      │  Load methodology            │
            │   (shin)     │  Bootstrap agent              │
            └──────┬───────┘                              │
                   │                                      │
                   ▼                                      │
            ┌──────────────┐                              │
            │   ops/       │  Execute work                │
            │   (do)       │  Capture observations         │
            │              │  Record decisions              │
            └──────┬───────┘                              │
                   │  promote                             │
                   ▼                                      │
            ┌──────────────┐                              │
            │  knowledge/  │  Extract patterns             │
            │  (chi)       │  Cooldown analysis            │
            │              │  Dojo training                │
            └──────┬───────┘                              │
                   │  crystallize                         │
                   │  (new flavors, katas, rules)         │
                   └──────────────────────────────────────┘
```

Each space plays a distinct role:
- **self/** is where methodology lives and evolves deliberately
- **ops/** is where raw execution happens and raw signal is captured
- **knowledge/** is where signal gets refined into durable understanding

The loop is: **load → execute → promote → understand → crystallize → load better**

---

## Companion Principle: Agent Context Injection (San-Sō 三層)

San-Ma (三間) governs how Kata *stores* knowledge across sessions. The same three-space principle applies to what gets *loaded* into an agent's context on every turn — this is **San-Sō (三層)**, the context strata.

> **San (三)** = three. **Sō (層)** = stratum — geological depth metaphor: bedrock, sediment, surface.

The failure mode is identical in both domains: when you mix data of different durabilities in the same place, you pay to reload stale context on every message, and durable knowledge gets buried under temporal noise. The same structural solution applies.

### The Three Context Strata

| Stratum | Name | Durability | Load pattern | Files |
|---------|------|------------|--------------|-------|
| **Self** | shin (心) | Permanent | Always injected | `CLAUDE.md` (global + project) |
| **Knowledge** | chi (智) | Stable, grows | On demand — read when topic is relevant | Memory topic files, `docs/` |
| **Ops** | do (動) | Temporal, decays | Always injected but ruthlessly thin | `MEMORY.md` |

**Self** answers "who am I and how do I work?" A fresh session breaks without it. Behavioral rules, build commands, architectural non-negotiables. Changes only through deliberate methodology evolution.

**Knowledge** answers "what have we learned and where do I look?" CLI lexicons, vision docs, design decisions, roadmaps. Not needed on every turn — read explicitly when the task touches that domain. Never inline in always-injected files.

**Ops** answers "what's happening right now?" Current cycle state, open issues, recent decisions, workflow shortcuts. Valid for roughly one session to one cycle. Anything older than two cycles without being referenced should be removed or promoted to a knowledge file.

### The Reference Map Pattern

`MEMORY.md` (ops) holds a pointer table rather than inlining knowledge content:

```markdown
## Reference Map

| Topic | Location |
|-------|----------|
| CLI lexicon | `memory/lexicon.md` |
| Three-space architecture | `docs/vision/three-space-architecture.md` |
| Dogfooding roadmap | `docs/dogfooding-roadmap.md` |
```

When a topic is needed, read the file directly. You don't pay to re-read it on turns where it's irrelevant.

### Sizing Targets

| File | Stratum | Target |
|------|---------|--------|
| Global `CLAUDE.md` | self | < 120 lines |
| Project `CLAUDE.md` | self | < 80 lines |
| `MEMORY.md` | ops | < 80 lines |
| Topic files | knowledge | Read on demand, no size constraint |

### Audit Checklist

For each section in an always-injected file:

1. **Self or not?** Would a fresh session break without this? If no — remove from `CLAUDE.md`.
2. **Ops or knowledge?** Does this change session-to-session, or is it stable reference? Stable → topic file.
3. **Exists elsewhere?** Is this a summary of a doc that already exists? Remove the summary, add a pointer.
4. **Readable from source?** Is this a list of methods or paths readable from the codebase? Remove it.
5. **Still current?** Is this reflecting the actual state, or what was true two cycles ago? Update or remove.

### Mapping: San-Ma to San-Sō

The two principles mirror each other structurally:

| San-Ma (storage) | San-Sō (context injection) |
|------------------|---------------------------|
| `self/` — project identity and methodology | `CLAUDE.md` — always-injected rules and constraints |
| `knowledge/` — durable learnings, promoted wisdom | Topic files — read on demand when relevant |
| `ops/` — active cycles and temporal execution data | `MEMORY.md` — thin working state, decays aggressively |

Knowledge promotion in San-Ma (ops → knowledge/ during cooldown) has a direct analogue in San-Sō: when an ops entry in `MEMORY.md` proves durable enough to matter across multiple cycles, it gets promoted to a topic file or project doc.

---

## User Journey: The Solo Developer

### Day 1: Init

```bash
kata init
```

Three spaces are created. `self/` has the project config, builtin stages, default skills. `knowledge/` and `ops/` are empty — there's nothing to know and nothing happening yet.

### Week 1-4: First Keikos

The developer creates cycles, adds bets, executes work. `ops/` fills with run trees — observations, decisions, artifacts captured during execution. `self/` gets its first custom flavor (a "tdd-first" approach that works well for this project).

### First Cooldown

Cooldown runs. The significant observations from `ops/runs/` get promoted to `knowledge/observations/`. Learnings are extracted and stored in `knowledge/learnings/`. The cycle diary is written to `knowledge/dojo/diary/`. The operational scaffolding stays in `ops/` for audit trails.

**This is the moment knowledge/ comes alive.** Before cooldown, knowledge was scattered in run trees. After, it's consolidated and queryable.

### Month 2-3: Knowledge Compounds

After 5+ keikos, `knowledge/` has dozens of learnings, hundreds of promoted observations, multiple diary entries. Claude Sensei can now answer: "What friction patterns keep recurring?" in one query against `knowledge/observations/`, not by walking 50 run directories.

A new kataka agent is registered. It loads `self/` — immediately knows the methodology, the custom flavors, the project identity. It loads relevant `knowledge/` — learnings for its stage type, promoted patterns from past work. It's oriented in seconds, not minutes.

### Dojo Training

The developer asks for a training session. Sensei draws from `knowledge/`:
- "Across 8 keikos, here are the 5 most recurring friction points."
- "You made this decision in Keiko 3. Here's what happened. In Keiko 7, you faced the same situation differently."
- "These 12 observations were captured but never promoted to learnings. Let's review."
- "Your 'research' stage has friction around scope. Should we create a new flavor?"

The training produces a new flavor definition, which gets saved to `self/methodology/flavors/`. The methodology evolves.

### Methodology Evolution

Over time, `self/` grows slowly but meaningfully:
- New flavors from friction patterns
- New katas from successful sequences
- New agents registered for different work types
- Prompts refined based on what works

Each addition represents a distilled insight about how work should be done. `self/` is the crystallized output of the learning loop.

### nanograph Integration (v1 late-stage)

When nanograph arrives, it indexes `knowledge/` — the clean, promoted, meaningful dataset. Every node is a learning, observation, decision, or artifact worth remembering. Typed edges connect them: `cited_by`, `contradicts`, `promoted_from`. The graph is born clean because three-space separation already ensured only durable knowledge lives in the space being indexed.

---

## Current State → Target State

### Current KATA_DIRS Mapping

| Current Directory | Target Space | Target Path |
|-------------------|-------------|-------------|
| `config.json` | self/ | `self/config.json` |
| `stages/` | self/ | `self/methodology/stages/` |
| `flavors/` | self/ | `self/methodology/flavors/` |
| `pipelines/` | self/ | `self/methodology/pipelines/` |
| `templates/` | self/ | `self/methodology/templates/` |
| `prompts/` | self/ | `self/capabilities/prompts/` |
| `skill/` | self/ | `self/capabilities/skill/` |
| `vocabularies/` | self/ | `self/capabilities/vocabularies/` |
| `katas/` | self/ | `self/capabilities/katas/` |
| `kataka/` | self/ | `self/agents/` |
| `knowledge/` | knowledge/ | `knowledge/learnings/` |
| `history/` | knowledge/ | `knowledge/history/` |
| `rules/` | knowledge/ | `knowledge/rules/` |
| `artifacts/` | knowledge/ | `knowledge/artifacts/` |
| `dojo/` | knowledge/ | `knowledge/dojo/` |
| `cycles/` | ops/ | `ops/cycles/` |
| `runs/` | ops/ | `ops/runs/` |
| `bridge-runs/` | ops/ | `ops/bridge-runs/` |
| `tracking/` | ops/ | `ops/tracking/` |
| `sessions/` | ops/ | `ops/sessions/` |

### New Concepts (Not in Current Structure)

| New Directory | Space | Purpose |
|---------------|-------|---------|
| `knowledge/observations/` | knowledge/ | Promoted observations from runs |
| `knowledge/decisions/` | knowledge/ | Promoted decisions from runs |
| `ops/archive/` | ops/ | Compressed completed cycle data |

---

## Knowledge Promotion Pipeline

The critical new mechanism that bridges `ops/` and `knowledge/`.

### What Gets Promoted

Not everything. Promotion is selective — it's the "what's worth remembering" filter.

| Source (ops/) | Target (knowledge/) | Promotion Criteria |
|---------------|--------------------|--------------------|
| `runs/<id>/observations.jsonl` | `knowledge/observations/<id>.json` | High severity, recurring pattern, human-flagged, or cooldown-selected |
| `runs/<id>/decisions.jsonl` | `knowledge/decisions/<id>.json` | Significant decisions (architecture, methodology), outcomes recorded |
| Run artifacts | `knowledge/artifacts/<id>.json` | Durable deliverables, not intermediate files |
| Learning extractions | `knowledge/learnings/<id>.json` | Already promoted (existing cooldown behavior) |

### When Promotion Happens

**Automatic (during cooldown)**: When cooldown runs, it identifies significant observations and decisions from the cycle's runs and promotes them. This is the primary promotion path.

**Manual (`kata promote`)**: A human or agent can explicitly promote an observation, decision, or artifact at any time. For when something is clearly important but cooldown hasn't run yet.

**Condition-based (future)**: "This observation type has appeared in 3+ runs" triggers automatic promotion. Condition-based promotion is a Phase 2 capability.

### Promotion Preserves Provenance

Every promoted item retains a link back to its source:

```json
{
  "id": "promoted-obs-uuid",
  "content": "Test coverage friction when switching between research and build stages",
  "type": "friction",
  "severity": "high",
  "promotedFrom": {
    "runId": "original-run-uuid",
    "sourcePath": "ops/runs/<run-id>/observations.jsonl",
    "lineIndex": 42,
    "promotedAt": "2026-03-15T10:00:00Z",
    "promotedBy": "cooldown"  // or "manual" or "condition"
  },
  "katakaId": "agent-uuid",
  "cycleId": "cycle-uuid",
  "betId": "bet-uuid",
  "recordedAt": "2026-03-14T15:30:00Z"
}
```

This provenance chain is what nanograph later indexes as `promoted_from` edges, enabling queries like "show me the evidence chain for this learning."

---

## Naming Convention

Following Kata's established pattern: plain English in code, Japanese aliases for CLI experience.

### Directory Names (Code)

| Space | Directory | Constant Key |
|-------|-----------|-------------|
| Identity | `self/` | `KATA_DIRS.self` |
| Knowledge | `knowledge/` | `KATA_DIRS.knowledge` |
| Operations | `ops/` | `KATA_DIRS.ops` |

### CLI Aliases (Themed)

| English | Japanese | Meaning | Usage |
|---------|----------|---------|-------|
| `self/` | shin (心) | Heart, core, mind | "The dojo's shin" |
| `knowledge/` | chi (智) | Wisdom | "Query the chi" |
| `ops/` | do (動) | Action, movement | "What's active in the do" |
| `promote` | ageru (上げる) | To raise, elevate | `kata ageru` / `kata promote` |
| `archive` | shimau (仕舞う) | To put away, finish | `kata shimau` / `kata archive` |

### KATA_DIRS Update

```typescript
export const KATA_DIRS = {
  root: '.kata',
  // Three spaces
  self: 'self',
  knowledge: 'knowledge',
  ops: 'ops',
  // self/ subdirectories
  methodology: 'self/methodology',
  stages: 'self/methodology/stages',
  flavors: 'self/methodology/flavors',
  pipelines: 'self/methodology/pipelines',
  templates: 'self/methodology/templates',
  capabilities: 'self/capabilities',
  skill: 'self/capabilities/skill',
  prompts: 'self/capabilities/prompts',
  vocabularies: 'self/capabilities/vocabularies',
  katas: 'self/capabilities/katas',
  agents: 'self/agents',
  // knowledge/ subdirectories
  learnings: 'knowledge/learnings',
  observations: 'knowledge/observations',
  decisions: 'knowledge/decisions',
  artifacts: 'knowledge/artifacts',
  rules: 'knowledge/rules',
  history: 'knowledge/history',
  dojo: 'knowledge/dojo',
  diary: 'knowledge/dojo/diary',
  dojoSessions: 'knowledge/dojo/sessions',
  // ops/ subdirectories
  cycles: 'ops/cycles',
  runs: 'ops/runs',
  bridgeRuns: 'ops/bridge-runs',
  tracking: 'ops/tracking',
  sessions: 'ops/sessions',
  archive: 'ops/archive',
  // legacy (kept for migration detection)
  config: 'self/config.json',
  builtin: 'self/methodology/stages/builtin',
} as const;
```

---

## Sequencing: Before nanograph

Three-space separation is a **v1 foundational feature**. nanograph is a **v1 late-stage capability**. The sequencing is:

```
Three-Space Architecture → Remaining v1 features → nanograph integration → v1 publish
```

### Why before nanograph

1. **Three-space creates the data that nanograph indexes.** Without knowledge promotion, observations stay trapped in run trees. nanograph would need to walk every run to find them. Promotion creates the clean, queryable dataset in `knowledge/` that nanograph formalizes.

2. **nanograph needs clear boundaries.** Indexing a flat `.kata/` produces a graph with operational noise mixed with durable knowledge. Indexing only `knowledge/` means every node is meaningful.

3. **Three-space delivers value immediately.** Agent bootstrapping, cross-run queries, and dojo training all improve with just the directory restructure + promotion pipeline, before nanograph adds graph traversal.

4. **Migration is cheaper before nanograph.** Once nanograph has indexed the structure, changing it means re-indexing. Restructure first.

### What three-space enables for nanograph

- **Graph scope**: Index `knowledge/` only — no operational noise
- **Node types**: Already clean — learnings, observations, decisions, artifacts, rules, diary entries
- **Cross-space edges**: `promoted_from` (ops → knowledge) edges have real filesystem provenance
- **Progressive disclosure**: Topic hierarchy in `knowledge/` maps directly to graph navigation
- **Condition-based triggers**: Knowledge health queries run against `knowledge/` space, not full `.kata/`

---

## Implementation Bets

### Dependency Graph

```
Bet 1 (Schema & Migration)
├── Bet 2 (Self-Space Bootstrap)     [parallel]
├── Bet 3 (Knowledge Promotion)      [parallel]
│   ├── Bet 4 (Cross-Run Queries)
│   │   ├── Bet 5 (Dojo from Knowledge)  [parallel]
│   │   └── Bet 6 (Knowledge Lifecycle)  [parallel]
│   └── Bet 7 (Ops Archival)
```

### Bet 1: Three-Space Schema & Migration (Foundation)

Define the formal schema mapping. Build `kata migrate` command with dry-run, backup, and rollback. Update `KATA_DIRS` constant. Update `kata init` to create three-space structure for new projects.

**Exit criteria**: Fresh `kata init` creates three-space structure. Existing `.kata/` projects can migrate safely with `kata migrate`. All tests pass on new structure.

**Scope**: KATA_DIRS update, JsonStore path resolution, init handler, migration command, test updates.

### Bet 2: Self-Space Agent Bootstrap

Consolidate identity loading. Update `formatAgentContext()` to load from `self/` as a single root. Simplify session orientation.

**Exit criteria**: A new kataka loads `self/` and has complete context. Agent onboarding tokens measurably reduced. `kata kiai context <run-id>` produces richer context from consolidated self-space.

**Depends on**: Bet 1

### Bet 3: Knowledge Promotion Pipeline

Implement promotion of observations, decisions, and artifacts from `ops/runs/` into `knowledge/`. Define promotion criteria. Cooldown triggers bulk promotion. Manual promotion via `kata promote` (alias: `kata ageru`).

**Exit criteria**: After cooldown, significant observations appear in `knowledge/observations/`. Manual promotion works via CLI. Promoted items retain provenance (link back to source run).

**Depends on**: Bet 1

### Bet 4: Cross-Run Knowledge Queries

Build query capabilities on promoted knowledge. Feed results into cooldown, dojo, and agent context.

**Exit criteria**: `kata knowledge query --type observation --tag friction` returns results across all promoted knowledge. Cooldown uses knowledge queries instead of run-walking. Query performance is O(knowledge) not O(runs).

**Depends on**: Bet 3

### Bet 5: Dojo From Knowledge

Power dojo training sessions from knowledge space queries. Pattern review, decision replay, knowledge gap identification, methodology evolution suggestions.

**Exit criteria**: `kata dojo open` creates sessions grounded in `knowledge/` queries. Training produces actionable methodology improvements that can be saved to `self/`.

**Depends on**: Bet 4

### Bet 6: Knowledge Lifecycle

Implement decay, archival, pruning, and condition-based maintenance for knowledge space. The "art of forgetting" — the system improves by also removing.

**Exit criteria**: Knowledge nodes have active lifecycle. Stale items decay. Contradictions are flagged. Condition-based maintenance surfaces actionable prompts during cooldown.

**Depends on**: Bet 4

### Bet 7: Ops Archival

After cooldown + promotion, allow archival of completed cycle operational data. Keep `ops/` lean.

**Exit criteria**: Completed cycles can be archived via `kata ops archive` (alias: `kata shimau`). Archived data is recoverable. Knowledge persists regardless of archival.

**Depends on**: Bet 3

---

## Non-Goals

- **Changing the domain model.** Zod schemas for Stage, Pipeline, Cycle, Learning, etc. remain unchanged. Three-space separation is a storage organization change, not a domain model change.
- **Breaking the existing API.** `KnowledgeStore`, `StageRegistry`, and other interfaces keep their signatures. The path resolution layer changes, not the consumer API.
- **Requiring nanograph.** Three-space delivers full value with JSON files. nanograph amplifies it later.
- **Forcing immediate migration.** A `kata migrate` command handles the transition. Legacy flat structures are detected and users are guided to migrate.

---

## Inspiration

This architecture is informed by:

- **Ars Contexta's three-space model** (Heinrich, 2026): `self/`, `notes/`, `ops/` separation based on durability, growth, and query patterns. Demonstrates that conflating spaces with different lifecycles causes specific, predictable failures.
- **"The Art of Forgetting"** (Cornelius, Agentic Note-Taking #20): The most important operation in a functioning knowledge system is removal. Knowledge systems fail when accumulation outpaces release.
- **"Notes Without Reasons"** (Cornelius, Agentic Note-Taking #23): Curated connections carry reasons that agents can evaluate. Embedding-based connections produce fog.
- **"What No Single Note Contains"** (Cornelius, Agentic Note-Taking #25): Value lives between notes — in the curated topology, the traversal paths. The graph's value is in its shape.
- **"Living Memory"** (Cornelius, Agentic Note-Taking #19): Three memory systems — semantic (knowledge graph), episodic (self), procedural (methodology) — map directly to knowledge/, self/, and self/methodology/.
- **Kata's own knowledge graph spike** ([spike-knowledge-graph.md](../pipeline/spike-knowledge-graph.md)): 70% of queries are simple filters, 30% need graph traversal. Three-space separation makes the simple queries fast; nanograph handles the complex ones.
- **Cognitive science**: Knowledge decay mirrors synaptic pruning. Promotion mirrors memory consolidation. Three-space separation mirrors the distinction between working memory (ops), long-term memory (knowledge), and procedural memory (self).

---

*This is a vision document. It will be refined as implementation reveals edge cases and real usage patterns. The bet structure ensures we can deliver incrementally — each bet ships value independently.*
