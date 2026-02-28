# Kataka Architecture — Methodology-Aware AI Agents

> What kataka are — agent identity, the three-layer model, anatomy, ryu binding, observability, and naming conventions.
>
> **Companion documents**:
> - [Sensei Orchestration](sensei-orchestration.md) — What the sensei does (execution, gap bridging)
> - [Project Setup](project-setup.md) — How you set up and maintain a project (KATA.md, init scanning)
> - [Kata System Guide](kata-system-guide.md) — How the system works today
> - [Meta-Learning Architecture](meta-learning-architecture.md) — The observation and knowledge systems
> - [Implementation Roadmap](unified-roadmap.md) — Kataka ships in Wave G, attribution in Wave I
>
> The kataka system is designed but not yet built. Implementation begins in Wave G. See [Roadmap](unified-roadmap.md) for sequencing.

---

## 1. Vision

Kata is a methodology engine. It encodes how work should flow — gyo, ryu, waza, mon, maki, kime, kansatsu, and bunkai. But methodology without execution is theory.

**Kataka** (型家) are Kata-native AI agents — practitioners of the methodology. They are the bridge between Kata's structured pipeline and the AI agents that do the actual work. A kataka knows:

- Where it is in the pipeline (which gyo, which ryu, which waza)
- What maki it should produce (de-mon)
- What maki it can consume (iri-mon, predecessor outputs)
- How to record its work (maki, kime, kansatsu)
- How to participate in the bunkai cycle (ma, reflection, self-improvement)

---

## 2. The Kata Lexicon

> The complete vocabulary lives in [System Guide — The Kata Lexicon](kata-system-guide.md#11-the-kata-lexicon). This section covers only kataka-specific terms.

The `-ka` suffix (家, "practitioner") on an agent name signals it is a **Kata-native wrapper agent**. The convention comes from Japanese martial arts — judoka (柔道家), karateka (空手家), kendoka (剣道家). A kataka (型家) is a practitioner of kata (型, form).

A kataka is methodology-aware, participates in the kansatsu/bunkai cycle, and knows how to use Kata's CLI.

### Help & Lexicon Display

Commander.js provides `kata --help` automatically. The lexicon is appended via `addHelpText('after', ...)`. For a deeper interactive experience, `kata kotoba` (lexicon) provides a full TUI table with English terms, Japanese aliases, kanji, romaji, and descriptions.

---

## 3. The Three-Layer Model

Every AI coding project has three layers of customization. Kata understands and works within all three.

### Layer 1: Context — "What the project is"

Always-loaded ambient knowledge about the project.

| Format | Purpose | Example |
|--------|---------|---------|
| `CLAUDE.md` | Project instructions for Claude Code | Architecture, commands, conventions |
| `.kata/KATA.md` | Kata-specific project context | Methodology preferences, active keiko, integration points |
| `AGENTS.md` | Cross-tool project context | Build commands, test instructions, code style |
| `.kata/config.json` | Kata configuration | Gyo, ryu, adapter, thresholds |

`.kata/KATA.md` is generated/updated by `kata rei` and refreshed by `kata ma`. See [Project Setup](project-setup.md) for details.

### Layer 2: Skills — "How to do things"

Activatable knowledge and workflows. Stateless, portable, reusable.

| Naming | Format | Purpose |
|--------|--------|---------|
| Verb-object | `.claude/skills/<name>/SKILL.md` | Reusable capability |
| Examples | `scan-codebase`, `design-architecture`, `audit-security` | What gets done |

Skills follow the [Agent Skills open standard](https://agentskills.io/specification). Kata ships built-in skills with the `kata-` prefix:

| Skill | Purpose |
|-------|---------|
| `kata-orchestration` | Shared kataka protocol — waza lifecycle, quality protocol, context loading |
| `kata-sensei` | Orchestration playbook for the main session / team lead |
| `kata-create-agent` | Knowledge + templates for creating new kataka |
| `kata-create-skill` | Knowledge + templates for creating new skills |
| `kata-bridge-gap` | Full gap analysis → creation → integration pipeline |
| `kata-scan-project` | Project scanning, agent/skill classification, wrapper generation |

### Layer 3: Agents — "Who does the work"

Execution identities with their own context window, tools, and persona.

| Naming | Format | Purpose |
|--------|--------|---------|
| Noun-ka | `.claude/agents/<name>-ka.md` | Kata-native agent (kataka) |
| Noun | `.claude/agents/<name>.md` | Regular agent (not Kata-aware) |

### How They Compose

```text
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
- **The main session loads kata-sensei** to act as orchestrator
- **Kataka cannot spawn other kataka** (Claude Code constraint) — only the main session spawns agents

---

## 4. Kataka Anatomy

### Definition Format

A kataka is a standard Claude Code agent definition (`.claude/agents/<name>-ka.md`) with Kata-specific frontmatter. The orchestration protocol lives in the `kata-orchestration` skill — not repeated in every kataka.

```yaml
---
name: implementer-ka
description: >
  Kata build practitioner. Use for build-gyo ryu execution.
  Writes code following TDD methodology, records all maki and kime.
tools: Read, Write, Edit, Bash, Grep, Glob
model: inherit
skills:
  - kata-orchestration
  - tdd-workflow
  - api-conventions
metadata:
  kata:
    stage: build
    wraps: frontend-builder
    created-by: kata-init-scan
    last-synced: "2026-02-27"
---

## Wrapped Capability: Frontend Builder

You build frontend screens and components following project standards...
```

### Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Agent name with `-ka` suffix |
| `description` | Yes | Includes "when to use" guidance for the spawning session |
| `tools` | Yes | Merged: original agent tools + any Kata-required tools |
| `model` | No | `inherit` uses the parent session's model (recommended default) |
| `skills` | Yes | Must include `kata-orchestration`; add domain skills as needed |
| `metadata.kata.stage` | Yes | One of: `research`, `plan`, `build`, `review` |
| `metadata.kata.wraps` | No | Name of the original agent this kataka absorbs |
| `metadata.kata.created-by` | No | How created: `kata-init-scan`, `kata-bridge-gap`, `manual` |
| `metadata.kata.last-synced` | No | ISO timestamp of last sync with wrapped agent source |

### Gyo Assignment

Every kataka belongs to exactly one gyo:

| Gyo | Example Kataka | Typical Tools |
|-----|----------------|---------------|
| Research | `scout-ka`, `analyst-ka` | Read, Grep, Glob, WebSearch, WebFetch |
| Plan | `architect-ka`, `estimator-ka` | Read, Grep, Glob, Write |
| Build | `implementer-ka`, `tester-ka` | Read, Write, Edit, Bash, Grep, Glob |
| Review | `auditor-ka`, `verifier-ka` | Read, Grep, Glob |

### Wrapping Mechanics

When `kata rei --scan` creates a kataka from an existing agent:

1. **Read** the original agent's frontmatter (tools, skills, model, description)
2. **Absorb** the original agent's system prompt into the kataka's body
3. **Merge** tool lists (original tools + any Kata-required tools)
4. **Preload** `kata-orchestration` skill alongside original skills
5. **Record** the wrapping relationship in `metadata.kata.wraps`
6. **Record** sync timestamp in `metadata.kata.last-synced`

The original agent file is **never modified**. It continues to work independently for non-Kata usage.

---

## 5. Kataka-to-Ryu Binding

Each ryu has an assigned kataka. This is a design-time decision, not a runtime guess.

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

- **Orchestrator's job**: Pick ryu for the gyo → kataka assignment is already decided
- **Agent configuration**: Each kataka is pre-configured for the kind of work that ryu requires
- **Observability**: Track kataka performance per ryu across runs
- **Onboarding**: Looking at a ryu tells you exactly who executes it

### One Kataka, Many Ryu

A single kataka can be assigned to multiple ryu within the same gyo. When the sensei selects multiple ryu, the same kataka may be spawned multiple times — once per ryu execution. Kansatsu and kime are attributed per-ryu per-run, so even when the same kataka executes multiple ryu, the data stays distinct.

### v1 Constraint

For v1, each ryu has exactly one assigned kataka. Per-waza assignment is a future extension.

---

## 6. Observability and Attribution

### Kataka as Trackable Entities

Every kansatsu, kime, maki, and outcome can be attributed to the specific kataka that produced it via `katakaId`.

| Metric | Source | Purpose |
|--------|--------|---------|
| Runs participated | Run state files | Activity tracking |
| Maki produced | `kata maki record` calls | Output tracking |
| Kime made | `kata kime record` calls | Judgment tracking |
| Confidence distribution | Kime confidence scores | Calibration analysis |
| Kansatsu logged | Kansatsu JSONL | Bunkai input |
| Outcomes (pass/fail) | Mon evaluations, waza completions | Effectiveness |
| Friction points | Kansatsu type: friction | Improvement targets |
| Gaps triggered | GapReport attribution | Capability limits |

### Agent-Level Bunkai

During ma, the reflection engine can:
1. **Aggregate** kansatsu by kataka
2. **Detect patterns** — "implementer-ka consistently low-confidence on security kime"
3. **Generate bunkai** attributed to specific kataka
4. **Update kataka** — bunkai injected back into KATA.md kataka section
5. **Track improvement** — compare kataka performance across runs

### The Agent View (Interactive TUI)

`kata kataka list` displays the kataka registry. `kata kataka inspect` opens a drill-down with configuration, run history, kime, kansatsu, bunkai, and linked ryu.

---

## 7. Naming Convention Guide

### The Rules

1. **Agents (kataka)**: `{role}-ka` — noun + `-ka` suffix
   - Examples: `scout-ka`, `architect-ka`, `implementer-ka`, `auditor-ka`
   - Always kebab-case, lowercase
   - Optional qualifier for specialization: `api-architect-ka`, `security-auditor-ka`

2. **Skills**: `{verb}-{object}` — action + target
   - Examples: `scan-codebase`, `design-architecture`, `audit-security`, `bridge-gap`
   - Kata built-in skills use the `kata-` prefix: `kata-sensei`, `kata-bridge-gap`
   - Always kebab-case, lowercase

3. **Context files**: descriptive, uppercase for visibility
   - `CLAUDE.md`, `KATA.md`, `AGENTS.md`

4. **Thematic aliases**: Japanese karate vocabulary
   - Always optional — English is primary, Japanese is decoration

### Naming Quality Checklist

- [ ] The name tells you what it does without reading the description
- [ ] It follows the correct pattern (noun-ka for agents, verb-object for skills)
- [ ] It doesn't conflict with existing names in the project
- [ ] It's under 64 characters (Agent Skills open standard limit)
- [ ] It uses only lowercase letters, numbers, and hyphens

---

## 8. Open Questions

1. **Default ryu**: Every gyo should always have at least one ryu. When none is defined, a basic default ryu should be loaded. The sensei's gap detection should evaluate whether existing ryu are sufficient.

2. **Kataka persistence across keiko**: Should kataka definitions evolve across keiko (bunkai injected into system prompt), or should they be stable with bunkai loaded as context?

3. **Kataka retirement and archival**: When a kataka is no longer useful, how do we archive it while preserving kansatsu history?

4. **Community kataka**: Should there be a registry of community-contributed kataka definitions? V2 concern.

---

## Implementation Roadmap

> The kataka system ships across Waves F–J. See [Unified Roadmap](unified-roadmap.md) for the full wave details.

| Wave | Kataka Deliverables |
|------|---------------------|
| F | Lexicon extensions, KATA.md generation, kansatsu schema with `katakaId?` |
| G | KatakaRegistry, `kata kataka`, FlavorSchema `kataka?`, init scanning, 6 skill files, `kata kotoba` TUI |
| H | Hierarchical kansatsu capture, BunkaiStore upgrades |
| I | Agent attribution end-to-end, ma aggregation by kataka, KATA.md ma refresh |
| J | Per-kataka domain confidence, belt integration |

---

*This is a living document. Update it as the kataka system evolves.*
