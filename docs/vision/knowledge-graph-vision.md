# Knowledge Graph Vision — nanograph Integration

> How Kata's bunkai (knowledge) system evolves from JSON files to a proper graph database, enabling multi-hop reasoning, structural pattern detection, and emergent intelligence across keiko cycles.
>
> **Companion documents**:
> - [Three-Space Architecture Vision](three-space-architecture.md) — **Prerequisite**: directory restructuring that creates the clean `knowledge/` space nanograph indexes
> - [Meta-Learning Architecture](../meta-learning-architecture.md) — Current observation system, knowledge graph, and self-improvement loop
> - [v3 Rust Port Vision](v3-rust-port.md) — nanograph carries forward natively into Rust
> - [Spike: Knowledge Graph](../pipeline/spike-knowledge-graph.md) — Early design exploration on graph implementation options
> - [Unified Roadmap](../unified-roadmap.md) — Waves F–J build the meta-learning system progressively
>
> **Status**: Vision document. nanograph integration happens as a late v1 feature, after three-space architecture is complete. Behind the existing `KnowledgeStore` port interface. No API changes for consumers.

---

## Why a Graph Database

Kata already *is* a graph. The `graph-index.json` is a hand-built edge list. Every UUID cross-reference (learning → observation, run → cycle, bet → learning) is an implicit edge. The hierarchical tier promotion chain (step → flavor → stage → category → agent) is a directed acyclic graph. We're maintaining graph infrastructure by hand in JSON — and it's reaching its limits.

### What JSON can't do

| Query | JSON approach | Difficulty |
|-------|-------------|-----------|
| "Why does Kata believe X?" | Load learning, load each citation, load each run | 3+ file reads, manual assembly |
| "What patterns span multiple keikos?" | Load all learnings, group by category, check cross-cycle citations | Full scan, O(n) |
| "Which kataka is best calibrated for this domain?" | Load all reflections, filter calibrations, cross-reference runs for domain tags | Multi-file join, manual |
| "What learnings are losing evidence?" | Load all learnings, compute decay, sort | Full scan + computation |
| "Show the evidence chain for this strategic learning" | Recursive traversal: learning → citations → observations → runs → cycles | Manual BFS across files |

These are the queries that make Kata's intelligence loop actually intelligent. Today, each requires custom code in `KnowledgeStore`, `CooldownSession`, or `ProposalGenerator`. A graph database makes them declarative.

### Why nanograph specifically

| Requirement | nanograph capability |
|-------------|---------------------|
| On-device (no external service) | Embedded, single-process |
| Schema-as-code | TypeScript/Rust type definitions |
| Rich query language | nanoQL (Datalog + GraphQL syntax) |
| Multi-modal search | 6 modes: BM25, vector, fuzzy, phrase, hybrid RRF, exact |
| Change data capture | CDC for reactive updates |
| Rust-native | No FFI boundary in v3 |
| TypeScript SDK | `nanograph-db` npm package for v2 |

---

## Design Principles

These principles are informed by graph theory, cognitive science research on knowledge systems, and practical experience with structured agent knowledge.

### 1. Typed, reasoned edges over embedding similarity

Every edge in the graph carries a semantic type that agents can evaluate. Two learnings connected by `contradicts` mean something fundamentally different than two connected by `refines`. Embedding-based similarity (vector search) is useful for *discovery* — finding candidate connections — but discovered connections should be promoted into typed edges with explicit reasons.

**Principle**: Vector search finds candidates. Typed edges encode decisions. The graph's value is in its curated topology, not in algorithmic adjacency.

### 2. Three-space node taxonomy

Nodes belong to one of three spaces with different durability, growth patterns, and query characteristics:

| Space | Content | Durability | Growth | Query pattern |
|-------|---------|-----------|--------|---------------|
| **Knowledge** | Learnings, patterns, topics, insights | Permanent (versioned, soft-delete) | Steady, compounds | Multi-hop traversal, aggregation |
| **Identity** | Kataka, steps, flavors, methodology | Persistent, evolves slowly | Tens of nodes | Full load at session start |
| **Execution** | Runs, observations, decisions, artifacts | Temporal, flows through | Fluctuating, high volume | Targeted lookup, time-range queries |

Content moves from Execution → Knowledge (promotion) but never backward. This separation prevents conflating temporal operational state with durable knowledge — a failure mode that degrades both.

### 3. Forgetting is a first-class operation

Accumulation without pruning degrades signal-to-noise ratio. The graph needs active lifecycle management:

- **Confidence decay**: Learnings lose confidence over time without reinforcement (already implemented: operational 50%/30d, strategic 20%/90d, constitutional 0%)
- **Supersession**: New learnings can explicitly override older ones via `supersedes` edges
- **Archival**: Learnings below confidence threshold are archived (soft-deleted, never hard-deleted — provenance preserved)
- **Condition-based triggers**: Maintenance fires on state thresholds, not schedules (e.g., "stale learnings exceed 20%" rather than "weekly review")

### 4. Value lives in topology

The graph's intelligence is in its shape — the paths between nodes, the density of connections, the clusters that form. Structural signals that only exist in the graph:

| Signal | Detection | Meaning |
|--------|-----------|---------|
| High citation density | count(cited_by edges) on a learning | Well-evidenced, high confidence |
| Tension cluster | Multiple `contradicts` edges within a topic | Unresolved conflict requiring resolution |
| Agent breadth | count(distinct topics) via kataka → attributed_to → belongs_to | Agent specialization vs generalization |
| Learning velocity | count(promoted_from edges) per cycle | Are we learning from execution? |
| Orphan nodes | Knowledge nodes with degree 0 | Disconnected knowledge needing pruning or connection |
| Evidence chains | Multi-hop path: Learning ← citation ← Observation ← Run ← Cycle | Full provenance for any belief |

### 5. Progressive disclosure via graph structure

Agents shouldn't load all learnings at once. The graph enables layered loading:

1. **Load topic clusters** — see what knowledge domains exist
2. **Load topic descriptions** — understand what each area covers without reading individual learnings
3. **Load relevant learnings** — only the ones matching the current stage/domain
4. **Traverse for context** — follow edges to evidence, contradictions, related topics

This mirrors how hierarchical navigation works in structured knowledge systems — attention management through progressive narrowing.

---

## Graph Schema

### Edge Type Design

Edges fall into two categories based on a simple rule: **edge types should encode meaning that node types can't.**

**Structural edges** (containment/hierarchy) — the relationship is implied by the node types. A Run connected to a Bet via `part_of` is unambiguous because they're different node types. One general edge suffices.

**Semantic edges** (knowledge relationships) — the meaning differs between nodes of the same type. Two Learnings can be connected in multiple ways that mean fundamentally different things. Each needs its own edge type.

### Node Types

#### Knowledge Space (durable, compounds)

```
Learning {
  id: UUID
  content: string                // The knowledge claim
  description?: string           // ~150 chars beyond content (progressive disclosure)
  confidence: 0-1                // Evidence-based, with decay
  permanence: operational | strategic | constitutional
  tier: step | flavor | stage | category | agent
  category: string
  source: extracted | synthesized | imported | user
  versions: Version[]            // Full mutation history
  usageCount: number             // Times injected into agent prompts
  lastUsedAt?: ISO
  refreshBy?: ISO
  expiresAt?: ISO
  archived: boolean
  createdAt: ISO
  updatedAt: ISO
}

Topic {
  id: UUID
  name: string                   // e.g., "execution-orchestration"
  description: string            // What this knowledge area covers
  level: hub | domain | topic    // Navigational hierarchy
  tensions?: string[]            // Unresolved conflicts within this area
  openQuestions?: string[]       // Unexplored directions
  createdAt: ISO
}
```

#### Identity Space (persistent, evolves slowly)

```
Kataka {
  id: UUID
  name: string
  role: observer | executor | synthesizer | reviewer
  skills: string[]
  methodology?: string           // How this agent works
  calibration?: CalibrationScore[]  // Prediction accuracy by domain
  active: boolean
  createdAt: ISO
}

Step    { id, type, description, artifacts, learningHooks }
Flavor  { id, name, stageCategory, steps[], isolation }
```

#### Execution Space (temporal, flows through)

```
Run         { id, cycleId, betId, katakaId, status, domainTags, startedAt, completedAt }
Observation { id, type, content, severity?, taxonomy?, katakaId, timestamp }
Decision    { id, decisionType, selection, reasoning, confidence, outcome?, decidedAt }
Reflection  { id, type, insight?, correct?, path?, sourceObservationIds, timestamp }
Cycle       { id, name, state, budget, createdAt }
Bet         { id, description, appetite, outcome, domainTags }
Artifact    { id, name, path, summary, type, producedAt }
```

### Edge Types

```
STRUCTURAL (general, inferred from node types)
──────────────────────────────────────────────
part_of         Run → Bet, Bet → Cycle, Stage → Run
                Flavor → Stage, Step → Flavor
                Learning → Topic, Topic → Topic (hierarchy)

produced_in     Artifact → Run

attributed_to   Observation → Kataka, Decision → Kataka


SEMANTIC (specific, encode meaning node types can't)
────────────────────────────────────────────────────

Knowledge edges (between Knowledge Space nodes):
  cited_by        Learning ← Observation     "This observation is evidence for this learning"
  reinforced_by   Learning ← Observation     "Later evidence strengthening this learning"
  derived_from    Learning ← Learning        "Synthesized from parent learning(s)"
  contradicts     Learning ↔ Learning        "These learnings are in tension"
  supersedes      Learning → Learning        "This learning replaces the older one"
  refines         Learning → Learning        "Narrower/more precise version"

Cross-space edges (bridges between spaces):
  promoted_from   Learning ← Observation     "Execution observation became durable knowledge"
  validated_by    Learning ← Run             "This learning was tested in this execution"
  applied_in      Learning → Run             "This learning was injected into context"
  calibrated_by   Kataka ← Reflection        "Calibration data from this reflection"
  proposed_from   Bet ← Learning/Observation "Next-cycle proposal sourced from this"
```

### Why this edge set is minimal

- **4 structural edges** handle all containment (vs. 10+ if every pair got its own name)
- **6 semantic knowledge edges** encode the relationships that matter for reasoning about learnings
- **5 cross-space edges** bridge execution to knowledge to identity — where emergent value lives

Total: **15 edge types**. Each carries a distinct meaning that can't be inferred from node types alone. Adding more would be premature — let usage reveal what's missing.

---

## Key Query Patterns

These are the queries that justify a graph database. Each is impractical with flat JSON files but natural with nanoQL.

### Provenance

```
"Why does Kata believe TDD reduces rework?"

Learning{content: ~"TDD*rework"}
  ← cited_by ← Observation
  ← part_of ← Run
  ← part_of ← Bet
  ← part_of ← Cycle

→ "Based on 6 observations across 3 runs in Keiko 4 and 5"
```

### Cross-cycle pattern detection

```
"What patterns appear in 3+ keikos?"

Learning
  ← cited_by ← Observation
  ← part_of ← Run
  ← part_of ← Bet
  ← part_of ← Cycle

GROUP BY Learning.id
HAVING count(DISTINCT Cycle.id) >= 3

→ Learnings with evidence spanning multiple cycles
```

### Tension detection

```
"What unresolved contradictions exist?"

Learning -[contradicts]- Learning
WHERE both.archived = false
AND NOT EXISTS(Learning -[supersedes]-> either)

→ Active contradictions needing resolution
```

### Agent calibration

```
"Which kataka is best for this domain?"

Kataka ← calibrated_by ← Reflection{type: calibration}
WHERE Reflection.domain = $domain
ORDER BY Reflection.accuracyRate DESC

→ Ranked agents by prediction accuracy in domain
```

### Knowledge health

```
"What learnings are going stale?"

Learning
WHERE decayedConfidence(Learning) < 0.3
AND Learning.archived = false
AND Learning.permanence != 'constitutional'

→ Candidates for review, reinforcement, or archival
```

### Topic navigation (progressive disclosure)

```
"What should I load for build stage context?"

Topic{level: hub}
  → part_of → Topic{level: domain, relevant to 'build'}
    → part_of → Topic{level: topic}
      → part_of → Learning{tier: stage, confidence > 0.5}

→ Layered context: hub → domains → topics → learnings
```

---

## Topic Clusters — Navigational Structure

Topics provide the progressive disclosure layer, replacing flat category strings with a navigable hierarchy:

```
Hub: "kata-methodology"
├── Domain: "execution-orchestration"
│   ├── Topic: "gate-evaluation"
│   │   ├── Learning: "predecessor gates prevent premature execution"
│   │   ├── Learning: "human-approved gates need timeout handling"
│   │   └── Learning: "gate failures correlate with missing artifacts"
│   └── Topic: "adapter-selection"
│       ├── Learning: "claude-cli adapter needs context size limits"
│       └── Learning: "manual adapter works for exploratory stages"
├── Domain: "knowledge-management"
│   ├── Topic: "confidence-scoring"
│   ├── Topic: "tier-promotion"
│   └── Topic: "decay-and-pruning"
└── Domain: "agent-attribution"
    ├── Topic: "kataka-calibration"
    └── Topic: "cross-agent-patterns"
```

Topics are **auto-generated from learning categories** during migration (Phase 1), then curated over time. The hierarchy doesn't need to be deep — 3 levels (hub → domain → topic) is sufficient for attention management.

---

## Learning Lifecycle

```
                    ┌──────────┐
                    │  active   │ ← Created from observation or synthesis
                    └─────┬────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        reinforced    unchanged    contradicted
        (confidence   (confidence  (friction
         increases)    decays)     detected)
              │           │           │
              ▼           ▼           ▼
         still active   ┌──────┐   ┌──────────┐
                        │ stale │   │ superseded│
                        └───┬──┘   └──────────┘
                            │
              ┌─────────────┼──────────────┐
              ▼             ▼              ▼
         resurrected    ┌────────┐    ┌────────┐
         (new evidence) │archived│    │ pruned │
                        └────────┘    └────────┘
                                    (operational only,
                                     3+ cycles archived)
```

### State transitions

| From | To | Trigger |
|------|----|---------|
| active | stale | Confidence decays below 0.3 |
| stale | active | New `reinforced_by` edge added |
| stale | archived | No reinforcement for 2 cycles + confidence < 0.2 |
| active | superseded | Another learning creates `supersedes` edge |
| archived | active | Explicit resurrection via `resurrectedBy()` |
| archived | pruned | 3+ cycles archived, operational permanence only |

### Condition-based lifecycle triggers

Maintenance fires on state thresholds, not schedules:

| Condition | Fires when | Action |
|-----------|-----------|--------|
| Stale ratio > 20% | `count(stale) / count(active) > 0.2` | Suggest pruning session in cooldown |
| Orphan topics > 5 | Topics with no learning children | Suggest restructuring |
| Contradiction count > 3 | Active contradicts edges without supersedes resolution | Surface in cooldown for resolution |
| Unmatched predictions > 10 | Predictions without matching outcomes | Suggest calibration review |
| Citation density < 2 for strategic | Strategic learnings with fewer than 2 citations | Flag for evidence gathering |

---

## Migration Path

### Pre-integration checklist

Do not begin nanograph integration until all of these are true:

- [ ] **Three-space architecture complete** — `self/`, `knowledge/`, `ops/` separation with knowledge promotion pipeline ([vision doc](three-space-architecture.md))
- [ ] nanograph `nanograph-db` npm package ≥1.0 (stable TypeScript SDK API)
- [ ] 10+ real keiko cycles completed (domain model battle-tested)
- [ ] `KnowledgeStore` port interface stable (no breaking changes for 2+ keikos)
- [ ] `maybe {}` supported in nanograph runtime (for optional fields)

### Phase 1: Knowledge Space (post-v1)

**Scope**: Replace `.kata/knowledge/` JSON files with nanograph. Consumers (`KnowledgeStore`) see no API change.

- Import existing learnings as Knowledge nodes
- Import `graph-index.json` edges as typed edges (citation, reinforcement, derivation)
- Auto-generate Topic nodes from learning `category` fields
- Create `part_of` edges from learnings to topics
- Enable nanoQL queries behind `KnowledgeStore.query()`
- **Fallback**: JSON files remain as export format; nanograph is the primary store

### Phase 2: Execution Space

**Scope**: Observations, decisions, artifacts, reflections become graph nodes.

- Import from JSONL files into nanograph on cycle completion
- Create `cited_by`, `reinforced_by` edges from learning citations
- Create `part_of` edges for run → bet → cycle hierarchy
- Create `attributed_to` edges for kataka attribution
- Enable cross-space queries (learning provenance, agent calibration)

### Phase 3: Cooldown as graph analysis

**Scope**: `CooldownSession` and `ProposalGenerator` query the graph instead of loading files.

- Cross-cycle pattern detection via multi-hop queries
- Contradiction detection via `contradicts` edge traversal
- Tension surfacing via topic-level aggregation
- Proposal generation from structural signals (orphans, stale clusters, high-tension topics)
- Learning velocity metrics from `promoted_from` edge counts per cycle

### Phase 4: Agent context from graph

**Scope**: `formatAgentContext()` queries nanograph for progressive disclosure.

- Load topic hub → relevant domains → specific learnings (layered)
- Include provenance summaries with each learning
- Surface active contradictions as "open questions"
- Inject domain confidence from graph-computed metrics
- Replace flat learning lists with structured knowledge maps

### Phase 5: Visualization and advanced queries

**Scope**: Graph becomes interactive and visible.

- Dojo integration: visualize knowledge graph in training sessions
- nanoQL REPL via `kata bunkai query` command
- Graph health dashboard: stale ratio, orphan count, contradiction count, learning velocity
- Export/import for graph portability
- CDC-based reactive updates (e.g., new observation → auto-check for learning candidates)

---

## Inspiration and References

This design is informed by several sources:

- **Kata's own spike** ([spike-knowledge-graph.md](../pipeline/spike-knowledge-graph.md)): Query pattern analysis showing 70% of queries are simple filters (JSON-suitable) but 30% need real graph traversal
- **Graph theory**: Property graph model with typed nodes and edges; progressive disclosure via hierarchical navigation
- **Cognitive science**: Knowledge decay mirrors synaptic pruning; reinforcement mirrors memory consolidation; three-space separation prevents the conflation failures documented in knowledge management research
- **Structured knowledge systems**: Wiki-links as curated, reasoned edges; Maps of Content (MOCs) as attention management; the principle that value lives in connections between knowledge, not within individual notes
- **Agent architecture**: Session-orient patterns for context loading; fresh context per processing phase; condition-based lifecycle triggers over time-based schedules

---

## Non-Goals

- **Replacing the meta-learning architecture.** The observation system, detection engines, synthesis pipeline, and tier promotion all remain. nanograph replaces the *storage and query* layer, not the *processing* logic.
- **Embedding-only connections.** Vector search is for discovery. The graph stores curated, typed edges. No fog.
- **External service dependency.** nanograph is embedded, on-device. No cloud, no network dependency.
- **Premature optimization.** Phase 1 is behind the existing `KnowledgeStore` interface. If nanograph doesn't work out, JSON files are always the fallback.

---

*This is a vision document. It will be refined as v1 matures and real usage reveals which query patterns matter most. The phased approach ensures we can stop at any phase and still have a working system.*
