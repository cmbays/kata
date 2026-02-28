# Kataka Architecture — Agents, Skills, and Methodology-Aware AI

> A living architectural document for how Kata integrates with AI coding agents.
> This document defines the kataka system, naming conventions, composability model,
> and the philosophy of meeting projects where they are.
>
> **Implementation status**: The kataka system is fully designed but not yet built. Implementation begins in Wave G. See [Implementation Roadmap](unified-roadmap.md) for sequencing.
> For how Kata's current system works, see [Kata System Guide](kata-system-guide.md).

---

## 1. Vision

Kata is a methodology engine. It encodes how work should flow — stages, flavors, steps, gates, artifacts, decisions, observations, and learnings. But methodology without execution is theory.

**Kataka** (型家) are Kata-native AI agents — practitioners of the methodology. They are the bridge between Kata's structured pipeline and the AI agents that do the actual work. A kataka knows:

- Where it is in the pipeline (which stage, which flavor, which step)
- What artifacts it should produce (exit gates)
- What artifacts it can consume (entry gates, predecessor outputs)
- How to record its work (artifacts, decisions, observations)
- How to participate in the learning cycle (cooldown, reflection, self-improvement)

---

## 2. The Kata Lexicon

The complete vocabulary, extended with kataka-related terms.

### Core Lexicon (Existing)

| English   | Japanese      | CLI command      | CLI alias      | Description                                       |
|-----------|---------------|------------------|----------------|---------------------------------------------------|
| Stage     | Gyo (行)      | `kata stage`     | `kata gyo`     | Fixed categories: research, plan, build, review    |
| Step      | Waza (技)     | `kata step`      | `kata waza`    | Atomic methodology unit with gates and artifacts   |
| Flavor    | Ryu (流)      | `kata flavor`    | `kata ryu`     | Named composition of steps within a stage          |
| Cycle     | Keiko (稽古)  | `kata cycle`     | `kata keiko`   | Time-boxed work period with budgets                |
| Gate      | Mon (門)      | —                | —              | Threshold/condition (entry: iri-mon, exit: de-mon) |
| Decision  | Kime (決め)   | `kata decision`  | `kata kime`    | Orchestration judgment with confidence score       |
| Knowledge | Bunkai (分解) | `kata knowledge` | `kata bunkai`  | Extracted patterns from practice                   |
| Cooldown  | Ma (間)       | `kata cooldown`  | `kata ma`      | Reflection period after a cycle                    |
| Execute   | Kiai (気合)   | `kata execute`   | `kata kiai`    | Run stage orchestration                            |

> **Note:** The `kata kime` alias is implemented (shipped in Wave A, [#153](https://github.com/cmbays/kata/issues/153) closed).

### New Lexicon (Kataka System)

| English             | Japanese        | CLI command      | CLI alias        | Description                                            |
|---------------------|-----------------|------------------|------------------|--------------------------------------------------------|
| Agent (Kata-native) | Kataka (型家)   | `kata agent`     | `kata kataka`    | Kata-aware AI agent — a methodology practitioner       |
| Artifact            | Maki (巻)      | `kata artifact`  | `kata maki`      | Named output produced by a step (scroll)               |
| Orchestrator        | Sensei (先生)   | —                | —                | The orchestration skill that guides pipeline execution |
| Observation         | Kansatsu (観察) | `kata observe`   | `kata kansatsu`  | Runtime signal captured for learning (future)          |

### The `-ka` Suffix Convention

The `-ka` suffix (家, "practitioner") on an agent name signals it is a **Kata-native wrapper agent**. The convention comes from Japanese martial arts — judoka (柔道家), karateka (空手家), kendoka (剣道家). A kataka (型家) is a practitioner of kata (型, form).

A kataka is methodology-aware, participates in the observation/learning cycle, and knows how to use Kata's CLI.

```
.claude/agents/
  scout-ka.md              # Kataka: research practitioner
  architect-ka.md          # Kataka: planning practitioner
  implementer-ka.md        # Kataka: build practitioner
  auditor-ka.md            # Kataka: review practitioner
  frontend-builder.md      # Regular agent (not Kata-aware)
  security-reviewer.md     # Regular agent (not Kata-aware)
```

Scanning a directory, the convention is immediately clear: `-ka` = Kata-native, no suffix = regular agent.

### Help & Lexicon Display

Commander.js provides `kata --help` and `kata help` automatically. The lexicon should be appended to the standard help output via `addHelpText('after', ...)` so users see the themed vocabulary naturally when asking for help — no special subcommand needed.

For a deeper interactive experience, a dedicated `kata lexicon` command (alias: `kata kotoba`) can provide a full TUI table with English terms, Japanese aliases, kanji, romaji, and descriptions. This makes the themed vocabulary accessible and educational without requiring prior Japanese knowledge.

---

## 3. The Three-Layer Model *(Wave G)*

> This three-layer model is the target architecture for Wave G. Today's skill package (shipped in Wave B) provides the foundation; the kataka identity system, KATA.md context file, and init scanning add the remaining layers.

Every AI coding project has three layers of customization. Kata should understand and work within all three.

### Layer 1: Context — "What the project is"

Always-loaded ambient knowledge about the project.

| Format              | Purpose                              | Example                                                   |
|---------------------|--------------------------------------|-----------------------------------------------------------|
| `CLAUDE.md`         | Project instructions for Claude Code | Architecture, commands, conventions                       |
| `.kata/KATA.md`     | Kata-specific project context        | Methodology preferences, active cycle, integration points |
| `AGENTS.md`         | Cross-tool project context           | Build commands, test instructions, code style             |
| `.kata/config.json` | Kata configuration                   | Stages, flavors, adapter, thresholds                      |

**`.kata/KATA.md`** is a new concept — a Kata-specific context file that every kataka and sensei session is preloaded with. It contains:

- Project methodology preferences and overrides
- Active cycle and bet context summary
- Integration points (which kataka exist, what they do)
- Project-wide learnings that should inform all work
- Naming conventions and quality expectations

This file is generated/updated by `kata init` and can be manually edited. It serves as the DRY source of Kata-specific context that would otherwise need to be duplicated across every kataka definition.

### Layer 2: Skills — "How to do things"

Activatable knowledge and workflows. Stateless, portable, reusable.

| Naming      | Format                                                   | Purpose             |
|-------------|----------------------------------------------------------|---------------------|
| Verb-object | `.claude/skills/<name>/SKILL.md`                         | Reusable capability |
| Examples    | `scan-codebase`, `design-architecture`, `audit-security` | What gets done      |

Skills follow the [Agent Skills open standard](https://agentskills.io/specification). They are consumed by any agent — kataka or not.

#### Built-in Kata Skills

Kata ships a set of skills that are copied to `.claude/skills/` during `kata init`. These use the `kata-` prefix to distinguish them from user-created or community skills:

| Skill                  | Purpose                                                                 |
|------------------------|-------------------------------------------------------------------------|
| `kata-orchestration`   | Shared kataka protocol — step lifecycle, quality protocol, context loading |
| `kata-sensei`          | Orchestration playbook for the main session / team lead                 |
| `kata-create-agent`    | Knowledge + templates for creating new kataka                           |
| `kata-create-skill`    | Knowledge + templates for creating new skills (Agent Skills spec)       |
| `kata-bridge-gap`      | Full gap analysis → creation → integration pipeline                    |
| `kata-scan-project`    | Project scanning, agent/skill classification, wrapper generation        |

The `kata-` prefix convention is simple, conventional (similar to npm org scopes), and immediately signals "this ships with Kata." User-created skills use the standard verb-object naming without the prefix.

### Layer 3: Agents — "Who does the work"

Execution identities with their own context window, tools, and persona.

| Naming  | Format                        | Purpose                        |
|---------|-------------------------------|--------------------------------|
| Noun-ka | `.claude/agents/<name>-ka.md` | Kata-native agent (kataka)     |
| Noun    | `.claude/agents/<name>.md`    | Regular agent (not Kata-aware) |

Agents have: system prompt, tool restrictions, model selection, permission mode, preloaded skills, hooks, and memory.

### How They Compose

```
Context (KATA.md, CLAUDE.md)
  ↓ loaded into
Skills (kata-sensei, kata-create-agent, tdd-workflow)
  ↓ preloaded by
Agents (scout-ka, implementer-ka, auditor-ka)
  ↓ spawned by
Main session acting as Sensei (orchestrator)
```

- **Kataka preload skills** via the `skills:` frontmatter field
- **Skills reference KATA.md** for project-specific knowledge
- **The main session loads the kata-sensei skill** to act as orchestrator
- **Kataka cannot spawn other kataka** (Claude Code constraint) — only the main session (sensei) spawns agents

---

## 4. Kataka Anatomy *(Wave G)*

### Definition Format

A kataka is a standard Claude Code agent definition (`.claude/agents/<name>-ka.md`) with Kata-specific frontmatter metadata. The orchestration protocol is NOT repeated in every kataka — it lives in the `kata-orchestration` skill, which every kataka preloads.

```yaml
---
name: implementer-ka
description: >
  Kata build practitioner. Use for build-stage flavor execution.
  Writes code following TDD methodology, records all artifacts and decisions.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
skills:
  - kata-orchestration
  - tdd-workflow
  - api-conventions

# Kata-specific frontmatter
metadata:
  kata:
    stage: build
    wraps: frontend-builder
    created-by: kata-init-scan
    last-synced: "2026-02-27"
---

## Wrapped Capability: Frontend Builder

[The original frontend-builder.md system prompt, absorbed during kata init]

You build frontend screens and components following project standards...
```

### Frontmatter Fields

| Field               | Required | Description                                                              |
|---------------------|----------|--------------------------------------------------------------------------|
| `name`              | Yes      | Agent name with `-ka` suffix                                             |
| `description`       | Yes      | Includes "when to use" guidance for the spawning session                 |
| `tools`             | Yes      | Merged: original agent tools + any Kata-required tools                   |
| `model`             | No       | `inherit` uses the parent session's model (recommended default)          |
| `skills`            | Yes      | Must include `kata-orchestration`; add domain skills as needed           |
| `metadata.kata.stage` | Yes    | One of: `research`, `plan`, `build`, `review`                            |
| `metadata.kata.wraps` | No     | Name of the original agent this kataka absorbs (omitted if built fresh)  |
| `metadata.kata.created-by` | No | How this kataka was created: `kata-init-scan`, `kata-bridge-gap`, `manual` |
| `metadata.kata.last-synced` | No | ISO timestamp of last sync with wrapped agent source                    |

When `metadata.kata.wraps` is omitted, it means the kataka was created fresh (not wrapping an existing agent). The `last-synced` field is also irrelevant in that case — there is no source agent to sync with.

### How the Orchestration Layer Stays DRY

The `kata-orchestration` skill (shipped with Kata, copied during `kata init`) contains all the shared protocol:

- **Step lifecycle**: receive context → execute work → record artifacts → record decisions → note observations → complete step
- **Quality protocol**: honest confidence scores, flag uncertainty, capture friction, satisfy exit gates
- **Context loading**: read `.kata/KATA.md` at startup, load step prompt, access prior artifacts

Every kataka gets this by listing `kata-orchestration` in its `skills:` field. The kataka body itself only contains the **wrapped capability** — the original agent's system prompt and any domain-specific instructions. This avoids repeating ~30 lines of orchestration instructions in every kataka definition.

### Stage Assignment

Every kataka belongs to exactly one stage. This is declared in the `metadata.kata.stage` field:

| Stage    | Example Kataka                 | Typical Tools                         |
|----------|--------------------------------|---------------------------------------|
| Research | `scout-ka`, `analyst-ka`       | Read, Grep, Glob, WebSearch, WebFetch |
| Plan     | `architect-ka`, `estimator-ka` | Read, Grep, Glob, Write               |
| Build    | `implementer-ka`, `tester-ka`  | Read, Write, Edit, Bash, Grep, Glob   |
| Review   | `auditor-ka`, `verifier-ka`    | Read, Grep, Glob                      |

### Wrapping Mechanics

When `kata init --scan` creates a kataka from an existing agent:

1. **Read** the original agent's frontmatter (tools, skills, model, description)
2. **Absorb** the original agent's system prompt into the kataka's body
3. **Merge** tool lists (original tools + any Kata-required tools)
4. **Preload** the `kata-orchestration` skill alongside original skills
5. **Record** the wrapping relationship in `metadata.kata.wraps`
6. **Record** sync timestamp in `metadata.kata.last-synced`

The original agent file is **never modified**. It continues to work independently for non-Kata usage.

Re-syncing: `kata init --scan resync` detects when the original agent has changed (by comparing `last-synced` to the file's modification time) and offers to update the kataka wrapper.

---

## 5. The Sensei Skill

The sensei (先生) is an orchestration skill — not an agent. It provides the methodology playbook that the main session uses to drive a Kata pipeline.

### Why a Skill, Not an Agent

Claude Code subagents cannot spawn other subagents. The orchestrator MUST be the main session (or a team lead). Making sensei a skill means:

- The main session loads kata-sensei and gains orchestration knowledge
- The main session can spawn kataka as subagents or teammates
- No nesting limitation — the main session has full tool access
- The orchestration knowledge is reusable and portable

### What Sensei Provides

```
.claude/skills/kata-sensei/SKILL.md
```

The sensei skill instructs the session to:

1. Call `kata step next --json` to get the current stage and step
2. Determine which flavors the stage requires
3. Look up the kataka assigned to each selected flavor
4. Spawn kataka as team agents (parallel execution within a stage)
5. Wait for all flavor executions to complete
6. Handle gates (approve, escalate to human, or use `--yolo`)
7. Write stage synthesis when all flavors in a stage complete
8. Transition to the next stage
9. Handle gap detection and optionally bridge gaps mid-run

### Parallel Execution via Teams

Within a stage, the sensei selects which flavors (ryu) to apply. Each selected flavor has an assigned kataka. The sensei spawns all required kataka as **Claude Code team agents** running in parallel — this is fundamental to how Kata executes stages.

```
Stage: build
  ↓ sensei selects 3 flavors
  ├─ ryu: build.tdd-typescript  → spawns implementer-ka (teammate)
  ├─ ryu: build.api-integration → spawns implementer-ka (teammate)
  └─ ryu: build.frontend        → spawns frontend-ka   (teammate)
      ↓ all 3 run in parallel as team agents
  ← sensei collects results, writes stage synthesis
```

The team infrastructure (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) enables this:

- **Sensei is the team lead** — the main session loads `kata-sensei` and creates the team
- **Kataka are teammates** — spawned via the Task tool with `team_name` and assigned tasks
- **Shared task list** — kataka check `TaskList` for their assignments, mark tasks complete when done
- **Parallel, not sequential** — multiple flavors execute simultaneously, each in its own kataka context
- **Stage gate** — the sensei waits for all flavor tasks to complete before writing the stage synthesis and transitioning

When the same kataka is assigned to multiple flavors (e.g., `implementer-ka` running both `build.tdd-typescript` and `build.api-integration`), the sensei spawns separate instances. Each instance operates independently with its own task, context, and observation trail.

Sequential execution is also possible (and may be preferred when flavors have dependencies). The sensei determines the execution strategy based on flavor dependency analysis — independent flavors run in parallel, dependent flavors run in sequence.

### The `--bridge-gaps` Flag

Two modes for gap handling during runs:

| Mode    | Flag              | Behavior                                                                               |
|---------|--------------------|----------------------------------------------------------------------------------------|
| Default | (none)             | Gaps are noted as observations, surfaced in cooldown, become bets for next cycle       |
| Bridge  | `--bridge-gaps`    | Gaps trigger the `kata-bridge-gap` skill mid-run: create resources, re-attempt the step |

The default mode prevents scope creep by deferring gap resolution to the cooldown reflection. The bridge mode enables fully autonomous self-healing runs for rapid iteration.

Boolean flags follow the `--flag` / `--no-flag` convention: `--bridge-gaps` enables mid-run gap closing, `--no-bridge-gaps` (the default) defers to cooldown.

### Autonomous Pipeline Example

For a fully autonomous, self-healing pipeline run:

```bash
kata execute research plan build review --yolo --bridge-gaps
```

This combination is the "strong default" for autonomous runs:
- `--yolo` skips human-approval gates (decisions still recorded with confidence)
- `--bridge-gaps` creates missing skills/agents/flavors mid-run instead of waiting for cooldown

For interactive runs, omit both flags — the sensei will pause at gates and note gaps for cooldown.

---

## 6. Kataka-to-Ryu Binding

Each flavor (ryu) has an assigned kataka. This is a design-time decision, not a runtime guess.

### The Binding

```json
{
  "name": "build.tdd-typescript",
  "kataka": "implementer-ka",
  "steps": [
    { "stepType": "write-tests", "order": 1 },
    { "stepType": "implement", "order": 2 },
    { "stepType": "refactor", "order": 3 }
  ]
}
```

### What This Simplifies

- **Orchestrator's job**: Pick flavors for the stage → kataka assignment is already decided
- **Agent configuration**: Each kataka is pre-configured for the kind of work that flavor requires
- **Observability**: Track kataka performance per flavor across runs
- **Onboarding**: Looking at a flavor tells you exactly who will execute it

### One Kataka, Many Flavors

A single kataka can be assigned to multiple flavors within the same stage. When the sensei selects multiple flavors for a stage, the same kataka may be spawned multiple times — once per flavor execution:

```
build stage:
  ryu: build.tdd-typescript     → implementer-ka
  ryu: build.api-integration    → implementer-ka   (same kataka, different flavor)
  ryu: build.frontend           → frontend-ka      (different kataka)
```

The kataka's observations and decisions are attributed per-flavor per-run, so even when the same kataka executes multiple flavors, the data stays distinct and traceable.

### Multiple Kataka Per Stage

Conversely, a stage can have multiple flavors each with different kataka:

```
research stage:
  ryu: research.web-analysis    → scout-ka
  ryu: research.codebase-scan   → analyst-ka
```

The sensei orchestrator selects which flavors to run. Each flavor brings its own kataka.

### V1 Constraint: One Kataka Per Flavor

For v1, each flavor has exactly one assigned kataka. If we later find cases where different steps within a flavor need radically different capabilities, we can extend to per-step assignment. But starting simple.

---

## 7. KATA.md — Project Context File *(Wave F)*

A new file at `.kata/KATA.md` that functions as CLAUDE.md for Kata specifically. Every kataka and sensei session is preloaded with this context.

### What It Contains

```markdown
# KATA.md — Kata Project Context

## Project
- Name: print4ink
- Stack: TypeScript, Next.js, Prisma, Tailwind
- Architecture: Clean architecture (domain → infra → features → CLI)

## Active Cycle
- Cycle: wave-ml-session-1
- Focus: Meta-learning observation data model
- Bets: core-observation-schema, learning-graph-index

## Kataka Registry
| Kataka           | Stage    | Wraps             | Skills                        |
|------------------|----------|--------------------|-------------------------------|
| scout-ka         | research | —                  | scan-codebase                 |
| architect-ka     | plan     | —                  | design-architecture           |
| implementer-ka   | build    | frontend-builder   | tdd-workflow, api-conventions |
| auditor-ka       | review   | security-reviewer  | audit-security                |

## Project-Wide Learnings
- Always use Zod v4 (`zod/v4` import path)
- ESM-only: all imports use `.js` extensions
- Path aliases: @domain/*, @infra/*, @features/*, @shared/*, @cli/*
- Tests colocated with source (*.test.ts)
- Coverage thresholds: 80% statements/functions/lines, 75% branches

## Methodology Preferences
- Confidence threshold: 0.7
- Approval mode: gate-based (not --yolo by default)
- Gap handling: note for cooldown (default), --bridge-gaps available
```

### How It's Generated

- `kata init --scan` generates the initial `KATA.md` from project analysis
- `kata cooldown` can append project-wide learnings discovered during reflection
- Manual edits are preserved on re-scan (sections marked `<!-- user -->` are protected)

### How It's Used

Every kataka definition includes `kata-orchestration` in its `skills:` field. The `kata-orchestration` skill instructs the kataka to read `.kata/KATA.md` at startup. This is the DRY source of project context — no need to duplicate it across every kataka definition.

---

## 8. Init Scanning Flow *(Wave G)*

> Basic init scanning (`kata init --scan basic|full`) shipped in Wave D. The kataka-aware scanning described here — wrapping, classification, and orphan detection — ships in Wave G.

`kata init --scan` does more than create kataka. It performs a full project capability assessment: detecting existing agents, skills, project type, framework conventions, and methodology fit. The kataka creation is one output of that broader scan.

### The Full Flow

```
$ kata init --scan full

  Scanning project capabilities...

  Project type: TypeScript / Node.js (detected from package.json)
  Framework: Express + Vitest (detected from dependencies)

  Found 2 agents:
    frontend-builder  → classified as: build stage
    security-reviewer → classified as: review stage

  Found 2 skills:
    tdd-workflow      → classified as: build stage
    api-conventions   → classified as: build stage

  Creating kataka:
    scout-ka          → research (default — no existing match)
    architect-ka      → plan (default — no existing match)
    implementer-ka    → build (wraps: frontend-builder, skills: tdd-workflow + api-conventions)
    auditor-ka        → review (wraps: security-reviewer)

  Generated: .kata/KATA.md
  Copied: 6 built-in skills to .claude/skills/kata-*/
  Ready for first kata run.
```

### Scan Modes

| Mode    | Flag             | Behavior                                                    |
|---------|------------------|-------------------------------------------------------------|
| Basic   | `--scan basic`   | Create default kataka for each stage, no wrapping           |
| Full    | `--scan full`    | Scan existing agents/skills, create wrappers, classify      |
| Re-scan | `--scan resync`  | Update existing kataka from changed source agents           |

### Update Options

| Option                    | Behavior                                                                       |
|---------------------------|--------------------------------------------------------------------------------|
| `--scan full` (first run) | Creates new kataka, does not touch existing                                    |
| `--scan full --overwrite` | Overwrites all kataka with fresh wrappers                                      |
| `--scan resync`           | Only updates kataka whose source agents have changed                           |
| `--scan full --additive`  | Creates new kataka for newly discovered agents, keeps existing kataka unchanged |

### Orphan Detection

During `--scan resync` and `--scan full`, the scanner checks for **orphaned kataka** — wrapper agents whose source has been removed:

```
  Orphaned kataka detected:
    frontend-ka       → wraps: frontend-builder (agent file deleted)
    api-ka            → wraps: api-designer (agent file deleted)

  Options:
    [a] Archive — keep kataka but mark as unwrapped (preserve observation history)
    [d] Delete — remove kataka definition
    [s] Skip — leave unchanged for now
```

This ensures the kataka registry stays clean without silently losing observation history from retired agents.

### Classification

The LLM classifies existing agents and skills by analyzing:
- Agent name and description
- Tool restrictions (read-only → research/review, full write → build)
- Preloaded skills and their content
- System prompt keywords and intent

Classification is recorded as a decision with confidence. Low-confidence classifications are flagged for human review.

---

## 9. Gap Bridging

### The Capability Pipeline

When Kata identifies a gap (missing skill, missing agent, unfamiliar technology), the `kata-bridge-gap` skill handles the full end-to-end resolution:

```
Gap detected (GapReport from orchestration engine)
  ↓
kata-bridge-gap skill activated
  ↓
Analyze: What combination of resources is needed?
  ↓
Research: Search ecosystem for existing solutions
  ↓
Create: Generate the required resources (see below)
  ↓
Validate: Run quality gates (spec validation, security scan)
  ↓
Integrate: Register in KATA.md, link to appropriate flavors/stages
```

### What Bridge-Gap Can Create

The skill doesn't just create one thing — it evaluates the gap and determines the full set of resources needed:

| Gap Severity | Resources Created                                                          | Example                                                       |
|--------------|----------------------------------------------------------------------------|---------------------------------------------------------------|
| Minor        | A single skill                                                             | Missing Rust conventions → create `rust-conventions` skill    |
| Moderate     | A skill + new waza (step)                                                  | Missing linting step → create skill + register step type      |
| Major        | A kataka + skills + new waza                                               | No security review agent → create auditor-ka + audit skills   |
| Structural   | A full flavor (ryu) + kataka + skills + waza                               | No API testing flow → create flavor with steps, agent, skills |

The skill is smart enough to ask: "Do I need one resource or several? Does an existing kataka cover this, or do I need a new one? Can I compose existing waza into a new ryu, or do I need new waza too?"

### Interactive vs. Autonomous Mode

| Mode        | Trigger                          | Behavior                                                    |
|-------------|----------------------------------|-------------------------------------------------------------|
| Interactive | Gap during normal run (no flags) | Observed and logged; surfaced in cooldown for user review    |
| Interactive | Gap during `--bridge-gaps` run   | Skill pauses, discusses options with user, creates resources |
| Autonomous  | Gap during `--yolo --bridge-gaps` | Skill creates resources automatically, re-attempts step     |

In interactive `--bridge-gaps` mode (without `--yolo`), the skill presents its analysis and proposed resources to the user before creating anything. This allows the user to refine the approach, adjust naming, or redirect the solution.

### The Creation Skills

**`kata-create-agent`** — Knowledge of:
- Claude Code agent definition format (all frontmatter fields)
- Kataka conventions (the -ka suffix, stage assignment, wrapping protocol)
- Quality criteria (single responsibility, appropriate tool restrictions, clear description)
- Naming guide (the Kata lexicon patterns)
- Security considerations (never expose secrets, validate inputs)

**`kata-create-skill`** — Knowledge of:
- Agent Skills open standard (agentskills.io spec)
- Progressive disclosure model (metadata → instructions → resources)
- Naming conventions (verb-object, gerund form)
- Quality gates (spec validation, security scan, staleness check)
- Evaluation generation (3-5 eval queries per skill)

**`kata-bridge-gap`** — The wrapper that:
1. Takes a `GapReport` as input (severity, description, context)
2. Analyzes: what combination of resources is needed? (skill only? agent + skills? full flavor?)
3. Researches the ecosystem (search for existing skills/agents that fit)
4. Invokes `kata-create-agent` and/or `kata-create-skill` to generate artifacts
5. Creates new waza (step types) if needed and assembles them into a ryu (flavor)
6. Assigns the flavor to an existing or newly created kataka
7. Validates all outputs against quality gates
8. Integrates: updates `KATA.md`, links to appropriate flavors/stages
9. Optionally proposes a bet for the next cycle if the gap is too large to bridge immediately

### Mid-Run vs. Cooldown

| Timing                    | Trigger                                          | Scope                                               |
|---------------------------|--------------------------------------------------|-----------------------------------------------------|
| Mid-run (`--bridge-gaps`) | Gap detected during step execution               | All gap severities — creates resources as needed     |
| Cooldown (default)        | Gaps collected during run, surfaced in reflection | All gaps — become bets/proposals for next cycle      |

---

## 10. Observability and Attribution *(Wave I)*

> Agent attribution becomes functional in Wave I after the observation system (Wave F) and kataka registry (Wave G) are in place.

### Kataka as Trackable Entities

One of the key unlocks of the kataka system: **agent attribution**. Every observation, decision, artifact, and outcome can be attributed to the specific kataka that produced it.

### What Gets Tracked Per Kataka

| Metric                  | Source                             | Purpose              |
|-------------------------|------------------------------------|----------------------|
| Runs participated       | Run state files                    | Activity tracking    |
| Artifacts produced      | `kata maki record` calls           | Output tracking      |
| Decisions made          | `kata decision record` calls       | Judgment tracking    |
| Confidence distribution | Decision confidence scores         | Calibration analysis |
| Observations logged     | Observation JSONL                  | Learning input       |
| Outcomes (pass/fail)    | Gate evaluations, step completions | Effectiveness        |
| Friction points         | Observation type: friction         | Improvement targets  |
| Gaps triggered          | GapReport attribution              | Capability limits    |

### Agent-Level Learning

During cooldown, the reflection engine can:

1. **Aggregate** observations by kataka — "scout-ka logged 3 friction points about Rust imports"
2. **Detect patterns** — "implementer-ka consistently low-confidence on security decisions"
3. **Generate learnings** attributed to specific kataka — stored in the learning graph with kataka as source
4. **Update kataka** — learnings can be injected back into the kataka's preloaded skills or KATA.md
5. **Track improvement** — compare kataka performance across runs to measure learning effectiveness

### The Agent View (Interactive TUI)

`kata agent list` (alias: `kata kataka list`) displays the kataka registry:

```
┌──────────────────────────────────────────────────────────────────┐
│  Kataka Registry                                                 │
├────────────────┬──────────┬───────────┬──────┬──────────────────┤
│ Name           │ Stage    │ Wraps     │ Runs │ Avg Confidence   │
├────────────────┼──────────┼───────────┼──────┼──────────────────┤
│ scout-ka       │ research │ —         │ 12   │ 0.82             │
│ architect-ka   │ plan     │ —         │ 8    │ 0.75             │
│ implementer-ka │ build    │ frontend… │ 24   │ 0.88             │
│ auditor-ka     │ review   │ security… │ 15   │ 0.91             │
└────────────────┴──────────┴───────────┴──────┴──────────────────┘

  [↑↓] Navigate  [Enter] Drill down  [q] Quit
```

`kata agent inspect scout-ka` (alias: `kata kataka inspect`) opens an interactive drill-down view:

```
┌─ scout-ka ──────────────────────────────────────────────────────┐
│  Stage: research  │  Wraps: —  │  12 runs  │  Avg conf: 0.82   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [1] Configuration    tools, skills, model, stage                │
│  [2] Run History      recent runs with outcomes                  │
│  [3] Decisions        confidence distribution + timeline         │
│  [4] Observations     friction points, assumptions, predictions  │
│  [5] Learnings        patterns attributed to this kataka         │
│  [6] Linked Flavors   which ryu this kataka executes             │
│                                                                  │
│  [↑↓] Navigate  [Enter] View  [b] Back  [q] Quit               │
└─────────────────────────────────────────────────────────────────┘
```

Each section drills into the full detail — observations with timestamps, decision confidence histograms, learning text with confidence scores, and linked flavor execution counts.

---

## 11. Naming Convention Guide

### The Rules

1. **Agents (kataka)**: `{role}-ka` — noun + `-ka` suffix
   - Examples: `scout-ka`, `architect-ka`, `implementer-ka`, `auditor-ka`
   - Always kebab-case, lowercase
   - The role noun should be self-descriptive (scout, architect, implementer, auditor)
   - Optional qualifier for specialization: `api-architect-ka`, `security-auditor-ka`

2. **Skills**: `{verb}-{object}` — action + target
   - Examples: `scan-codebase`, `design-architecture`, `audit-security`, `bridge-gap`
   - Gerund form acceptable: `scanning-codebase`, `designing-architecture`
   - Always kebab-case, lowercase
   - Kata built-in skills use the `kata-` prefix: `kata-sensei`, `kata-bridge-gap`

3. **Context files**: descriptive, uppercase for visibility
   - `CLAUDE.md`, `KATA.md`, `AGENTS.md`

4. **Thematic aliases**: Japanese karate vocabulary
   - Agents: can use specific Japanese role words (tantei, kenchikuka, shokunin, shinpan)
   - Skills: can use Japanese verb forms
   - Always optional — English is primary, Japanese is decoration

### Naming Quality Checklist

When creating a new agent or skill, verify:

- [ ] The name tells you what it does without reading the description
- [ ] It follows the correct pattern (noun-ka for agents, verb-object for skills)
- [ ] It doesn't conflict with existing names in the project
- [ ] It's under 64 characters (Agent Skills open standard limit)
- [ ] It uses only lowercase letters, numbers, and hyphens
- [ ] The Japanese alias (if any) is accurate and thematically consistent
- [ ] The description includes both "what it does" AND "when to use it"

### This Guide Is Baked Into the Creation Tooling

The `kata-create-agent` and `kata-create-skill` skills include this naming convention as part of their instructions. Every generated agent/skill automatically follows these rules.

---

## 12. Implementation Roadmap

> **This section has been superseded by the [Unified Roadmap](unified-roadmap.md)**, which merges the Kataka architecture and Meta-Learning Epic ([#136](https://github.com/cmbays/kata/issues/136)) into a single sequenced implementation plan (Waves F–J).

The kataka system is implemented across these unified waves:

| Wave | Name | Kataka Deliverables |
|------|------|---------------------|
| F | Foundations | Lexicon extensions (`kataka`, `maki`, `sensei`, `kansatsu`), `kime` alias ([#153](https://github.com/cmbays/kata/issues/153)), KATA.md generation at init, observation schema with `katakaId?` field |
| G | Practitioners | KatakaRegistry, `kata agent list/inspect`, FlavorSchema `kataka?` field, init scanning (`--scan basic/full/resync`), 6 built-in skill files, `kata lexicon` TUI, `kata kiai` flags |
| H | Intelligence | Hierarchical observation capture at step/flavor/stage/cycle levels, `KnowledgeStore` upgrades (`loadForStep`, `loadForFlavor`) |
| I | Synthesis | Agent attribution (katakaId populated end-to-end), cooldown aggregation by kataka, agent-level learnings, KATA.md cooldown refresh |
| J | Mastery | Per-kataka domain confidence, kataka performance in belt criteria, gap bridging enhancement |

### Dependency Chain

```text
Wave F → Wave G → Wave I → Wave J
Wave F → Wave H → Wave I → Wave J
```

Wave F provides the shared data model (observation schema, learning enrichment, KATA.md template). Wave G builds the kataka identity and execution system on top. Waves H and I add intelligence. Wave J adds mastery tracking.

See [docs/unified-roadmap.md](unified-roadmap.md) for the full wave details, dependency graph, parallel agent strategy, and belt integration points.

---

## 13. Open Questions

Captured for future resolution:

1. **Default flavors**: Every stage should always have at least one flavor, since execution flows through flavors. When no flavor is explicitly defined, a basic default flavor should be loaded. The sensei's gap detection should also evaluate whether existing flavors are sufficient — if confidence is low that the available flavors cover the stage's needs, it should trigger the gap bridging pipeline to create appropriate flavors (with kataka, skills, and waza as needed).

2. **Kataka persistence across cycles**: Should kataka definitions evolve across cycles (learnings injected into system prompt), or should they be stable with learnings loaded as context? This is best addressed during the Meta-Learning Epic integration (Phase 5).

3. **Kataka retirement and archival**: When a kataka is no longer useful (technology changed, approach shifted), how do we archive it while preserving its observation history? The orphan detection during `--scan resync` handles the case where a wrapped agent is removed — but voluntary retirement of a still-valid kataka needs its own flow. Observation history must be preserved regardless.

4. **Community kataka**: Should there be a registry of community-contributed kataka definitions? How do they interact with the `kata-bridge-gap` ecosystem search? This is part of the V2 north star — community-supported content and packages, with kataka as a first-class package type.

---

## Appendix A: Themed Vocabulary Reference

For `kata --help` and `kata lexicon` TUI display:

| English      | 日本語 | Romaji   | Meaning            | Used For                       |
|--------------|--------|----------|--------------------|--------------------------------|
| Stage        | 行     | Gyo      | Path/practice      | Fixed methodology categories   |
| Step         | 技     | Waza     | Technique          | Atomic units of work           |
| Flavor       | 流     | Ryu      | School/style       | Compositions of steps          |
| Cycle        | 稽古   | Keiko    | Practice session   | Time-boxed work periods        |
| Gate         | 門     | Mon      | Gate/door          | Entry/exit conditions          |
| Decision     | 決め   | Kime     | Focus/decisiveness | Orchestration judgments         |
| Knowledge    | 分解   | Bunkai   | Analysis/breakdown | Extracted learnings            |
| Cooldown     | 間     | Ma       | Pause/space        | Reflection periods             |
| Execute      | 気合   | Kiai     | Spirit shout       | Running orchestration          |
| Agent        | 型家   | Kataka   | Form practitioner  | Kata-native AI agents          |
| Artifact     | 巻     | Maki     | Scroll             | Named step outputs             |
| Orchestrator | 先生   | Sensei   | Teacher            | Pipeline orchestration skill   |
| Observation  | 観察   | Kansatsu | Observation        | Runtime signals for learning   |
| Init         | 礼     | Rei      | Bow/respect        | Project initialization         |
| Watch        | 監視   | Kanshi   | Monitoring         | Real-time run observation      |

---

*This is a living document. Update it as the kataka system evolves.*
*Last updated: 2026-02-28*
