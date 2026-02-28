# Meta-Learning Architecture

> How Kata learns from its own execution — the observation system, knowledge graph, and self-improvement loop that make the system compound over time.
>
> **Companion documents**:
> - [Kata System Guide](kata-system-guide.md) — Overview hub for the whole system
> - [Design Rationale](v1-design-vision.md) — Why Kata is built the way it is
> - [Dojo Architecture](dojo-architecture.md) — The personal training environment that consumes meta-learning data
> - [Implementation Roadmap](unified-roadmap.md) — Waves F–J build the meta-learning system progressively
>
> **Implementation status**: The basic self-improvement loop (LearningExtractor, PromptUpdater, cooldown capture) is shipped. The observation system, knowledge graph enrichment, detection engines, and LLM synthesis described here ship progressively across Waves F through I.

---

## Core Idea

Kata separates **deterministic structure** (steps, gates, artifacts) from **non-deterministic judgment** (agents deciding how to compose and sequence that structure). The meta-learning system bridges them — making non-deterministic choices visible, measurable, and learnable.

The system has three layers that build on each other:

```
Layer 1: OBSERVATIONS    Raw signals captured during execution (immutable)
Layer 2: LEARNINGS       Working knowledge derived from observations (versioned)
Layer 3: GRAPH INDEX     Connective tissue linking learnings to evidence (traversable)
```

---

## 1. The Observation System *(Wave F)*

Observations are the raw signals captured during execution — the primary input to everything else. They are append-only JSONL, never modified or deleted after writing.

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

### Schema

`ObservationSchema` is a 7-type discriminated union. Every variant includes:
- `id` (UUID), `type` (discriminator), `timestamp`
- `content` (string — the observation itself)
- `katakaId?` (string — agent attribution, populated when Wave G ships)

Type-specific fields:
- **Prediction**: `quantitative?: { metric, predicted, unit }` or `qualitative?: { expected }`, plus `timeframe?`
- **Friction**: `contradicts?: string` linking to what's contradicted, `taxonomy` (5-type: stale-learning, config-drift, convention-clash, tool-mismatch, scope-creep)
- **Gap**: `severity` (critical / major / minor)

### Hierarchy

Observations capture at any level of the execution tree:

```
.kata/runs/{run-id}/
  observations.jsonl                          # Run-level (cross-stage insights)
  stages/{category}/
    observations.jsonl                        # Stage-level (stage-wide patterns)
    flavors/{name}/
      observations.jsonl                      # Flavor-level (flavor-specific signals)
      steps/{name}/
        observations.jsonl                    # Step-level (granular per-step)
```

Higher-level observations (run, stage) capture cross-cutting insights. Lower-level observations (step) capture granular signals. The `runPaths()` utility provides typed access to all levels.

### Capture Mechanism

- **CLI**: `kata observe record` (alias: `kata kansatsu`) — agent-facing command for recording observations during execution
- **Programmatic**: `appendObservation()` utility appends typed JSONL at any hierarchy level
- **Skill-driven**: The orchestration skill instructs agents to call `kata observe record` at natural decision points

### Immutability Guarantee

Observations are **append-only**. Once written, they are never modified or deleted. This creates an immutable audit trail and ensures the knowledge graph has stable foundations. Any observation can be cited by any number of learnings — removing an observation would invalidate all downstream knowledge.

---

## 2. The Knowledge Graph *(Waves F–I)*

The knowledge graph transforms raw observations into working knowledge. It is not designed top-down — it **emerges** from bottom-up evidence accumulation.

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

**5. Synthesis** *(Wave I)* — During cooldown, LLM synthesis reads multiple related learnings and may consolidate them. "These 4 stage-level learnings about test coverage are really one category-level insight." The synthesized learning gets `derivedFrom[]` — creating parent-child relationships in the graph.

```
Category Learning: "Test coverage correlates with code stability"
  ├── derivedFrom: "TDD reduces rework" (stage learning, build)
  ├── derivedFrom: "Untested modules have 3x more bugs" (stage learning, review)
  └── derivedFrom: "Coverage gaps predict production issues" (stage learning, review)
```

**6. Versioning** — If a learning is updated (new evidence contradicts it, user overrides it), the previous state is pushed to `versions[]` with a `citationsDiff` showing what evidence changed. The graph preserves its full history — you can always see how knowledge evolved.

### Learning Schema (Key Fields)

The existing `LearningSchema` is enriched in Wave F with graph-enabling fields:

| Field | Type | Purpose | Status |
|-------|------|---------|--------|
| `id` | UUID | Unique identifier | Shipped |
| `tier` | enum | Scope: step, flavor, stage, category, agent | Shipped (step/flavor added in Wave F) |
| `content` | string | The knowledge itself | Shipped |
| `confidence` | 0–1 | Computed from evidence count and consistency | Shipped |
| `citations` | Citation[] | Links to source observations | Wave F |
| `derivedFrom` | UUID[] | Parent learnings this was synthesized from | Wave F |
| `reinforcedBy` | Reinforcement[] | Additional evidence that strengthened this | Wave F |
| `usageCount` | number | Times injected into agent prompts | Wave F |
| `lastUsedAt` | datetime | When last used in a prompt | Wave F |
| `versions` | Version[] | Full mutation history with citation diffs | Wave F |
| `archived` | boolean | Soft-delete (never hard-deleted — provenance) | Wave F |
| `permanence` | enum | Tier: operational, strategic, constitutional | Wave H |
| `source` | enum | How created: extracted, synthesized, imported, user | Wave H |
| `overrides` | UUID[] | Learnings this supersedes | Wave H |
| `refreshBy` | datetime | When this should be re-evaluated | Wave H |
| `expiresAt` | datetime | Auto-archive date (operational learnings) | Wave H |

### Learning Tiers

Learnings are scoped to a level of the hierarchy:

| Tier | Scope | Example |
|------|-------|---------|
| `step` | A specific methodology step | "The 'write-tests' step benefits from seeing existing test patterns first" |
| `flavor` | A step composition | "TDD flavor works better than code-first for data models" |
| `stage` | A mode of work | "Research stage needs longer timeout for external API calls" |
| `category` | Cross-stage pattern | "This codebase benefits from thorough planning before building" |
| `agent` | A specific kataka agent | "scout-ka tends to over-scope research topics" |

Promotion happens when step-level patterns appear 3+ times: they become flavor or stage learnings.

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

---

## 3. The Self-Improvement Loop

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

### Phase 1: Observation Capture

During execution, agents record observations via `kata observe record`. The orchestration skill instructs agents to capture observations at natural decision points — when they choose between approaches, when they notice something unexpected, when they hit friction. Observations are cheap (append-only JSONL) and don't slow execution.

### Phase 2: Pattern Detection (Cooldown)

The LearningExtractor detects patterns across a run's observations:
- **Frequency patterns**: Same observation type appearing 3+ times → potential learning
- **Prediction calibration**: Predictions checked against outcomes → confidence adjustment
- **Friction clustering**: Related frictions across stages → systemic issue
- **Gap recurrence**: Same gap appearing across runs → unaddressed problem

### Phase 3: Learning Injection

The ManifestBuilder reads learnings relevant to the upcoming stage and injects them into the agent's prompt context. Learnings come with provenance:

```
Learning: "TDD approach reduces rework by ~40% in this codebase"
  Confidence: 0.85 (based on 6 observations across 3 runs)
  Reinforced: 2 times in the last cycle
  Derived from: 2 stage-level learnings about test coverage
```

The agent can make informed decisions about how much to trust each learning. A learning with 6 citations across 3 runs is more trustworthy than one with 1 citation from 1 run. This is **quantitative trust from structure** — not hallucinated confidence scores.

### Phase 4: Decision Tracking

Every decision is logged with context, options, reasoning, and confidence. Later, outcomes are recorded against those decisions. Over time, this reveals which types of decisions lead to good outcomes and which don't — enabling the system to adjust confidence thresholds and rule weights.

---

## 4. Detection Engines *(Wave H)*

Wave H adds specialized engines that analyze observations for specific signal types.

### Prediction Calibration

Predictions are matched against outcomes to detect systematic biases:

| Algorithm | What it detects | Threshold |
|-----------|----------------|-----------|
| **Overconfidence** | Consistently high confidence with poor outcomes | 5+ predictions |
| **Domain bias** | Predictions accurate in domain X but not Y | 5+ per domain |
| **Estimation drift** | Quantitative estimates systematically over/under | 3+ estimates |
| **Predictor divergence** | Different agents/stages have different calibration | 8+ observations |

Calibration is severity-weighted: a wrong high-confidence prediction matters more than a wrong low-confidence one. Results feed into the Reflection subsystem.

### Friction Detection

Frictions are analyzed for systemic patterns:

| Taxonomy | Description | Resolution path |
|----------|-------------|----------------|
| **Stale learning** | A learning contradicts current evidence | Invalidate or scope |
| **Config drift** | Configuration doesn't match actual practice | Synthesize |
| **Convention clash** | Two valid conventions in conflict | Escalate to user |
| **Tool mismatch** | Tool assumptions don't match project reality | Scope |
| **Scope creep** | Work expanding beyond original boundaries | Escalate |

Override detection: When agents consistently override a learning or rule, the system detects it (count + rate thresholds) and generates a friction observation. This surfaces "the system says X but we keep doing Y" patterns.

Four resolution paths with confidence gating:
- **Invalidate**: Evidence clearly contradicts — archive the learning
- **Scope**: Learning is correct in some contexts — add context constraints
- **Synthesize**: Multiple perspectives are valid — create a nuanced learning
- **Escalate**: Can't resolve automatically — surface to user in cooldown

### Reflection Schema

Reflections are the output of detection engines — structured assessments produced during cooldown:

| Type | What it produces |
|------|-----------------|
| **Calibration** | Prediction accuracy analysis for a domain/agent |
| **Validation** | Prediction matched to outcome (correct/incorrect) |
| **Resolution** | Friction resolved through one of the 4 paths |
| **Unmatched** | Prediction with no matching outcome (inconclusive) |
| **Synthesis** | Multiple reflections consolidated into a higher-level insight |

---

## 5. Learning Permanence *(Wave H)*

Not all knowledge has the same shelf life. The permanence system ensures learnings are treated appropriately.

### Three Permanence Tiers

| Tier | TTL | Example |
|------|-----|---------|
| **Operational** | Short (configurable, default ~30 days) | "The staging server is slow this week" |
| **Strategic** | Long (no auto-archive, flagged stale in cooldown) | "TDD reduces rework in this codebase" |
| **Constitutional** | Permanent (immutable — archive or override, never modify) | "Always run tests before merging" |

### Lifecycle

- **Operational learnings** auto-archive when their TTL expires. This prevents knowledge clutter from accumulating.
- **Strategic learnings** don't auto-archive but get flagged as stale in cooldown if they haven't been reinforced recently. The user decides whether to keep, scope, or archive them.
- **Constitutional learnings** cannot be modified — only archived (with reason) or overridden by a new constitutional learning. This ensures foundational knowledge is stable.
- **Promotion/demotion**: Operational learnings reinforced enough times promote to strategic. Strategic learnings validated by constitutional evidence promote to constitutional. The reverse also happens.
- **Confidence decay**: Computed at read time (not stored). Learnings lose confidence gradually if not reinforced, with decay rate depending on tier (operational decays fastest, constitutional decays slowest).

### Constitutional Packs

Pre-built sets of constitutional learnings for common domains. A generic domain-agnostic pack ships in Wave H with universal best practices (test before merge, review before deploy, etc.). Project-specific packs can be imported.

---

## 6. LLM Synthesis Pipeline *(Wave I)*

The synthesis pipeline is the crown of the meta-learning system — where raw observations and pattern-detected learnings are consolidated into higher-order knowledge by an LLM.

### Three-Step Pipeline

```
Step 1: FILTER (rules-based)
  Select observations + learnings eligible for synthesis
  Skip: too few citations, already synthesized this cycle, archived
      │
      ▼
Step 2: DETECT (Sonnet-class LLM)
  Find clusters: related learnings, contradictions, promotion candidates
  Produce synthesis candidates with reasoning
      │
      ▼
Step 3: SYNTHESIZE (Opus-class LLM)
  For each candidate: create/update/promote/archive/recommend
  Full citation chain required (2+ sources or rejection)
  Produce SynthesisProposal with confidence
```

### Synthesis Proposal Types

| Type | What it does |
|------|-------------|
| **new-learning** | Create a learning from observations that haven't been captured |
| **update-learning** | Modify an existing learning based on new evidence |
| **promote** | Elevate a learning's tier (step → flavor → stage → category) |
| **archive** | Retire a learning that evidence no longer supports |
| **methodology-recommendation** | Suggest a rule or configuration change |

### Confidence Gating

- High confidence proposals: auto-applied (unless the user prefers interactive)
- Low confidence proposals: presented to the user for approval
- `--yolo` mode: auto-applies everything, logs for post-hoc review

### Cooldown Integration

Synthesis runs during cooldown step 6, after reflection and friction detection have already processed the raw data. This means synthesis has the richest possible input — not just observations, but reflections, calibration results, and friction resolutions.

### Configurable Depth

| Depth | What it does | When to use |
|-------|-------------|-------------|
| **quick** | Filter + basic pattern detection only | Fast cooldowns, small runs |
| **standard** | Full 3-step pipeline | Default |
| **thorough** | Multiple synthesis passes, cross-cycle analysis | Major milestone cycles |

---

## 7. Domain Confidence *(Wave I)*

Domain confidence tracks how well Kata knows a particular technical domain, enabling informed risk assessment.

### Four-Axis Tag Vocabulary

| Axis | Examples | Count |
|------|---------|-------|
| **Domain** | web-frontend, backend-api, data-pipeline, devops, security | ~15 |
| **Language family** | typescript, python, rust, go, java, etc. | 13 enum |
| **Framework** | react, express, django, etc. | Open vocabulary |
| **Architecture** | monolith, microservice, serverless, etc. | ~10 |

Tags are stored on Bets and RunState. Three sources: user-assigned, auto-detected from project structure, LLM-inferred during execution.

### Composite Confidence Score

Confidence per domain tag is a composite of:
- **Familiarity**: How many runs have covered this domain?
- **Risk**: How complex/novel is the work?
- **Historical performance**: How well have past runs in this domain gone?

Materialized during cooldown, injected as informational context into prompts. Agents see "Kata has high confidence in TypeScript/React but low confidence in Rust/embedded" and can adjust their approach accordingly.

---

## 8. Hierarchical Knowledge Capture *(Waves F + H)*

Knowledge doesn't just exist at one level. A pattern that appears in a single step might be relevant to the whole stage, or even the whole project.

### Capture at Every Level

Observations are recorded at the level where they occur:
- **Step-level**: "This specific test-writing step works better with 3 examples"
- **Flavor-level**: "TDD flavor outperforms code-first in data layer work"
- **Stage-level**: "Build stage needs longer timeouts for CI integration"
- **Run-level**: "Cross-cutting: this project benefits from early architecture decisions"

### Promotion Rules

| From | To | Condition |
|------|-----|-----------|
| Step observation | Step learning | 3+ similar observations |
| Step learning | Flavor learning | Pattern appears in 3+ steps within the flavor |
| Flavor learning | Stage learning | Pattern appears in 2+ flavors within the stage |
| Stage learning | Category learning | Pattern appears in 2+ stages |

### KnowledgeStore Upgrades

Wave H adds hierarchy-aware methods:
- `loadForStep(stepId)` — Step-level learnings + inherited from flavor/stage/category
- `loadForFlavor(flavorId)` — Flavor-level learnings + inherited from stage/category
- Archive/resurrection logic: archived learnings that match new observations can be resurrected with fresh citations

---

## 9. How Agents Use the Knowledge

When a kataka agent starts a stage, the ManifestBuilder injects relevant learnings into its prompt. With the full graph, those learnings carry rich context:

```
## Project Knowledge (injected by Kata)

### High Confidence (0.85+)
- "TDD approach reduces rework by ~40% in this codebase"
  Evidence: 6 observations across 3 runs, reinforced 2x this cycle
  Permanence: Strategic | Last used: 2 days ago

### Medium Confidence (0.5–0.85)
- "React Server Components simplify data fetching in this project"
  Evidence: 2 observations from 1 run
  Permanence: Operational | Expires: 28 days

### Domain Context
- Confidence: High (TypeScript/React), Medium (API design), Low (deployment)
- Recent frictions: 2 unresolved (convention clash in test naming)
```

The agent can make informed decisions about how much to trust each piece of knowledge. **Quantitative trust from structure** — not hallucinated confidence.

---

## 10. File Map

| File/Path | Purpose | Ships in |
|-----------|---------|----------|
| `.kata/runs/{id}/**/observations.jsonl` | Raw observations (immutable) | Wave F |
| `.kata/runs/{id}/**/reflections.jsonl` | Detection engine output | Wave F |
| `.kata/knowledge/learnings/{id}.json` | Individual learning files (versioned) | Shipped (enriched Wave F) |
| `.kata/knowledge/graph-index.json` | Graph edges: learning↔observation links | Wave F |
| `.kata/rules/{id}.json` | Orchestration rules | Shipped |
| `.kata/dojo/diary/{cycle-id}.json` | Narrative reflections | Shipped (Wave K) |

---

## Design Principles

1. **Quantitative from structure, qualitative from LLM.** Confidence scores come from citation counts and evidence consistency — not from asking an LLM "how confident are you?" LLMs provide the qualitative synthesis; structure provides the numbers.

2. **Append-only execution data.** Observations are never modified. Learnings are versioned, not overwritten. The graph preserves provenance even for knowledge that has been superseded.

3. **Capture all, analyze selectively.** Observations are captured at every hierarchy level during execution (cheap, append-only). Analysis happens only during cooldown (expensive, LLM-powered). This separates hot-path writes from cold-path reasoning.

4. **Soft delete only.** Learnings are never hard-deleted — they're archived. You can always trace back to the raw observations through citations.

5. **Progressive improvement.** Zero configuration still works. The meta-learning system expands organically through use. A fresh project and a mature one use the same primitives — the mature one just has more accumulated knowledge.

---

*Last updated: 2026-02-28. Basic self-improvement loop shipped (Waves 0–E). Observation system, knowledge graph enrichment, detection engines, and LLM synthesis ship in Waves F–I. See [Implementation Roadmap](unified-roadmap.md) for details.*
