# Meta-Learning Architecture

> How Kata learns from its own execution — the observation system, knowledge graph, and self-improvement loop that make the system compound over time.
>
> **Companion documents**:
> - [Kata System Guide](kata-system-guide.md) — Overview hub for the whole system
> - [Design Rationale](v1-design-vision.md) — Why Kata is built the way it is
> - [Dojo Architecture](dojo-architecture.md) — The personal training environment that consumes meta-learning data
> - [Implementation Roadmap](unified-roadmap.md) — Waves F–J build the meta-learning system progressively
>
> The basic self-improvement loop (LearningExtractor, PromptUpdater, cooldown capture) is implemented. The observation system, knowledge graph enrichment, detection engines, and LLM synthesis described here ship progressively. See [Roadmap](unified-roadmap.md) for sequencing.

---

## Core Idea

Kata separates **deterministic structure** (waza (steps), mon (gates), artifacts) from **non-deterministic judgment** (agents deciding how to compose and sequence that structure). The meta-learning system bridges them — making non-deterministic kime (decisions) visible, measurable, and learnable.

The system has three layers that build on each other:

```text
Layer 1: OBSERVATIONS    Raw signals captured during execution (immutable)
Layer 2: LEARNINGS       Working knowledge derived from observations (versioned)
Layer 3: GRAPH INDEX     Connective tissue linking learnings to evidence (traversable)
```

---

## 1. The Kansatsu (Observation) System

Kansatsu (observations) are the raw signals captured during kiai (execution) — the primary input to everything else. They are append-only JSONL, never modified or deleted after writing.

### Seven Kansatsu Types

| Type | What it captures | Example |
|------|-----------------|---------|
| **Kime (Decision)** | A choice made among options | "Selected TDD ryu for build gyo (confidence: 0.85)" |
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
- `katakaId?` (string — agent attribution, populated when kataka ship)

Type-specific fields:
- **Prediction**: `quantitative?: { metric, predicted, unit }` or `qualitative?: { expected }`, plus `timeframe?`
- **Friction**: `contradicts?: string` linking to what's contradicted, `taxonomy` (5-type: stale-learning, config-drift, convention-clash, tool-mismatch, scope-creep)
- **Gap**: `severity` (critical / major / minor)

### Hierarchy

Kansatsu capture at any level of the execution tree:

```text
.kata/runs/{run-id}/
  observations.jsonl                          # Run-level (cross-gyo insights)
  stages/{category}/
    observations.jsonl                        # Gyo-level (gyo-wide patterns)
    flavors/{name}/
      observations.jsonl                      # Ryu-level (ryu-specific signals)
      steps/{name}/
        observations.jsonl                    # Waza-level (granular per-waza)
```

Higher-level kansatsu (run, gyo) capture cross-cutting insights. Lower-level kansatsu (waza) capture granular signals. The `runPaths()` utility provides typed access to all levels.

### Capture Mechanism

- **CLI**: `kata kansatsu` (alias: `kata observe record`) — agent-facing command for recording kansatsu during kiai
- **Programmatic**: `appendObservation()` utility appends typed JSONL at any hierarchy level
- **Skill-driven**: The orchestration skill instructs kataka to call `kata kansatsu` at natural kime points

### Immutability Guarantee

Kansatsu are **append-only**. Once written, they are never modified or deleted. This creates an immutable audit trail and ensures the bunkai graph has stable foundations. Any kansatsu can be cited by any number of learnings — removing one would invalidate all downstream knowledge.

---

## 2. The Bunkai (Knowledge) Graph

The bunkai graph transforms raw kansatsu into working knowledge. It is not designed top-down — it **emerges** from bottom-up evidence accumulation.

### Three Layers

```text
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

**1. Capture** — During kiai, kansatsu accumulate as timestamped JSONL entries. No relationships exist yet. Just raw events.

**2. Pattern detection** — During ma (cooldown), the LearningExtractor reads kansatsu across a run. It finds patterns: "friction about test coverage appeared in 3 different gyo" or "predictions about build time were consistently off." Each pattern becomes a learning candidate.

**3. Learning creation with citations** — When a learning is created, it carries `citations[]` — direct links back to the raw kansatsu that spawned it. This is the first graph edge.

```text
Learning: "TDD significantly reduces rework in this codebase"
  ├── Citation: run-1/build/obs-3 (friction: "had to rewrite without tests")
  ├── Citation: run-2/build/obs-7 (outcome: "TDD run had 0 rework cycles")
  └── Citation: run-3/build/obs-2 (insight: "test-first caught design issue early")
```

**4. Reinforcement** — In subsequent runs, similar kansatsu appear. Instead of creating duplicate learnings, the system finds the existing one and adds to `reinforcedBy[]`. The learning's confidence increases based on real evidence count, not LLM estimation.

**5. Synthesis** — During ma, LLM synthesis reads multiple related learnings and may consolidate them. "These 4 gyo-level learnings about test coverage are really one category-level insight." The synthesized learning gets `derivedFrom[]` — creating parent-child relationships in the graph.

```text
Category Learning: "Test coverage correlates with code stability"
  ├── derivedFrom: "TDD reduces rework" (stage learning, build)
  ├── derivedFrom: "Untested modules have 3x more bugs" (stage learning, review)
  └── derivedFrom: "Coverage gaps predict production issues" (stage learning, review)
```

**6. Versioning** — If a learning is updated (new evidence contradicts it, user overrides it), the previous state is pushed to `versions[]` with a `citationsDiff`. The graph preserves its full history.

### Learning Schema (Key Fields)

The existing `LearningSchema` is enriched with graph-enabling fields:

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Unique identifier |
| `tier` | enum | Scope: step, flavor, stage, category, agent |
| `content` | string | The knowledge itself |
| `confidence` | 0–1 | Computed from evidence count and consistency |
| `citations` | Citation[] | Links to source kansatsu |
| `derivedFrom` | UUID[] | Parent learnings this was synthesized from |
| `reinforcedBy` | Reinforcement[] | Additional evidence that strengthened this |
| `usageCount` | number | Times injected into agent prompts |
| `lastUsedAt` | datetime | When last used in a prompt |
| `versions` | Version[] | Full mutation history with citation diffs |
| `archived` | boolean | Soft-delete (never hard-deleted — provenance) |
| `permanence` | enum | Tier: operational, strategic, constitutional |
| `source` | enum | How created: extracted, synthesized, imported, user |
| `overrides` | UUID[] | Learnings this supersedes |
| `refreshBy` | datetime | When this should be re-evaluated |
| `expiresAt` | datetime | Auto-archive date (operational learnings) |

### Learning Tiers

Learnings are scoped to a level of the hierarchy:

| Tier | Scope | Example |
|------|-------|---------|
| `waza` (step) | A specific methodology waza | "The 'write-tests' waza benefits from seeing existing test patterns first" |
| `ryu` (flavor) | A waza composition | "TDD ryu works better than code-first for data models" |
| `gyo` (stage) | A mode of work | "Research gyo needs longer timeout for external API calls" |
| `category` | Cross-gyo pattern | "This codebase benefits from thorough planning before building" |
| `kataka` (agent) | A specific kataka | "scout-ka tends to over-scope research topics" |

Promotion happens when waza-level patterns appear 3+ times: they become ryu or gyo learnings.

### What the Graph Enables

| Capability | How |
|-----------|-----|
| **Provenance** | "Why does Kata believe X?" → follow citations to raw kansatsu |
| **Evidence-based confidence** | More citations + reinforcements = higher confidence (quantitative, not hallucinated) |
| **Contradiction detection** | Two learnings with conflicting content + overlapping citations = friction signal |
| **Knowledge decay** | Learnings without recent reinforcement lose relevance over time |
| **Impact analysis** | "If I archive this kansatsu, which learnings lose evidence?" |
| **Synthesis quality** | LLM sees full evidence chains when consolidating — better reasoning |
| **Agent context** | Kataka agents receive learnings with provenance, can assess trustworthiness |
| **Resurrection** | Archived learning matching new kansatsu → unarchive with fresh citations |

---

## 3. The Self-Improvement Loop

The complete loop that makes Kata compound over time:

```text
                    ┌─────────────────────┐
                    │   KIAI (execution)   │
                    │   Kataka run gyo     │
                    │   Kansatsu pile up   │
                    │   as JSONL           │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   MA (cooldown)      │
                    │   Pattern detection  │
                    │   Learning creation  │
                    │   Synthesis          │
                    │   Graph updates      │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   BUNKAI STORE      │
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
                    │   kataka prompts     │
                    └─────────┬───────────┘
                              │
                              ▼
                    ┌─────────────────────┐
                    │   NEXT KIAI         │
                    │   Kataka has better  │
                    │   context from       │
                    │   accumulated        │
                    │   bunkai             │
                    └─────────────────────┘
```

Each keiko (cycle) through the loop adds kansatsu, strengthens or creates learnings, updates the graph, and produces better prompts for the next run. The system gets better through use — not through manual configuration.

### Phase 1: Kansatsu Capture

During kiai, kataka record kansatsu via `kata kansatsu`. The orchestration skill instructs kataka to capture kansatsu at natural kime points — when they choose between approaches, when they notice something unexpected, when they hit friction. Kansatsu are cheap (append-only JSONL) and don't slow execution.

### Phase 2: Pattern Detection (Ma)

During ma, the LearningExtractor detects patterns across a run's kansatsu:
- **Frequency patterns**: Same kansatsu type appearing 3+ times → potential learning
- **Prediction calibration**: Predictions checked against outcomes → confidence adjustment
- **Friction clustering**: Related frictions across gyo → systemic issue
- **Gap recurrence**: Same gap appearing across runs → unaddressed problem

### Phase 3: Bunkai Injection

The ManifestBuilder reads learnings relevant to the upcoming gyo and injects them into the kataka's prompt context. Learnings come with provenance:

```text
Learning: "TDD approach reduces rework by ~40% in this codebase"
  Confidence: 0.85 (based on 6 kansatsu across 3 runs)
  Reinforced: 2 times in the last keiko
  Derived from: 2 gyo-level learnings about test coverage
```

The kataka can make informed kime about how much to trust each learning. **Quantitative trust from structure** — not hallucinated confidence scores.

### Phase 4: Kime Tracking

Every kime is logged with context, options, reasoning, and confidence. Later, outcomes are recorded. Over time, this reveals which types of kime lead to good outcomes — enabling the system to adjust confidence thresholds and rule weights.

---

## 4. Detection Engines

Specialized engines that analyze kansatsu for specific signal types.

### Prediction Calibration

Predictions are matched against outcomes to detect systematic biases:

| Algorithm | What it detects | Threshold |
|-----------|----------------|-----------|
| **Overconfidence** | Consistently high confidence with poor outcomes | 5+ predictions |
| **Domain bias** | Predictions accurate in domain X but not Y | 5+ per domain |
| **Estimation drift** | Quantitative estimates systematically over/under | 3+ estimates |
| **Predictor divergence** | Different kataka/gyo have different calibration | 8+ kansatsu |

### Friction Detection

Frictions are analyzed for systemic patterns:

| Taxonomy | Description | Resolution path |
|----------|-------------|----------------|
| **Stale learning** | A learning contradicts current evidence | Invalidate or scope |
| **Seido (config) drift** | Configuration doesn't match actual practice | Synthesize |
| **Convention clash** | Two valid conventions in conflict | Escalate to user |
| **Tool mismatch** | Tool assumptions don't match project reality | Scope |
| **Scope creep** | Work expanding beyond original boundaries | Escalate |

Four resolution paths with confidence gating: invalidate, scope, synthesize, escalate.

### Reflection Schema

Reflections are the output of detection engines — structured assessments produced during ma:

| Type | What it produces |
|------|-----------------|
| **Calibration** | Prediction accuracy analysis for a domain/kataka |
| **Validation** | Prediction matched to outcome (correct/incorrect) |
| **Resolution** | Friction resolved through one of the 4 paths |
| **Unmatched** | Prediction with no matching outcome (inconclusive) |
| **Synthesis** | Multiple reflections consolidated into a higher-level insight |

---

## 5. Learning Permanence

Not all knowledge has the same shelf life. The permanence system ensures learnings are treated appropriately.

### Three Permanence Tiers

| Tier | TTL | Example |
|------|-----|---------|
| **Operational** | Short (configurable, default ~30 days) | "The staging server is slow this week" |
| **Strategic** | Long (no auto-archive, flagged stale in ma) | "TDD reduces rework in this codebase" |
| **Constitutional** | Permanent (immutable — archive or override, never modify) | "Always run tests before merging" |

### Lifecycle

- **Operational learnings** auto-archive when their TTL expires
- **Strategic learnings** get flagged as stale in ma if not reinforced recently
- **Constitutional learnings** cannot be modified — only archived (with reason) or overridden by a new constitutional learning
- **Promotion/demotion**: Operational → strategic → constitutional (and reverse) based on reinforcement
- **Confidence decay**: Computed at read time. Learnings lose confidence gradually if not reinforced, with decay rate depending on tier

### Constitutional Packs

Pre-built sets of constitutional learnings for common domains. A generic domain-agnostic pack ships with universal best practices (test before merge, review before deploy, etc.).

---

## 6. LLM Synthesis Pipeline

The synthesis pipeline is where raw kansatsu and pattern-detected learnings are consolidated into higher-order bunkai by an LLM.

### Three-Step Pipeline

```text
Step 1: FILTER (rules-based)
  Select kansatsu + learnings eligible for synthesis
  Skip: too few citations, already synthesized this keiko, archived
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
| **new-learning** | Create a learning from kansatsu that haven't been captured |
| **update-learning** | Modify an existing learning based on new evidence |
| **promote** | Elevate a learning's tier (waza → ryu → gyo → category) |
| **archive** | Retire a learning that evidence no longer supports |
| **methodology-recommendation** | Suggest a rule or seido change |

### Configurable Depth

| Depth | What it does | When to use |
|-------|-------------|-------------|
| **quick** | Filter + basic pattern detection only | Fast ma sessions, small runs |
| **standard** | Full 3-step pipeline | Default |
| **thorough** | Multiple synthesis passes, cross-keiko analysis | Major milestone keiko |

---

## 7. Domain Confidence

Domain confidence tracks how well Kata's bunkai covers a particular technical domain, enabling informed risk assessment.

### Four-Axis Tag Vocabulary

| Axis | Examples | Count |
|------|---------|-------|
| **Domain** | web-frontend, backend-api, data-pipeline, devops, security | ~15 |
| **Language family** | typescript, python, rust, go, java, etc. | 13 enum |
| **Framework** | react, express, django, etc. | Open vocabulary |
| **Architecture** | monolith, microservice, serverless, etc. | ~10 |

Tags are stored on Bets and RunState. Three sources: user-assigned, auto-detected, LLM-inferred.

### Composite Confidence Score

Confidence per domain tag is a composite of:
- **Familiarity**: How many runs have covered this domain?
- **Risk**: How complex/novel is the work?
- **Historical performance**: How well have past runs in this domain gone?

Materialized during ma, injected as informational context into prompts.

---

## 8. Hierarchical Bunkai Capture

Bunkai doesn't just exist at one level. A pattern that appears in a single waza might be relevant to the whole gyo, or even the whole project.

### Capture at Every Level

Kansatsu are recorded at the level where they occur:
- **Waza-level**: "This specific test-writing waza works better with 3 examples"
- **Ryu-level**: "TDD ryu outperforms code-first in data layer work"
- **Gyo-level**: "Build gyo needs longer timeouts for CI integration"
- **Run-level**: "Cross-cutting: this project benefits from early architecture kime"

### Promotion Rules

| From | To | Condition |
|------|-----|-----------|
| Waza kansatsu | Waza learning | 3+ similar kansatsu |
| Waza learning | Ryu learning | Pattern in 3+ waza within the ryu |
| Ryu learning | Gyo learning | Pattern in 2+ ryu within the gyo |
| Gyo learning | Category learning | Pattern in 2+ gyo |

### BunkaiStore Upgrades

Hierarchy-aware methods:
- `loadForStep(stepId)` — Waza-level learnings + inherited from ryu/gyo/category
- `loadForFlavor(flavorId)` — Ryu-level learnings + inherited from gyo/category
- Archive/resurrection logic: archived learnings matching new kansatsu can be resurrected with fresh citations

---

## 9. How Kataka Use the Bunkai

When a kataka starts a gyo, the ManifestBuilder injects relevant learnings into its prompt. With the full bunkai graph, those learnings carry rich context:

```markdown
## Project Bunkai (injected by Kata)

### High Confidence (0.85+)
- "TDD approach reduces rework by ~40% in this codebase"
  Evidence: 6 kansatsu across 3 runs, reinforced 2x this keiko
  Permanence: Strategic | Last used: 2 days ago

### Medium Confidence (0.5–0.85)
- "React Server Components simplify data fetching in this project"
  Evidence: 2 kansatsu from 1 run
  Permanence: Operational | Expires: 28 days

### Domain Context
- Confidence: High (TypeScript/React), Medium (API design), Low (deployment)
- Recent frictions: 2 unresolved (convention clash in test naming)
```

The kataka can make informed kime about how much to trust each piece of bunkai. **Quantitative trust from structure** — not hallucinated confidence.

---

## 10. File Map

| File/Path | Purpose |
|-----------|---------|
| `.kata/runs/{id}/**/observations.jsonl` | Raw kansatsu (immutable) |
| `.kata/runs/{id}/**/reflections.jsonl` | Detection engine output |
| `.kata/knowledge/learnings/{id}.json` | Individual bunkai files (versioned) |
| `.kata/knowledge/graph-index.json` | Graph edges: learning↔kansatsu links |
| `.kata/rules/{id}.json` | Orchestration rules |
| `.kata/dojo/diary/{keiko-id}.json` | Narrative reflections |

---

## Design Principles

1. **Quantitative from structure, qualitative from LLM.** Confidence scores come from citation counts and evidence consistency — not from asking an LLM "how confident are you?" LLMs provide the qualitative synthesis; structure provides the numbers.

2. **Append-only kiai data.** Kansatsu are never modified. Learnings are versioned, not overwritten. The graph preserves provenance even for bunkai that has been superseded.

3. **Capture all, analyze selectively.** Kansatsu are captured at every hierarchy level during kiai (cheap, append-only). Analysis happens only during ma (expensive, LLM-powered).

4. **Soft delete only.** Learnings are never hard-deleted — they're archived. You can always trace back to the raw kansatsu through citations.

5. **Progressive improvement.** Zero seido (configuration) still works. The meta-learning system expands organically through use.

---

*See [Implementation Roadmap](unified-roadmap.md) for wave sequencing. See [Kata System Guide](kata-system-guide.md) for how meta-learning fits into the broader system.*
