# Kata v1 Interaction Design

> Functional Spec — how the user interacts with Kata: orchestration flows, CLI patterns, state files, and skill package structure.
>
> **Companion documents**:
> - [Product Design](v1-product-design.md) — Problem, scope, and success criteria
> - [User Journeys](v1-user-journeys.md) — What users can accomplish
> - [Kata System Guide](kata-system-guide.md) — How the system works today (the canonical lexicon lives here)

---

## 1. Orchestration: The 6-Phase Loop

Each gyo (stage) runs a 6-phase orchestration loop:

```text
┌─────────────────────────────────────────────────┐
│ 1. ANALYZE                                       │
│    Build CapabilityProfile from:                 │
│    - Bet context (original prompt)               │
│    - Available maki (from prior gyo)             │
│    - Active rules                                │
│    - Bunkai from prior keiko                     │
│    → Kime: capability-analysis                   │
│                                                  │
│ 2. MATCH                                         │
│    Score candidate ryu against profile:           │
│    - Vocabulary keywords                         │
│    - Boost rules + bunkai boost                  │
│    - Rule adjustments                            │
│    → MatchReport[] with scores + reasoning       │
│                                                  │
│ 3. PLAN                                          │
│    Select ryu + execution mode:                   │
│    → Kime: ryu-selection                         │
│    → Kime: execution-mode (parallel/seq)         │
│    → Gap analysis: identify uncovered areas      │
│    → Kime: gap-assessment                        │
│                                                  │
│ 4. EXECUTE                                       │
│    Run selected ryu (parallel or sequential)      │
│    Each ryu = sub-agent with waza sequence        │
│    → FlavorExecutionResult[] collected           │
│                                                  │
│ 5. SYNTHESIZE                                    │
│    Merge per-ryu synthesis maki                   │
│    → Kime: synthesis-approach                    │
│    → Gyo-level synthesis maki                     │
│                                                  │
│ 6. REFLECT                                       │
│    Review kime outcomes:                          │
│    → Update outcome records                      │
│    → Generate rule suggestions                   │
│    → Capture bunkai                              │
└─────────────────────────────────────────────────┘
```

**Heritage**: Generalized from a review orchestration engine's 6-stage pipeline (Normalize → Classify → Compose → Gap Detect → Dispatch → Aggregate).

---

## 2. CLI Patterns

### Agent Interface: CLI + File Access + Skill Package

The agent interacts with Kata through three channels:

**1. CLI commands (structured operations):**
- `kata status --json` — query execution state
- `kata maki record` — record a maki (artifact) with provenance
- `kata kime record` — record a kime (decision) with metadata
- `kata hai` — approve a human mon (gate)
- `kata waza next` — query what to work on next
- `kata keiko start` — initialize runs for all bets

**2. Direct file access (read state, drill into details):**
- `.kata/runs/<run-id>/run.json` — overall run state
- `.kata/runs/<run-id>/stages/<gyo>/` — gyo-level state and maki
- `.kata/runs/<run-id>/decisions.jsonl` — kime log
- Agent reads these directly when it needs detail beyond what CLI provides

**3. Skill package (instructions + reference):**
- Teaches the agent how Kata works, when to use which commands, how to orchestrate
- Includes workflow guidelines, context flow patterns, CLI reference
- Distributed to all sub-agents spawned during execution

### Flag Conventions

| Flag | Alias | Scope | Purpose |
|------|-------|-------|---------|
| `--kata <name>` | — | kiai, keiko start | Use saved kata pattern |
| `--gyo <stages>` | — | kiai | Ad-hoc gyo sequence |
| `--yolo` | — | kiai, keiko start | Suppress non-mandatory mon |
| `--bridge-gaps` | — | kiai | Mid-run self-healing |
| `--json` | — | All query commands | Machine-readable output |
| `--plain` | — | All commands | English vocabulary mode |
| `--ryu` | — | waza commands | Filter by ryu |
| `--gyo` | — | ryu commands | Filter by gyo |
| `--scan basic\|full` | — | rei | Scan depth for initialization |

### Alias Design Rules

- Japanese karate-themed aliases for all CLI commands
- **2-4 characters** for frequent commands
- **5-6 characters** max for less common commands
- Thematically coherent with the karate/dojo metaphor
- `--plain` mode shows English equivalents

> For the complete command/alias table, see [System Guide — The Kata Lexicon](kata-system-guide.md#11-the-kata-lexicon).

---

## 3. Breadboards

### 3.1 Init / Onboarding

```text
BASIC SCAN (kata rei --scan basic)
──────────────────────────────────
User: "kata rei" or tells Claude "set up kata for this project"

Claude (with kata skill):
  → kata rei (creates .kata/ directory with defaults)
  → Scans repo:
    - .claude/ directory (skills, agents, MCP servers)
    - Project type (package.json, Cargo.toml, etc.)
    - Tool configs (eslint, vitest, biome, etc.)
    - Dependencies (testing frameworks, linters, etc.)
  → Classifies resources into gyo categories
  → Proposes ryu based on what exists
  → Interactive refinement with user
  → Creates waza, ryu, kata patterns via CLI

FULL SCAN (kata rei --scan full)
─────────────────────────────────
Everything in basic, plus:
  → Git history analysis (rework-heavy areas, common correction patterns)
  → Framework-aware recommendations
  → Gap identification against best practices
  → Deeper, more opinionated proposals
```

### 3.2 Keiko Setup (Betting Phase)

```text
User: "Let's set up our next keiko."

Claude (with kata skill):
  → kata keiko new "Q1 Sprint 3"

User: "Pull in the top 3 issues from Linear."

Claude:
  → (reads Linear via its own capabilities — kata doesn't own this)
  → "Found: AUTH-42, PERF-18, UI-99"
  → kata keiko add-bet <id> "implement user auth" --kata full-feature
  → kata keiko add-bet <id> "optimize query performance" --kata full-feature
  → kata keiko add-bet <id> "redesign dashboard" --kata quick-fix

User: "Looks good. Start it."

Claude:
  → kata keiko start <id>
  → Creates .kata/runs/<run-1>/ ... <run-3>/
  → Spawns 3 bet teammates (Claude Code teams)
  → "Keiko started. 3 pipelines running.
     Open kata kanshi in another pane to monitor."
```

### 3.3 Kiai (Execution)

**Agent hierarchy during execution:**

```text
Main Claude (user-facing orchestrator)
├── Bet-1 teammate (AUTH-42, full-feature)
│   ├── Gyo: RESEARCH
│   │   ├── 6-phase orchestration loop
│   │   ├── Ryu sub-agent: technical-research
│   │   └── Ryu sub-agent: codebase-analysis
│   ├── Gyo: PLAN
│   │   └── Ryu sub-agent: architecture
│   ├── Gyo: BUILD ...
│   └── Gyo: REVIEW ...
├── Bet-2 teammate (PERF-18, full-feature) ...
└── Bet-3 teammate (UI-99, quick-fix) ...
```

**Bet teammate is the gyo orchestrator.** It runs the 6-phase loop per gyo, spawns sub-agents for each selected ryu, collects results, writes synthesis, and advances to the next gyo.

### 3.4 Monitoring (TUI + Conversational)

Two complementary interfaces reading the same `.kata/` state:

**`kata kanshi` (watch) — Execution Monitor TUI:**

```text
┌──────────────────────────────────────────────────────────────┐
│ 󰓏  KATA WATCH    Keiko: Q1 Sprint 3     3 pipelines         │
├──────────────────────────────────────────────────────────────┤
│  🤺 BET-1  AUTH-42 user auth        ▓▓▓▓░░░░  PLAN         │
│     kata: full-feature               ⚠ mon pending           │
│  🧘 BET-2  PERF-18 query optim      ▓▓░░░░░░  RESEARCH     │
│     kata: full-feature               ● running               │
│  🧘 BET-3  UI-99 dashboard          ▓░░░░░░░  RESEARCH      │
│     kata: quick-fix                  ● running               │
├──────────────────────────────────────────────────────────────┤
│  [Enter] drill in   [a] approve mon   [q] quit              │
└──────────────────────────────────────────────────────────────┘
```

**Conversational interface (Claude):**
- Claude reads `kata status --json` and presents formatted summaries
- User approves mon: "Approve the plan for AUTH-42" → Claude runs `kata hai <gate-id>`
- User queries maki: "Show me the research synthesis" → Claude reads the file

### 3.5 Ma & Reflection

```text
(All bet pipelines complete)

Claude:
  → kata ma start <keiko-id>
  → Reads all run data: maki, kime, confidence, gaps

  → "Here's what I'm seeing across the keiko:

     AUTH-42: completed smoothly
       - Gap: no security research ryu (medium)
       - 2 kime below 0.7 confidence (logged via --yolo)

     Patterns across all bets:
       - codebase-analysis ryu selected in all 3 research gyo
       - 3 rule suggestions generated

     Would you like to review these suggestions?"

User: "Accept the boost rule. Create the security-research ryu."

Claude:
  → Accepts rule (kata rule accept <id>)
  → Creates security-research ryu interactively
  → Records bunkai
  → Generates proposals for next keiko
```

### 3.6 Self-Improvement Cycle

```text
                     ┌──────────────┐
                     │  KIAI        │
                     │  (execution) │
                     └──────┬───────┘
                            │
                    Kime, maki,
                    confidence, gaps
                            │
                     ┌──────▼───────┐
                     │   MA         │
                     │ (reflection) │
                     └──────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
        Rule suggestions  Bunkai    Vocabulary
        (auto-generated)  (captured)  additions
              │             │             │
              ▼             ▼             ▼
        ┌───────────────────────────────────┐
        │     METHODOLOGY CONFIGURATION     │
        │  Rules, vocabularies, ryu,        │
        │  waza resources, kata patterns    │
        └───────────────┬───────────────────┘
                        │
                 ┌──────▼──────┐
                 │ NEXT KEIKO  │
                 │ (better)    │
                 └─────────────┘
```

---

## 4. Data Model

### 4.1 Directory Structure

```text
.kata/
  config.json                     # Project config, saved kata patterns
  KATA.md                         # Project context for all agents (Wave F)
  rules/
    research/*.json               # Active rules per gyo category
    plan/*.json
    build/*.json
    review/*.json
    suggestions/*.json            # Pending rule suggestions
  runs/
    <run-id>/
      run.json                    # Run metadata: bet, kata pattern, timestamps
      decisions.jsonl             # Append-only kime log (all gyo)
      artifact-index.jsonl        # Run-level maki index
      stages/
        research/
          state.json              # Gyo state: selected ryu, status
          synthesis.md            # Cross-ryu synthesis maki
          flavors/
            technical-research/
              state.json          # Ryu state: waza, current position
              artifact-index.jsonl
              artifacts/          # Waza-produced maki
              synthesis.md        # Ryu synthesis
  cycles/
    <keiko-id>/cycle.json         # Keiko metadata, bets with kata assignments
  stages/                         # Waza definitions, ryu compositions, gyo vocabularies
  knowledge/                      # Bunkai from prior keiko
  dojo/                           # Diary entries, sessions, sources
  tracking/                       # Token usage per run
  skill/                          # Skill package for agent consumers
```

### 4.2 State Files

**run.json** — Top-level run state:
```json
{
  "id": "<run-id>",
  "cycleId": "<keiko-id>",
  "betId": "<bet-id>",
  "betPrompt": "implement user auth (AUTH-42)",
  "kataPattern": "full-feature",
  "stageSequence": ["research", "plan", "build", "review"],
  "currentStage": "plan",
  "status": "running"
}
```

**stages/\<gyo\>/state.json** — Gyo state:
```json
{
  "category": "research",
  "status": "completed",
  "selectedFlavors": ["technical-research", "codebase-analysis"],
  "executionMode": "parallel",
  "gaps": [{ "description": "No security-research ryu", "severity": "medium" }],
  "synthesisArtifact": "synthesis.md"
}
```

**flavors/\<ryu\>/state.json** — Ryu state:
```json
{
  "name": "technical-research",
  "status": "completed",
  "steps": [
    { "name": "discovery", "status": "completed", "artifacts": ["auth-patterns.md"] },
    { "name": "analysis", "status": "completed", "artifacts": ["auth-recommendation.md"] }
  ]
}
```

### 4.3 Maki Tree (Progressive Summarization)

```text
Context available to any waza:

1. BET PROMPT (always, top-level)
2. ALL PRIOR GYO SYNTHESES
   └── research/synthesis.md → plan/synthesis.md → ...
3. WAZA PROMPT (the specific directive for this waza)
4. WITHIN-RYU: all prior waza maki
5. MAKI INDEX (traversable on demand)
```

Contention-free by design: ryu maki indexes have one writer (sequential waza), gyo synthesis is produced after all ryu complete, kime log is append-only JSONL.

### 4.4 Kime Log

Append-only JSONL at run level (`.kata/runs/<run-id>/decisions.jsonl`):

```jsonl
{"id":"<uuid>","stageCategory":"research","decisionType":"capability-analysis","context":{...},"options":[...],"selection":"...","reasoning":"...","confidence":0.87}
{"id":"<uuid>","stageCategory":"research","decisionType":"ryu-selection","options":["technical-research","codebase-analysis","market-research"],"selection":"technical-research,codebase-analysis","confidence":0.9}
```

Each kime includes full provenance: gyo, ryu (if applicable), waza (if applicable). Outcomes updated post-facto via `kata kime update`.

### 4.5 Rule Registry

Rules accumulate over time per gyo category:

```json
{
  "id": "<uuid>",
  "category": "research",
  "name": "boost-codebase-analysis-for-auth",
  "condition": "bet context contains 'auth' or 'authentication'",
  "effect": "boost",
  "magnitude": 0.15,
  "confidence": 0.8,
  "source": "auto-detected"
}
```

Effects: `boost` | `penalize` | `require` | `exclude`

---

## 5. Skill Package Design

```text
.kata/skill/
  skill.md                # Main instructions: methodology overview, workflow guidelines
  cli-reference.md        # Every kata CLI command the agent should use
  file-structure.md       # How to read .kata/ directory and state files
  orchestration.md        # How to map kata methodology to agent's native team/task model
  context-flow.md         # How bet prompt + maki + prompts flow through waza
  classification.md       # Heuristics for resource classification (rei scanning)
```

**skill.md** teaches the agent: what Kata is, the three-tier hierarchy, how to start a keiko, execute a kata, record maki, check mon, spawn sub-agents for parallel ryu execution, and what context each sub-agent should receive.

---

## 6. TUI Design

### Execution Monitor (`kata kanshi`)

- **Global view**: All running pipelines with summary state
- **Pipeline detail**: Drill into one pipeline for gyo/ryu/waza breakdown
- **Interactive**: Mon approval directly from TUI
- **Live-updating**: Watches `.kata/runs/` state files for changes

### Configuration TUI (`kata seido`)

- **Full interactive editor** for methodology authoring
- Create/edit waza, ryu, kata patterns
- Assign resources (tools, agents, skills) to waza
- Configure mon conditions
- Validate ryu DAGs

### Aesthetics

- **Nerd Font icons** for gyo (opt-in via `KATA_NERD_FONTS=1`, emoji defaults)
- **Bet avatars**: unique color per bet, avatar pose changes per gyo
- **Design goal**: The TUI should feel intentional and alive — the karate theme comes through visually, not just in naming

---

## Appendix: Orchestration Heritage

The 6-phase gyo loop was generalized from a review orchestration engine:

| Review Pipeline Stage | Generalized Phase |
|----------------------|-------------------|
| 1. NORMALIZE | 1. ANALYZE |
| 2. CLASSIFY | 2. MATCH |
| 3. COMPOSE | 3. PLAN |
| 4. GAP DETECT | 3. PLAN (gap sub-phase) |
| 5. DISPATCH | 4. EXECUTE |
| 6. AGGREGATE | 5. SYNTHESIZE + 6. REFLECT |

---

*This is a living document and evolves as the product surface changes.*
