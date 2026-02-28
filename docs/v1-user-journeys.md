# Kata v1 User Journeys

> User Story Map — what users can accomplish with Kata, grouped by capability. This is a living document that grows as new features ship.
>
> **Companion documents**:
> - [Product Design](v1-product-design.md) — Problem, scope, and success criteria
> - [Interaction Design](v1-interaction-design.md) — How the user interacts with the system
> - [Kata System Guide](kata-system-guide.md) — How the system works today
> - [Implementation Roadmap](unified-roadmap.md) — What's left to build

---

## User Stories

### US-1: Project Setup and Methodology Configuration

> As a developer, I configure Kata for my project — defining which gyo (stages) I care about, what ryu (flavors) exist for each, and what waza (steps) each ryu contains, tailored to my tech stack and workflow preferences.

**Acceptance criteria:**
- `kata rei` (init) creates the `.kata/` directory with sensible defaults
- `kata rei --scan basic|full` scans the repo and proposes ryu based on existing tools and conventions
- `kata seido` (config) provides an interactive TUI for editing waza, ryu, and saved kata patterns
- Built-in waza and ryu cover common workflows out of the box (TDD, security audit, deploy, etc.)
- Project-type detection informs default recommendations (TypeScript, Rust, Go, etc.)

### US-2: Cycle Planning and Bet Setup

> As a developer, I plan time-boxed keiko (cycles) with specific bets — scoped units of work with budget allocations and expected outcomes — then kick off execution for all bets simultaneously.

**Acceptance criteria:**
- `kata keiko new` creates a keiko with a name, optional budget, and timeframe
- `kata keiko add-bet` adds bets with prompts, kata pattern assignments, and appetite
- `kata keiko start` validates all bets have assignments, creates run directories, begins execution
- Each bet runs through its assigned gyo sequence independently

### US-3: Execution Monitoring and Gate Interaction

> As a developer, I observe running bets through a real-time TUI, approve pending mon (gates) when the agent needs human input, and provide guidance on low-confidence kime (decisions).

**Acceptance criteria:**
- `kata kanshi` (watch) shows all running pipelines with gyo state, confidence, and pending mon
- Drill-down view shows per-ryu, per-waza progress with maki (artifacts) and kime
- Mon approval directly from TUI or via `kata hai` (approve)
- Conversational interface (Claude) can query the same state and take the same actions
- Each bet avatar in TUI has unique color + gyo-indicator state

### US-4: Autonomous Execution

> As a developer, I delegate execution entirely — the agent runs through all gyo autonomously, recording everything, and I review the output after completion.

**Acceptance criteria:**
- `--yolo` flag suppresses non-mandatory mon (kime still recorded with confidence)
- `--bridge-gaps` flag enables mid-run self-healing (create missing resources instead of deferring to ma)
- Complete run tree captures every kime, maki, and state transition for post-hoc review
- Low-confidence kime from `--yolo` runs are surfaced prominently in ma

### US-5: Ma (Cooldown), Review, and Self-Improvement

> As a developer, I work with my agent through ma — reflecting on what worked, reviewing kime and confidence levels, capturing bunkai, identifying methodology improvements, and feeding improvements into the next keiko's bets.

**Acceptance criteria:**
- Ma reads all run data: maki, kime, confidence levels, gaps
- Patterns surfaced: recurring low confidence, gap analysis findings, rule suggestions
- Interactive session for recording bunkai and bet outcomes
- Bunkai feeds back into vocabularies, rules, and orchestrator prompts
- Next-keiko bet proposals generated from reflection output
- Low-confidence kime from `--yolo` runs are surfaced for review

### US-6: Personal Training (Dojo)

> As a developer, I use the Dojo to reflect on my growth — reviewing narrative diary entries, exploring sessions that cover what happened (ushiro), my current state (uchi), industry practices (soto), and what's next (mae).

**Acceptance criteria:**
- Diary entries written automatically during ma
- Sessions generated from accumulated data across all four directions
- Self-contained HTML output with Japanese dojo theme
- CLI archive viewer for revisiting past sessions
- Curated source registry for outward-looking research

---

## Story Map by Capability

### Setup & Configuration

| Story | Commands | Notes |
|-------|----------|-------|
| US-1: Project setup | `kata rei`, `kata rei --scan`, `kata seido` | Built-in waza/ryu, project-type detection |

### Cycle Management

| Story | Commands | Notes |
|-------|----------|-------|
| US-2: Cycle planning | `kata keiko new`, `kata keiko add-bet`, `kata keiko start` | Bet-to-kata assignment validation |

### Execution

| Story | Commands | Notes |
|-------|----------|-------|
| US-3: Monitored execution | `kata kiai`, `kata kanshi`, `kata hai` | Gate interaction, confidence flags |
| US-4: Autonomous execution | `kata kiai --yolo --bridge-gaps` | Full delegation with post-hoc review |

### Reflection & Learning

| Story | Commands | Notes |
|-------|----------|-------|
| US-5: Ma + self-improvement | `kata ma`, `kata bunkai`, `kata rule` | Rule suggestions, proposals, bunkai capture |
| US-6: Dojo training | `kata dojo`, `/dojo` skill | Four directions, diary, sessions |

---

## Journey Flows

### Flow 1: First-Time Setup → First Keiko

```
kata rei --scan basic
  → Project detected, defaults proposed
kata seido
  → Review/customize ryu and waza interactively
kata keiko new "Sprint 1"
  → Create first keiko
kata keiko add-bet <id> "implement feature X" --kata full-feature
  → Add first bet
kata keiko start <id>
  → Execution begins
kata kanshi
  → Watch progress, approve mon as needed
kata ma
  → Reflect, capture bunkai, generate proposals
```

### Flow 2: Mature Project — Autonomous Keiko

```
kata keiko new "Sprint 8"
  → (system has 7 keiko of accumulated bunkai)
kata keiko add-bet <id> "..." --kata full-feature  (×3)
  → 3 bets, each with accumulated rule context
kata keiko start <id>
kata kiai research plan build review --yolo --bridge-gaps
  → Full autonomous execution
  → Gaps bridged mid-run, kime logged with confidence
kata ma
  → Review --yolo kime, accept/reject rule suggestions
  → Bunkai graph strengthened
  → Proposals generated for Sprint 9
kata dojo
  → Training session with rich ushiro + uchi data
```

### Flow 3: Ma → Next Keiko Bridge

```
kata ma
  → Bet outcomes recorded (complete/partial/abandoned)
  → Rule suggestions reviewed (accept/reject)
  → Bunkai captured into graph
  → Diary entry written
  → Proposals generated:
    - Unfinished work (high priority)
    - Dependency-based (medium)
    - Bunkai-driven (low)
kata keiko new "Sprint N+1"
  → Proposals inform bet selection
  → Accumulated bunkai improves ryu selection
  → Rules refine orchestration scoring
```

---

*This is a living document. New stories are added as capabilities ship. See [Implementation Roadmap](unified-roadmap.md) for what's next.*
