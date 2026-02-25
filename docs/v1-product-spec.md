# Kata v1 Product Specification

> Authored 2026-02-24. Discovery interview between Christopher Bays and Claude.
> This document captures the complete product specification for Kata v1: user stories, architecture, breadboards, gap analysis, and work breakdown.
> Companion to: `docs/v1-design-vision.md` (architectural decisions), issue #93 (epic).

---

## 1. Product Vision & Principles

### Vision Statement

Kata is a **development methodology engine** — a framework that encodes how AI agents should approach complex work. It provides structure (stages, flavors, steps, gates), tracks execution state, captures artifacts and decisions, and drives self-improvement. It does NOT execute agents or make LLM calls itself.

**North star**: A solo developer configures Kata as their methodology framework, then delegates execution to AI agents with minimal, deliberate human touchpoints. The system is **autonomous by default, observable always, and human-in-the-loop only where explicitly configured.**

### Core Principles

1. **Methodology framework, not agent runtime.** Kata is the railroad tracks. The agent is the train. Different trains (Claude Code, Composio, future tools) run on the same tracks.

2. **Optimistic trust in v1.** Gates are checklists with cues, not hard blocks. We trust the agent to follow the methodology, check gates, and record work honestly. Strict enforcement is a v2/v3 concern.

3. **The skill file is the primary interface.** For agent consumers, a well-written skill package is more important than a complex API surface. The agent reads the methodology, uses CLI commands for structured operations, and reads state files directly for everything else.

4. **Observable by default.** Every non-deterministic decision is logged with context, options, reasoning, confidence, and outcomes. This enables after-the-fact review AND self-improvement without requiring real-time supervision.

5. **Progressive improvement.** The system gets better through use. Rules accumulate, vocabularies expand, gap analysis surfaces methodology holes, and cooldown drives reflection. A user with zero configuration still gets value; configuration grows organically.

6. **Configurable human surface.** The user decides exactly where they need to be involved. Gates enforce those touchpoints. Everything else runs autonomously. `--yolo` suppresses optional gates while preserving all tracing.

---

## 2. User Stories (Prioritized)

### US-1: Autonomous Execution with Methodology Choice

> As a developer, I give an agent a bet and choose the methodology — a saved kata pattern (`--kata full-feature`) or an ad-hoc sequence (`--gyo research,plan,build,review`). It executes the full methodology autonomously, producing traced artifacts and decisions at every step so I can always look back and see what happened.

**Acceptance criteria:**
- Agent receives a bet (prompt/description) and a kata pattern
- Execution proceeds through stages with the 6-phase orchestration loop per stage
- Every decision is recorded with confidence scoring
- Every artifact is captured with provenance (which step, flavor, stage produced it)
- Full execution history is queryable after completion

### US-2: Methodology Authoring

> As a developer, I create new steps (waza), compose them into flavors (ryu) within stages (gyo), and save these as reusable methodology workflows. I configure which skills, agents, and tools each flavor should use. After reviewing how katas ran, I identify gaps and create new flavors or adjust gate placement.

**Acceptance criteria:**
- Interactive TUI and CLI for creating/editing steps, flavors, and kata patterns
- Flavor configuration includes: ordered steps, overrides, and resource hints (skills, agents, tools)
- Saved kata patterns in `.kata/config.json`
- Step resources (tools, agents, skills) are serialized into prompts for the executing agent
- After-the-fact review surfaces gaps (stages where no good flavor existed)

### US-3: Agent-as-Skill

> As an AI agent, I load Kata as a skill and use it to structure my work. The methodology provides guardrails for my non-deterministic judgment — I break complex bets into discrete, traceable steps. I use CLI commands to record artifacts and decisions, check gates, and advance state.

**Acceptance criteria:**
- Skill package loadable by Claude Code (and adaptable for other agent platforms)
- Skill file teaches the agent: methodology structure, CLI commands, file locations, workflow guidelines
- Agent can query state (`kata status --json`), record work (`kata artifact record`, `kata decision record`), and check gates
- Sub-agents spawned by the main agent also receive relevant skill context
- Zero-code-change integration — the agent uses CLI commands and reads files

### US-4: Cycle-Driven Execution + Interactive Monitoring

> As a developer, I set up a cycle with bets, assign each bet a kata pattern, and launch them as concurrent runs. While running, I monitor progress through a TUI dashboard and converse with my agent about live state — approving gates, asking about artifacts, and providing input.

**Acceptance criteria:**
- Bets are assigned a kata pattern when added to a cycle
- `kata cycle start` validates all bets have assignments, creates run directories, begins execution
- Execution monitor TUI (`kata watch`) shows: global summary, per-pipeline state, pending gates, confidence flags
- TUI supports gate approval interactivity
- Conversational interface (Claude) can query the same state and take the same actions
- Each bet avatar in TUI has unique color + stage-indicator state

### US-5: Cooldown, Review, and Self-Improvement

> As a developer, I work with my agent through cooldown — reflecting on what worked, reviewing decisions and confidence levels, capturing learnings, identifying methodology improvements (new rules, resources, flavors), and feeding improvements into the next cycle's bets.

**Acceptance criteria:**
- Cooldown reads all run data: artifacts, decisions, confidence levels, gaps
- Patterns surfaced: recurring low confidence, gap analysis findings, rule suggestions
- Interactive session for recording learnings and bet outcomes
- Learnings feed back into vocabularies, rules, and orchestrator prompts
- Next-cycle bet proposals generated from reflection output
- Low-confidence decisions from `--yolo` runs are surfaced for review

---

## 3. Architecture Overview

### 3.1 Philosophy: Methodology Framework, Not Agent Runtime

Kata is a **structured journal + checklist system** that an intelligent agent follows. It provides:

| Kata provides | Kata does NOT provide |
|--------------|----------------------|
| Methodology definition (stages, flavors, steps, gates, prompts) | Agent spawning or lifecycle management |
| State tracking (where is each pipeline, what's been done) | LLM API calls or prompt execution |
| Recording system (artifacts, decisions, confidence levels) | Code execution or tool invocation |
| Reflection system (self-improvement from accumulated data) | Real-time agent control or blocking |
| CLI commands for structured operations | Agent-specific integrations |

The agent layer is pluggable via skill/adapter packages:
- **v1**: Claude Code skill package (the proof of concept)
- **Future**: Composio adapter, other agent platforms

### 3.2 Three-Tier Hierarchy

```
Stage (gyo) — 4 fixed categories: research, plan, build, review
  └── Flavor (ryu) — user-configurable compositions of steps
       └── Step (waza) — atomic methodology units with gates, artifacts, resources
```

- **Stages** are modes of work. Fixed enum, not user-editable. Each has a vocabulary driving orchestration.
- **Flavors** are workflows. User creates, edits, shares them. Multiple run in parallel within a stage.
- **Steps** are atomic units. Reusable across flavors. Have entry/exit gates, artifact definitions, and resource hints.

### 3.3 Execution Model: Optimistic Trust

In v1, Kata provides structure and the agent follows it on good faith:

- **Gates are checklists, not hard blocks.** The skill file instructs the agent to check gates before advancing. There's no runtime enforcement preventing an agent from skipping.
- **Confidence thresholds are cues.** When a decision's confidence drops below the threshold (default 0.7), the agent is instructed to pause and ask the user. With `--yolo`, it logs the low confidence and continues.
- **Artifacts are recorded, not validated.** The agent records what it produced. Kata doesn't verify artifact content quality (that's what the review stage is for).
- **All tracing happens regardless.** Whether the agent follows perfectly or not, the decision log, artifact log, and state transitions are captured for cooldown review.

### 3.4 Agent Interface: CLI + File Access + Skill Package

The agent interacts with Kata through three channels:

**1. CLI commands (structured operations):**
- `kata status --json` — query execution state
- `kata artifact record` — record an artifact with provenance
- `kata decision record` — record a decision with metadata
- `kata approve` — approve a human gate
- `kata step next` — query what to work on next
- `kata cycle start` — initialize runs for all bets

**2. Direct file access (read state, drill into details):**
- `.kata/runs/<run-id>/run.json` — overall run state
- `.kata/runs/<run-id>/stages/<stage>/` — stage-level state and artifacts
- `.kata/runs/<run-id>/decisions.jsonl` — decision log
- Agent reads these directly when it needs detail beyond what CLI provides

**3. Skill package (instructions + reference):**
- Teaches the agent how Kata works, when to use which commands, how to orchestrate
- Includes workflow guidelines, context flow patterns, CLI reference
- Distributed to all sub-agents spawned during execution

### 3.5 Orchestration Engine: 6-Phase Loop

Each stage runs a 6-phase orchestration loop (already implemented in `BaseStageOrchestrator`):

```
┌─────────────────────────────────────────────────┐
│ 1. ANALYZE                                       │
│    Build CapabilityProfile from:                 │
│    - Bet context (original prompt)               │
│    - Available artifacts (from prior stages)     │
│    - Active rules                                │
│    - Learnings from prior cycles                 │
│    → Decision: capability-analysis               │
│                                                  │
│ 2. MATCH                                         │
│    Score candidate flavors against profile:      │
│    - Vocabulary keywords                         │
│    - Boost rules                                 │
│    - Learning boost                              │
│    - Rule adjustments                            │
│    → MatchReport[] with scores + reasoning       │
│                                                  │
│ 3. PLAN                                          │
│    Select flavors + execution mode:              │
│    → Decision: flavor-selection                  │
│    → Decision: execution-mode (parallel/seq)     │
│    → Gap analysis: identify uncovered areas      │
│    → Decision: gap-assessment                    │
│                                                  │
│ 4. EXECUTE                                       │
│    Run selected flavors (parallel or sequential) │
│    Each flavor = sub-agent with step sequence    │
│    → FlavorExecutionResult[] collected           │
│                                                  │
│ 5. SYNTHESIZE                                    │
│    Merge per-flavor synthesis artifacts           │
│    → Decision: synthesis-approach                │
│    → Stage-level synthesis artifact              │
│                                                  │
│ 6. REFLECT                                       │
│    Review decision outcomes:                     │
│    → Update outcome records                      │
│    → Generate rule suggestions                   │
│    → Capture learnings                           │
└─────────────────────────────────────────────────┘
```

**Heritage**: Generalized from the review orchestration engine's 6-stage pipeline (Normalize → Classify → Compose → Gap Detect → Dispatch → Aggregate). The gap detection concept maps directly to Phase 3's gap analysis.

---

## 4. Breadboards

### 4.1 Init / Onboarding

**Two tiers of initialization:**

```
BASIC SCAN (kata init --scan basic)
──────────────────────────────────
User: "kata init" or tells Claude "set up kata for this project"

Claude (with kata skill):
  → kata init (creates .kata/ directory with defaults)
  → Scans repo:
    - .claude/ directory (skills, agents, MCP servers)
    - Project type (package.json, Cargo.toml, etc.)
    - Tool configs (eslint, vitest, biome, etc.)
    - Dependencies (testing frameworks, linters, etc.)
  → Classifies resources into stage categories
  → Proposes flavors based on what exists
  → Interactive refinement with user
  → Creates steps, flavors, kata patterns via CLI

FULL SCAN (kata init --scan full)
─────────────────────────────────
Everything in basic, plus:
  → Git history analysis (rework-heavy areas, common correction patterns)
  → Framework-aware recommendations:
    "This is a Next.js project. Community-standard tools include
     Playwright for E2E, next-safe-action for server actions.
     You're missing Playwright — consider an e2e-testing flavor."
  → Gap identification against best practices
  → Deeper, more opinionated proposals
```

**Cold start value**: With zero configuration, built-in steps and default flavors provide immediate structure. The init scan accelerates customization by leveraging what's already in the repo.

### 4.2 Cycle Setup (Betting Phase)

```
User: "Let's set up our next cycle."

Claude (with kata skill):
  → kata cycle new "Q1 Sprint 3"

User: "Pull in the top 3 issues from Linear."

Claude:
  → (reads Linear via its own capabilities — kata doesn't own this)
  → "Found: AUTH-42, PERF-18, UI-99"
  → "I'd suggest full-feature kata for AUTH-42 and PERF-18, quick-fix for UI-99"
  → kata cycle add-bet <cycle-id> "implement user auth (AUTH-42)" --kata full-feature
  → kata cycle add-bet <cycle-id> "optimize query performance (PERF-18)" --kata full-feature
  → kata cycle add-bet <cycle-id> "redesign dashboard (UI-99)" --kata quick-fix

User: "Looks good. Start it."

Claude:
  → kata cycle start <cycle-id>
  → Validates: every bet has a kata assigned ✓
  → Creates .kata/runs/<run-1>/ (AUTH-42)
  → Creates .kata/runs/<run-2>/ (PERF-18)
  → Creates .kata/runs/<run-3>/ (UI-99)
  → Spawns 3 bet teammates (Claude Code teams)
  → "Cycle started. 3 pipelines running.
     Open kata watch in another pane to monitor."
```

**Key data model**: Bet schema includes a `kata` field (the pattern name or ad-hoc gyo sequence). Cycle cannot start until every bet has an assignment.

### 4.3 Execution (kata kiai)

**Agent hierarchy during execution:**

```
Main Claude (user-facing orchestrator)
├── Bet-1 teammate (AUTH-42, full-feature)
│   ├── Stage: RESEARCH
│   │   ├── 6-phase orchestration loop
│   │   ├── Flavor sub-agent: technical-research
│   │   └── Flavor sub-agent: codebase-analysis
│   ├── Stage: PLAN
│   │   ├── 6-phase orchestration loop
│   │   └── Flavor sub-agent: architecture
│   ├── Stage: BUILD ...
│   └── Stage: REVIEW ...
├── Bet-2 teammate (PERF-18, full-feature)
│   └── ...
└── Bet-3 teammate (UI-99, quick-fix)
    └── ...
```

**Bet teammate is the stage orchestrator.** It:
1. Reads the kata pattern → knows the stage sequence
2. For each stage, runs the 6-phase loop (analyze, match, plan, execute, synthesize, reflect)
3. During execute phase, spawns sub-agents for each selected flavor
4. Sub-agents work through their step sequence, recording artifacts and decisions
5. Sub-agents shut down after their final exit gate
6. Bet teammate does synthesis, advances to next stage
7. After all stages complete, reports to main Claude and shuts down

### 4.4 Stage Orchestration Detail

```
BET-1 TEAMMATE entering RESEARCH stage:

Phase 1: ANALYZE
  → Reads bet prompt: "implement user auth (AUTH-42)"
  → Checks available artifacts: none (first stage)
  → Loads rules: .kata/rules/research/*.json
  → Loads learnings from prior cycles
  → Records Decision: capability-analysis

Phase 2: MATCH
  → Loads research vocabulary (keywords: explore, research, discovery...)
  → Scores available flavors:
    - technical-research: 0.85 (keyword hits: "security", "auth")
    - codebase-analysis: 0.78 (boost from "implementation" artifact pattern)
    - market-research: 0.3 (no keyword overlap with bet context)
  → MatchReport[] produced

Phase 3: PLAN
  → Selects: technical-research, codebase-analysis
  → Execution mode: parallel (2 < maxParallelFlavors of 5)
  → GAP ANALYSIS:
    "No security-focused research flavor available.
     Auth bets typically benefit from security context.
     Severity: medium."
  → Records Decisions: flavor-selection, execution-mode, gap-assessment
  → If any decision confidence < threshold:
    ├── --yolo: log, continue
    └── interactive: pause, surface to user, wait for input

Phase 4: EXECUTE
  → Spawns 2 flavor sub-agents in parallel
  → Each sub-agent receives:
    1. Bet prompt (original context)
    2. Step prompts for their flavor's steps
    3. Step resources (tools, agents, skills to use)
    4. Skill package subset (CLI reference, context flow doc)
    5. Previous stage synthesis (if not first stage)
  → Sub-agents work through steps:
    - Read step prompt + context
    - Do the work
    - kata artifact record <run-id> --stage research --flavor <name> --step <step>
    - Check exit gates (self-evaluated checklist)
    - Advance to next step
    - Final step produces flavor synthesis artifact
  → Sub-agents shut down after exit gate

Phase 5: SYNTHESIZE
  → Reads flavor synthesis artifacts (technical-research + codebase-analysis)
  → Merges per vocabulary preference (cascade for research)
  → Produces stages/research/synthesis.md
  → Records Decision: synthesis-approach

Phase 6: REFLECT
  → Reviews all decisions made in this stage
  → Evaluates: were artifacts good/partial/poor?
  → Generates rule suggestions:
    "codebase-analysis consistently selected for auth bets → suggest boost rule"
  → Updates decision outcomes
  → Captures learnings

→ Advance to PLAN stage (synthesis.md is the handoff input)
```

### 4.5 Monitoring (TUI + Conversational)

**Two complementary interfaces reading the same `.kata/` state:**

**Execution Monitor TUI (`kata watch`):**

```
┌──────────────────────────────────────────────────────────────┐
│ 󰓏  KATA WATCH    Cycle: Q1 Sprint 3     3 pipelines        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  🤺 BET-1  AUTH-42 user auth        ▓▓▓▓░░░░  PLAN         │
│     kata: full-feature               ⚠ gate pending         │
│     flavors: architecture, shaping   confidence: 0.82       │
│                                                              │
│  🧘 BET-2  PERF-18 query optim      ▓▓░░░░░░  RESEARCH     │
│     kata: full-feature               ● running               │
│     flavors: technical, codebase     confidence: 0.91       │
│                                                              │
│  🧘 BET-3  UI-99 dashboard          ▓░░░░░░░  RESEARCH      │
│     kata: quick-fix                  ● running               │
│     flavors: codebase-analysis       confidence: 0.88       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [Enter] drill in   [a] approve gate   [q] quit             │
└──────────────────────────────────────────────────────────────┘

Avatar states (per stage):
  🧘 Research (meditation/study)
  🤺 Plan (ready stance)
  ⚔️  Build (active combat)
  🔍 Review (inspection)
  🙇 Cooldown (reflection/bow)
  🏆 Complete

Color = bet identity (unique per pipeline)
Avatar pose = current stage
```

**Pipeline detail view (drill-in):**

```
┌──────────────────────────────────────────────────────────────┐
│ 🤺 BET-1: AUTH-42 — implement user auth                     │
│ kata: full-feature  (research → plan → build → review)       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ✓ RESEARCH  2 flavors completed                              │
│   ✓ technical-research (3 artifacts)                         │
│   ✓ codebase-analysis (2 artifacts)                          │
│   ✓ synthesis: research/synthesis.md                         │
│   ⚠ gap: no security-research flavor (medium)                │
│   Decisions: 4 (avg confidence: 0.87)                        │
│                                                              │
│ ● PLAN  ⚠ gate pending: plan-approval                        │
│   ✓ architecture (2 artifacts)                               │
│   ● task-breakdown — waiting for gate                        │
│   Decisions: 3 (avg confidence: 0.82)                        │
│                                                              │
│ ○ BUILD  (not started)                                       │
│ ○ REVIEW (not started)                                       │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ [a] approve gate  [d] decisions  [s] artifacts  [←] back     │
└──────────────────────────────────────────────────────────────┘
```

**Conversational interface (Claude):**
- User talks to main Claude about running pipelines
- Claude reads `kata status --json` and presents formatted summaries
- User can approve gates: "Approve the plan for AUTH-42" → Claude runs `kata approve <gate-id>`
- User can ask about artifacts: "Show me the research synthesis for bet 2" → Claude reads the file
- User can provide input for confidence gates: Claude records response on the decision

**Configuration TUI (`kata config`):**
- Interactive editor for creating/editing steps, flavors, kata patterns
- Full interactivity (not read-only)
- Separate from the execution monitor

### 4.6 Cooldown & Reflection

```
(All bet pipelines complete)

Main Claude:
  → "All 3 bets have completed. Ready for cooldown?"

User: "Yes."

Claude:
  → kata cooldown start <cycle-id>
  → Reads all run data across the cycle:
    - Artifacts, decisions, confidence levels
    - Gap analysis findings from each stage
    - Rule suggestions generated during reflect phases

  → "Here's what I'm seeing across the cycle:

     AUTH-42: completed smoothly, high confidence
       - Gap: no security research flavor (surfaced in research stage)
       - 2 decisions below 0.7 confidence (logged via --yolo)

     PERF-18: had a low-confidence decision in build
       - Chose index strategy at 0.58 confidence
       - No --yolo — user was asked, provided input

     UI-99: smooth, single-flavor stages mostly

     Patterns across all bets:
       - codebase-analysis selected in all 3 research stages
       - Build stage consistently took longest
       - 3 rule suggestions generated:
         1. Boost codebase-analysis for auth-related bets
         2. Add security-research flavor to research stage
         3. Reduce confidence threshold for index strategy decisions

     Would you like to review these suggestions?"

User: "Accept the boost rule. Let's create the security-research flavor.
       The index strategy actually worked well — reject that suggestion."

Claude:
  → Accepts rule suggestion (kata knowledge rules accept <id>)
  → Creates security-research flavor interactively
  → Rejects index strategy suggestion with outcome note
  → Records learnings

  → "Ready to set up next cycle bets? I see 2 new items in Linear
     and AUTH-42 has a follow-up for rate limiting."
```

### 4.7 Self-Improvement Cycle

```
                     ┌──────────────┐
                     │  EXECUTION   │
                     │  (kiai runs) │
                     └──────┬───────┘
                            │
                    Decisions, artifacts,
                    confidence scores, gaps
                            │
                     ┌──────▼───────┐
                     │   COOLDOWN   │
                     │ (reflection) │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        Rule suggestions  Learnings  Vocabulary
        (auto-generated)  (captured)  additions
              │             │             │
              ▼             ▼             ▼
        ┌───────────────────────────────────┐
        │     METHODOLOGY CONFIGURATION     │
        │  Rules, vocabularies, flavors,    │
        │  step resources, kata patterns    │
        └───────────────┬───────────────────┘
                        │
                Improved scoring,
                better flavor selection,
                fewer gaps
                        │
                 ┌──────▼──────┐
                 │ NEXT CYCLE  │
                 │ (better)    │
                 └─────────────┘
```

**Inputs to self-improvement:**
- Decision outcomes (good/partial/poor artifact quality, rework needed)
- Gap analysis findings (uncovered areas in methodology)
- User responses to confidence-gate questions (parsed into vocabularies/rules)
- Low-confidence decisions from --yolo runs (surfaced in cooldown)

**Outputs:**
- New/updated rules (boost, penalize, require, exclude flavors)
- Vocabulary keyword additions (better matching)
- New flavor suggestions (covering identified gaps)
- Step resource recommendations (tools/agents that would help)

---

## 5. Command Surface

### Existing Commands

| Command | Alias | Sub-commands | Description |
|---------|-------|-------------|-------------|
| `kata init` | `rei` | — | Initialize project (basic/full scan) |
| `kata stage` | `gyo` | `list`, `inspect` | View fixed stage categories |
| `kata step` | `waza` | `list`, `inspect`, `create`, `edit`, `delete` (`wasure`), `rename` | CRUD for atomic methodology steps |
| `kata flavor` | `ryu` | `list`, `inspect`, `create`, `delete` (`wasure`), `validate` | CRUD for step compositions |
| `kata cycle` | `keiko` | `new`, `status`, `focus` | Cycle and bet management |
| `kata cooldown` | `ma` | — | Reflection session |
| `kata knowledge` | `bunkai` | `query`, `stats`, `rules`, `review` | Learning system |
| `kata execute` | `kiai` | (categories), `status`, `stats` | Stage orchestration |
| `kata status` | — | — | Project overview |
| `kata stats` | — | — | Aggregate analytics |

### New Commands Needed for v1

| Command | Alias (TBD) | Description |
|---------|-------------|-------------|
| `kata cycle add-bet` | — | Add a bet with assigned kata to a cycle |
| `kata cycle update-bet` | — | Update bet metadata (kata assignment, description) |
| `kata cycle start` | — | Validate bets, create runs, begin execution |
| `kata approve [gate-id]` | TBD (2-4 char) | Approve a pending human gate (interactive selector if no ID) |
| `kata watch` | TBD (2-4 char) | Launch execution monitor TUI |
| `kata config` | TBD (2-4 char) | Launch configuration TUI |
| `kata artifact record` | — | Record an artifact with full provenance |
| `kata decision record` | — | Record a decision with metadata |
| `kata step next <run-id>` | — | Query what to work on next (returns step + context) |
| `kata run status <run-id>` | — | Detailed status of a single pipeline run |

### Alias Design Rules

- Japanese karate-themed aliases for all CLI commands
- **2-4 characters** for frequent commands
- **5-6 characters** max for less common commands
- Thematically coherent with the karate/dojo metaphor
- Final alias validation after full command surface is locked in

### Flag Conventions

| Flag | Alias | Scope | Purpose |
|------|-------|-------|---------|
| `--kata <name>` | — | kiai, cycle start | Use saved kata pattern |
| `--gyo <stages>` | — | kiai | Ad-hoc stage sequence |
| `--yolo` | — | kiai, cycle start | Suppress non-mandatory gates |
| `--json` | — | All query commands | Machine-readable output |
| `--flavor` | `--ryu` | step commands | Filter by flavor |
| `--stage` | `--gyo` | flavor commands | Filter by stage |
| `--scan basic\|full` | — | init | Scan depth for initialization |

---

## 6. Data Model

### 6.1 Directory Structure

```
.kata/
  config.json                     # Project config, saved kata patterns
  rules/
    research/*.json               # Active rules per stage category
    plan/*.json
    build/*.json
    review/*.json
    suggestions/*.json            # Pending rule suggestions
  runs/
    <run-id>/
      run.json                    # Run metadata: bet, kata pattern, timestamps
      decisions.jsonl             # Append-only decision log (all stages)
      artifact-index.jsonl        # Run-level artifact index
      stages/
        research/
          state.json              # Stage state: flavors selected, status
          synthesis.md            # Cross-flavor synthesis artifact
          flavors/
            technical-research/
              state.json          # Flavor state: steps, current position
              artifact-index.jsonl # Flavor-level accumulating index
              artifacts/          # Step-produced artifacts
              synthesis.md        # Flavor synthesis (summary + index)
            codebase-analysis/
              ...
        plan/
          ...
        build/
          ...
        review/
          ...
  cycles/
    <cycle-id>/
      cycle.json                  # Cycle metadata, bets with kata assignments
  vocabularies/                   # Stage vocabularies (keywords, boost rules)
  steps/                          # Step definitions
  flavors/                        # Flavor definitions
  knowledge/                      # Learnings from prior cycles
  skill/                          # Skill package for agent consumers
```

### 6.2 State Files

**run.json** — Top-level run state:
```json
{
  "id": "<run-id>",
  "cycleId": "<cycle-id>",
  "betId": "<bet-id>",
  "betPrompt": "implement user auth (AUTH-42)",
  "kataPattern": "full-feature",
  "stageSequence": ["research", "plan", "build", "review"],
  "currentStage": "plan",
  "status": "running",
  "startedAt": "2026-02-24T...",
  "completedAt": null
}
```

**stages/<stage>/state.json** — Stage state:
```json
{
  "category": "research",
  "status": "completed",
  "selectedFlavors": ["technical-research", "codebase-analysis"],
  "executionMode": "parallel",
  "gaps": [
    { "description": "No security-research flavor", "severity": "medium" }
  ],
  "synthesisArtifact": "synthesis.md",
  "decisions": ["<decision-id-1>", "<decision-id-2>"],
  "startedAt": "...",
  "completedAt": "..."
}
```

**flavors/<flavor>/state.json** — Flavor state:
```json
{
  "name": "technical-research",
  "status": "completed",
  "steps": [
    { "name": "discovery", "status": "completed", "artifacts": ["auth-patterns.md"] },
    { "name": "analysis", "status": "completed", "artifacts": ["auth-recommendation.md"] },
    { "name": "synthesis", "status": "completed", "artifacts": ["synthesis.md"] }
  ],
  "currentStep": null
}
```

### 6.3 Artifact Tree (Progressive Summarization)

```
Context available to any step:

1. BET PROMPT (always, top-level)
   └── The original prompt/description for the bet

2. ALL PRIOR STAGE SYNTHESES
   └── research/synthesis.md → plan/synthesis.md → ...
   └── Each is a summary + index to dig deeper

3. STEP PROMPT (the specific directive for this step)

4. WITHIN-FLAVOR: all prior steps' artifacts
   └── artifact-index.jsonl accumulates as steps complete
   └── Each step sees everything before it in the flavor

5. ARTIFACT INDEX (traversable on demand)
   └── Run-level index links to all stage/flavor/step artifacts
```

**Contention-free by design:**
- Flavor artifact indexes: only one agent writes (steps are sequential within a flavor)
- Stage synthesis: produced after all flavors complete (one writer)
- Run-level index: updated after each stage completes (sequential)
- Decision log: JSONL append-only (atomic appends)

### 6.4 Decision Log

Append-only JSONL at run level (`.kata/runs/<run-id>/decisions.jsonl`):

```jsonl
{"id":"<uuid>","stageCategory":"research","decisionType":"capability-analysis","context":{...},"options":["..."],"selection":"...","reasoning":"...","confidence":0.87,"decidedAt":"..."}
{"id":"<uuid>","stageCategory":"research","decisionType":"flavor-selection","context":{...},"options":["technical-research","codebase-analysis","market-research"],"selection":"technical-research,codebase-analysis","reasoning":"Auth bet, technical focus","confidence":0.9,"decidedAt":"..."}
{"id":"<uuid>","stageCategory":"research","decisionType":"gap-assessment","context":{...},"options":[],"selection":"gap-detected","reasoning":"No security-research flavor available","confidence":0.75,"decidedAt":"..."}
```

Each decision includes full provenance: stage, flavor (if applicable), step (if applicable). Outcomes updated post-facto via `kata decision update`.

### 6.5 Rule Registry

Rules accumulate over time per stage category:

```json
{
  "id": "<uuid>",
  "category": "research",
  "name": "boost-codebase-analysis-for-auth",
  "condition": "bet context contains 'auth' or 'authentication'",
  "effect": "boost",
  "magnitude": 0.15,
  "confidence": 0.8,
  "source": "auto-detected",
  "evidence": ["run-1 selected codebase-analysis for auth bet", "run-4 same pattern"],
  "createdAt": "..."
}
```

Effects: `boost` | `penalize` | `require` | `exclude`
Sources: `auto-detected` (from reflection) | `user-created` (manual) | `imported`

---

## 7. Skill Package Design

```
.kata/skill/
  skill.md                # Main instructions: methodology overview, workflow guidelines
  cli-reference.md        # Every kata CLI command the agent should use, with examples
  file-structure.md       # How to read .kata/ directory, state files, artifact indexes
  orchestration.md        # How to map kata methodology to the agent's native team/task model
  context-flow.md         # How bet prompt + artifacts + prompts flow through steps
  classification.md       # Heuristics for resource classification (init scanning)
  templates/              # Example prompt templates, decision formats
```

**skill.md** is the entry point. It teaches the agent:
1. What Kata is and what the three-tier hierarchy means
2. The workflow: how to start a cycle, execute a kata, record artifacts, check gates
3. When to use CLI commands vs. reading files directly
4. How to handle human gates (pause, inform user, wait)
5. How to handle confidence thresholds (pause or log per --yolo flag)
6. How to spawn sub-agents for parallel flavor execution
7. What context each sub-agent should receive

**Sub-agents receive:** A focused subset of the skill package relevant to their role:
- Flavor-level agents: bet prompt, step prompts, step resources, CLI reference, context flow
- The main skill.md in condensed form so they understand the overall structure

---

## 8. TUI Design

### 8.1 Execution Monitor (`kata watch`)

- **Global view**: All running pipelines with summary state
- **Pipeline detail**: Drill into one pipeline for stage/flavor/step breakdown
- **Interactive**: Gate approval directly from TUI
- **Live-updating**: Watches `.kata/runs/` state files for changes
- **Technology**: TBD (Ink, blessed, or bubbletea if we consider Go for TUI)

### 8.2 Configuration TUI (`kata config`)

- **Full interactive editor** for methodology authoring
- Create/edit steps, flavors, kata patterns
- Assign resources (tools, agents, skills) to steps
- Configure gate conditions
- Validate flavor DAGs
- Technology: Same framework as execution monitor

### 8.3 Aesthetics

**Nerd Font icons** for stages:

| Stage | Icon | Theme |
|-------|------|-------|
| Research | 󰍉 | Exploration/study |
| Plan | 󰙅 | Blueprint/compass |
| Build | 󰣖 | Hammer/forge |
| Review | 󰑓 | Shield/check |
| Cooldown | 󰔟 | Meditation/moon |

**Bet avatars (kata-ka / practitioner):**
- Each bet gets a unique color (palette cycles)
- Avatar changes pose per stage (visual state indicator)
- Provides instant at-a-glance status: color = which bet, pose = which stage

**Animation**: Where possible, bet avatars should have basic animation (subtle movement, breathing, state transitions) to feel alive. This is polish, but it makes the tool feel intentional and crafted rather than generic.

**Design goal**: The TUI should feel intentional and alive, not generic. The karate theme should come through visually, not just in naming.

---

## 9. Gap Analysis: Current State vs. Needed

### What Exists and is Solid

| Area | Status | Notes |
|------|--------|-------|
| Three-tier hierarchy (Stage/Flavor/Step) | ✅ Complete | Schemas, registries, CLI CRUD |
| 6-phase orchestration loop | ✅ Complete | BaseStageOrchestrator, 6 phases |
| Vocabulary-driven scoring | ✅ Complete | 4 vocabularies, keyword matching |
| Decision recording + outcomes | ✅ Complete | DecisionRegistry with full schema |
| Rule registry + suggestion workflow | ✅ Complete | CRUD + accept/reject flow |
| Step resources (tools, agents, skills) | ✅ Complete | Schema defined on Step |
| Meta-orchestrator (stage sequencing) | ✅ Complete | Linear stage sequence with handoff |
| Flavor validation (DAG check) | ✅ Complete | Validates artifact dependencies |
| CLI for step/flavor/cycle management | ✅ Complete | Full CRUD with aliases |
| Saved kata patterns | ✅ Complete | In config.json, --kata/--gyo flags |
| Knowledge store + learnings | ✅ Complete | Capture, query, load |
| 1348 tests passing | ✅ Complete | 74 test files |

### What's Stubbed / Partially Built

| Area | Status | Gap |
|------|--------|-----|
| Rule adjustments in matching | 🟡 Stubbed | Infrastructure ready, returns 0. Need to wire rule effects into flavor scoring. |
| Gap analysis | 🟡 Schema exists | GapReport + ExecutionPlan.gaps defined but not populated in plan phase. Need actual gap detection logic. |
| Rule suggestion generation | 🟡 Scaffolded | Reflect phase has structure, marked "no-op". Need to generate suggestions from decision outcomes. |
| Step resources in prompts | 🟡 Types defined | Not serialized into manifests by ManifestBuilder. Need to include in agent context. |
| Confidence-gate user interaction | 🟡 Threshold exists | OrchestratorConfig has confidenceThreshold. Not wired to pause execution or log for cooldown. |

### What Needs to Be Built

| Area | Priority | Effort | Description |
|------|----------|--------|-------------|
| **Run state files** | P0 | Medium | `.kata/runs/` directory structure with state.json at each level |
| **`kata cycle start`** | P0 | Medium | Validate bets, create runs, initialize state |
| **`kata cycle add-bet`** | P0 | Small | Add bet with kata assignment to cycle |
| **`kata artifact record`** | P0 | Small | CLI to record artifacts with provenance |
| **`kata decision record`** | P0 | Small | CLI to record decisions with stage/flavor/step metadata |
| **`kata approve`** | P0 | Small | Gate approval command with interactive selector |
| **`kata step next`** | P0 | Small | Query next step to work on + context |
| **Skill package** | P0 | Large | skill.md + reference docs + CLI reference (the primary agent interface) |
| **Execution monitor TUI** | P1 | Large | `kata watch` — global + detail views with gate approval |
| **Configuration TUI** | P1 | Large | `kata config` — interactive methodology editor |
| **Init repo scanning** | P1 | Medium | `kata init --scan` basic + full modes |
| **Wire gap analysis** | P1 | Medium | Populate GapReport during plan phase |
| **Wire rule adjustments** | P1 | Small | Apply rule effects to flavor scoring in match phase |
| **Wire rule suggestion generation** | P1 | Medium | Generate suggestions during reflect phase |
| **Wire confidence-gate interaction** | P1 | Medium | Pause on low confidence, log for cooldown, capture user input |
| **Bet-to-kata data model** | P1 | Small | Add `kata` field to Bet schema |
| **Batch config creation** | P2 | Small | `--json` input mode for step/flavor create (for init) |
| **Alias final pass** | P2 | Small | Validate all aliases against full command surface |
| **TUI aesthetics** | P2 | Medium | Nerd Font icons, bet avatars, stage-state poses, color palette |
| **Cooldown ↔ run data integration** | P2 | Medium | Read all run data, aggregate patterns, surface suggestions |
| **Vocabulary seeding from init** | P2 | Small | Add keywords based on repo scan findings |

---

## 10. Work Items (Implementation Order)

### Wave A: Foundation (Run State + Agent API)

Everything needed for a single `kata kiai` run to work end-to-end with an agent:

1. Run state file structure (`.kata/runs/` with state.json at each level)
2. `kata cycle add-bet` (assign kata to bet)
3. `kata cycle start` (validate, create runs, initialize state)
4. `kata artifact record` (record with provenance)
5. `kata decision record` (record with stage/flavor/step metadata)
6. `kata approve` (gate approval)
7. `kata step next` (query next step + context)
8. `kata run status` (single run detail)
9. Wire confidence-gate interaction (pause or log)
10. Bet schema update (add kata field)

### Wave B: Skill Package + Proof of Concept

The skill package and first end-to-end test with Claude Code:

1. Write skill.md (methodology overview, workflow guidelines)
2. Write cli-reference.md (all commands with examples)
3. Write file-structure.md (how to read .kata/ state)
4. Write orchestration.md (mapping to Claude Code teams/tasks)
5. Write context-flow.md (bet → stage → flavor → step context)
6. End-to-end proof of concept: load skill in Claude Code, run a single bet through full-feature kata
7. Iterate on skill package based on POC findings

### Wave C: Orchestration Wiring

Complete the stubbed orchestration features:

1. Wire rule adjustments into match phase scoring
2. Implement gap analysis in plan phase
3. Wire rule suggestion generation in reflect phase
4. Serialize step resources into agent context/prompts
5. Aggregate run data for cooldown integration

### Wave D: TUI + Init

The interactive surfaces:

1. Execution monitor TUI (`kata watch`) — global view
2. Execution monitor TUI — pipeline detail view
3. Execution monitor TUI — gate approval interactivity
4. Configuration TUI (`kata config`) — step/flavor editor
5. Init repo scanning — basic mode
6. Init repo scanning — full mode
7. TUI aesthetics (Nerd Fonts, avatars, color)

### Wave E: Polish + Aliases

1. Final alias validation against full command surface
2. Batch config creation for init
3. Vocabulary seeding from init scan
4. Documentation updates

---

## 11. Open Questions

### Deferred to Implementation

1. **TUI technology choice**: Ink (React for CLI), blessed, bubbletea (Go), or custom? Depends on ecosystem fit and contributor familiarity.

2. **Exact Nerd Font glyphs**: The specific icons for stages, states, and avatars. Refined during TUI build.

3. **Pipeline prep**: The original `kata pipeline prep` was for pre-execution context loading. With the bet prompt as persistent context, this may be unnecessary. Leave unresolved until kiai implementation surfaces a need.

4. **Agent skill packaging format**: `.claude/commands/` custom command? MCP server? Directory with multiple files? Depends on what Claude Code supports best for rich skill packages.

5. **Composio adapter**: Deferred to post-v1 fast-follow. v1 targets Claude Code only.

### Deferred to v2/v3

1. **Strict state machine enforcement**: Runtime validation that artifacts exist before gate passage, hard-blocking agents from skipping steps.

2. **MetaOrchestrator-driven kata selection**: LLM selecting which kata pattern fits a bet (currently user/agent picks manually).

3. **Pipeline DAG**: Non-linear stage flows (e.g., plan → research → plan → build). v1 is linear only.

4. **wrap-up stage**: A 5th stage after review. Currently 4 fixed categories; wrap-up was in the original design vision but not included in v1 command surface.

5. **Multi-user / team coordination**: v1 is single-developer. Team workflows with shared methodology and role-based gate approvals are future.

---

## 12. Alias Table

### Existing Aliases (from PR #90)

| Command | Alias | Chars | Notes |
|---------|-------|-------|-------|
| `kata init` | `rei` | 3 | Bow / greeting |
| `kata stage` | `gyo` | 3 | Practice / discipline |
| `kata step` | `waza` | 4 | Technique |
| `kata flavor` | `ryu` | 3 | Style / school |
| `kata cycle` | `keiko` | 5 | Training session |
| `kata cooldown` | `ma` | 2 | Interval / space |
| `kata knowledge` | `bunkai` | 6 | Analysis / breakdown |
| `kata execute` | `kiai` | 4 | Spirit shout / power |
| step/flavor delete | `wasure` | 6 | Forget |

### New Aliases Needed

| Command | Proposed Alias | Chars | Theme Reasoning |
|---------|---------------|-------|-----------------|
| `kata approve` | TBD | 2-4 | Granting passage |
| `kata watch` | TBD | 2-4 | Observation / awareness |
| `kata config` | TBD | 2-4 | Dojo setup / arrangement |
| `kata scan` | TBD | 2-4 | Perception / sensing |

**Final alias assignment deferred** until full command surface is locked in. Will be done as a dedicated pass to ensure thematic coherence and no conflicts.

---

## Appendix: Review Orchestration Heritage

The 6-phase stage orchestration loop was generalized from the review orchestration engine used in the parent project:

| Review Pipeline Stage | Generalized Phase | Mapping |
|----------------------|-------------------|---------|
| 1. NORMALIZE | 1. ANALYZE | Extract facts → Build capability profile |
| 2. CLASSIFY | 2. MATCH | Domain mapping → Vocabulary-driven scoring |
| 3. COMPOSE | 3. PLAN | Policy evaluation → Flavor selection + gap analysis |
| 4. GAP DETECT | 3. PLAN (gap sub-phase) | LLM coverage check → Gap report generation |
| 5. DISPATCH | 4. EXECUTE | Parallel agent dispatch → Parallel flavor execution |
| 6. AGGREGATE | 5. SYNTHESIZE + 6. REFLECT | Report + gate → Synthesis + reflection |

The review engine's **rule system** (`review-rules.json`) became the **Rule Registry**. Its **domain mappings** became **Vocabularies**. Its **gap log** became **GapReport**. The self-improvement loop (gap log → config improvement issues) became the cooldown-driven rule suggestion workflow.
