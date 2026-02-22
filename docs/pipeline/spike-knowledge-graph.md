---
shaping: true
---

# S1+S2 Spike: Knowledge Graph & Skills Graph Implementation

## Context

The methodology engine needs two graph-like data structures:
1. **Knowledge graph** — learnings, decisions, patterns, concepts and their relationships
2. **Skills graph** — skills, capabilities, and their composability/dependency relationships

The key question: what implementation approach, and are these the same graph or separate?

## Goal

Determine the right backing implementation for both graphs and whether they should be
unified or separate. Understand what query patterns we actually need.

## Questions

| #       | Question                                                      |
| ------- | ------------------------------------------------------------- |
| **Q1**  | What query patterns does the self-improving loop need?        |
| **Q2**  | What query patterns does skill discovery/resolution need?     |
| **Q3**  | Embedded JSON graph vs. graph library vs. SQLite vs. graph DB? |
| **Q4**  | Same graph or separate graphs for knowledge and skills?       |

## Findings

### Q1: Knowledge Graph Query Patterns

The self-improving loop needs these queries:

| Query | Pattern | Complexity |
| ----- | ------- | ---------- |
| "What learnings apply to stage type X?" | Filter nodes by `appliesTo` field | Simple filter |
| "What learnings in category Y?" | Filter nodes by `category` field | Simple filter |
| "What learnings for agent Z?" | Join through subscription mappings | Simple join |
| "What patterns confirmed across N+ pipeline runs?" | Aggregate by `evidence` count | Aggregation |
| "What concepts relate to concept X?" | 1-2 hop traversal from node | Graph traversal |
| "What decisions enabled/contradicted this pattern?" | Edge-type filtered traversal | Graph traversal |
| "Show me the learning timeline for stage type X" | Filter + sort by timestamp | Filter + sort |

**Insight**: Most queries (5 of 7) are simple filters or aggregations. Only 2 require
actual graph traversal. This means a full graph database is overkill for v1 — but the
interface should support graph operations for when they're needed.

### Q2: Skills Graph Query Patterns

| Query | Pattern | Complexity |
| ----- | ------- | ---------- |
| "What skills are available for stage type X?" | Filter by `stageAffinity` | Simple filter |
| "I need competitive-analysis — what's the closest match?" | Similarity search via `alternativeTo` edges | Graph traversal |
| "What skills compose into a full vertical pipeline?" | Multi-hop traversal via `composesInto` edges | Graph traversal |
| "What does skill X require?" | Direct edge traversal | Simple traversal |
| "What skills have the best success rates?" | Aggregate metrics | Aggregation |

**Insight**: Skills queries are more graph-dependent than knowledge queries. The
"closest match" and "composition" queries benefit from actual graph traversal.

### Q3: Implementation Options

| Option | Pros | Cons | Right For |
| ------ | ---- | ---- | --------- |
| **JSON files + in-memory filtering** | Zero deps, portable, simple. Persist as `.json`, load into typed arrays, filter/map. | No graph traversal primitives — you implement BFS/DFS manually. Gets slow at 10K+ nodes. | v1 with < 1K nodes |
| **Graphology (in-memory JS graph library)** | Full graph operations (traversal, neighbors, shortest path, metrics). Well-maintained (2K+ stars). Zero external deps. JSON serialization built-in. | In-memory only — must load entire graph. Library adds ~50KB. | v1-v2 with < 50K nodes |
| **SQLite (better-sqlite3)** | Relational queries, joins, aggregation. Recursive CTEs for graph-like traversal. Handles large datasets. | Native module (C++ binding) — complicates cross-platform npm publishing. Graph queries via CTEs are verbose. | When data exceeds memory |
| **Neo4j / Memgraph** | Purpose-built graph DB. Cypher query language. Scales to millions of nodes. | External service dependency. Massive overkill for a dev tool. Violates null-state principle. | Enterprise scale (not us) |

### Q3 Decision: Phased Approach

**Phase 1**: JSON files with typed interfaces. Nodes and edges as typed arrays.
In-memory filtering for the simple queries (which are 70% of our needs). Hand-rolled
BFS for the 2-3 traversal queries. The interface (`IKnowledgeStore`, `ISkillRegistry`)
abstracts the backend.

**Phase 2+**: If graph queries become frequent or data grows, swap to Graphology behind
the same interface. Zero API changes for consumers.

**Why not start with Graphology?** Simplicity. JSON files are debuggable (open in any
editor), have zero dependencies, and are trivially testable. Graphology is a strong
fallback but adds complexity we don't need on day one.

### Q4: Same Graph or Separate?

**Decision: Separate graphs with typed cross-references.**

| Dimension | Knowledge Graph | Skills Graph |
| --------- | --------------- | ------------ |
| **Node types** | Learning, Decision, Pattern, Finding | Skill, Capability, AgentProfile |
| **Edge types** | enables, contradicts, refines, depends-on | composesInto, alternativeTo, requires |
| **Lifecycle** | Grows continuously (every pipeline adds learnings) | Relatively stable (skills change infrequently) |
| **Query patterns** | Mostly filter/aggregate | More graph traversal |
| **Data volume** | High (hundreds of learnings over time) | Low (tens of skills) |

**Cross-references** (not graph edges — typed foreign keys):
- A `Skill` has `learningCategories: LearningCategory[]` — what knowledge feeds it
- A `Learning` has `relatedSkills: SkillRef[]` — what skills it informs
- An `AgentProfile` has `skills: SkillRef[]` and `memorySubscriptions: LearningCategory[]`

Merging them into one graph would muddy the schemas (learning nodes and skill nodes have
completely different fields) and couple two independent lifecycles. Separate registries
with cross-references is cleaner.

## Acceptance

Spike complete — we can describe:
- The query patterns both graphs need ✅
- The implementation approach (JSON files → Graphology upgrade path) ✅
- The separation strategy (separate graphs, typed cross-references) ✅
