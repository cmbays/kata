# Sensei Orchestration — What the Sensei Does

> How the sensei skill drives pipeline execution — parallel ryu dispatch, mon handling, gap bridging, and the autonomous execution model.
>
> **Companion documents**:
> - [Kataka Architecture](kataka-architecture.md) — What kataka are (agent identity, wrapping, attribution)
> - [Kata System Guide](kata-system-guide.md) — How the system works today
> - [Project Setup](project-setup.md) — How you set up and maintain a project
> - [Implementation Roadmap](unified-roadmap.md) — Waves F–J build the kataka + sensei system

---

## The Sensei Skill

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

1. Call `kata waza next --json` to get the current gyo and waza
2. Determine which ryu the gyo requires
3. Look up the kataka assigned to each selected ryu
4. Spawn kataka as team agents (parallel execution within a gyo)
5. Wait for all ryu executions to complete
6. Handle mon (approve, escalate to human, or use `--yolo`)
7. Write gyo synthesis when all ryu in a gyo complete
8. Transition to the next gyo
9. Handle gap detection and optionally bridge gaps mid-run

---

## Parallel Execution via Teams

Within a gyo, the sensei selects which ryu to apply. Each selected ryu has an assigned kataka. The sensei spawns all required kataka as **Claude Code team agents** running in parallel.

```
Gyo: build
  ↓ sensei selects 3 ryu
  ├─ ryu: build.tdd-typescript  → spawns implementer-ka (teammate)
  ├─ ryu: build.api-integration → spawns implementer-ka (teammate)
  └─ ryu: build.frontend        → spawns frontend-ka   (teammate)
      ↓ all 3 run in parallel as team agents
  ← sensei collects results, writes gyo synthesis
```

The team infrastructure (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`) enables this:

- **Sensei is the team lead** — the main session loads `kata-sensei` and creates the team
- **Kataka are teammates** — spawned via the Task tool with `team_name` and assigned tasks
- **Shared task list** — kataka check `TaskList` for their assignments, mark tasks complete when done
- **Parallel, not sequential** — multiple ryu execute simultaneously, each in its own kataka context
- **Gyo gate** — the sensei waits for all ryu tasks to complete before writing the gyo synthesis and transitioning

When the same kataka is assigned to multiple ryu, the sensei spawns separate instances. Each instance operates independently with its own task, context, and kansatsu trail.

Sequential execution is also possible (and may be preferred when ryu have dependencies). The sensei determines the execution strategy based on ryu dependency analysis — independent ryu run in parallel, dependent ryu run in sequence.

---

## Execution Modes

| Mode | Flags | Behavior |
|------|-------|----------|
| **Interactive** | (none) | Pause at mon, ask user on low-confidence kime |
| **Autonomous** | `--yolo` | Skip human-approval mon, log confidence for post-hoc review |
| **Self-healing** | `--yolo --bridge-gaps` | Full autonomous + create missing resources mid-run |
| **Interactive healing** | `--bridge-gaps` | Pause at mon, but bridge gaps with user discussion |

For a fully autonomous, self-healing pipeline run:

```bash
kata kiai research plan build review --yolo --bridge-gaps
```

- `--yolo` skips human-approval mon (kime still recorded with confidence)
- `--bridge-gaps` creates missing skills/agents/ryu mid-run instead of waiting for ma

For interactive runs, omit both flags — the sensei pauses at mon and notes gaps for ma.

---

## Gap Bridging

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
Create: Generate the required resources
  ↓
Validate: Run quality mon (spec validation, security scan)
  ↓
Integrate: Register in KATA.md, link to appropriate ryu/gyo
```

### What Bridge-Gap Can Create

| Gap Severity | Resources Created | Example |
|--------------|-------------------|---------|
| Minor | A single skill | Missing Rust conventions → create `rust-conventions` skill |
| Moderate | A skill + new waza | Missing linting step → create skill + register waza type |
| Major | A kataka + skills + new waza | No security review agent → create auditor-ka + audit skills |
| Structural | A full ryu + kataka + skills + waza | No API testing flow → create ryu with waza, agent, skills |

### Mid-Run vs. Ma (Cooldown)

| Timing | Trigger | Scope |
|--------|---------|-------|
| Mid-run (`--bridge-gaps`) | Gap detected during waza execution | All gap severities — creates resources as needed |
| Ma (default) | Gaps collected during run, surfaced in reflection | All gaps — become bets/proposals for next keiko |

The default mode prevents scope creep by deferring gap resolution to ma. The bridge mode enables fully autonomous self-healing runs for rapid iteration.

---

*See [Kataka Architecture](kataka-architecture.md) for the agent identity system and [Implementation Roadmap](unified-roadmap.md) for sequencing.*
