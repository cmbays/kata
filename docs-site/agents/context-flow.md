# Kata Context Flow — Progressive Context Narrowing

> Context flows down from the top-level orchestrator. Each tier receives what it needs — nothing more.

---

## Overview

```
User
└── Sensei — full skill package + cycle/run context
    └── Delegated Worker Agent — focused skill subset + flavor context
```

Context narrows as you go deeper. Worker agents do not receive the full skill package — only what they need to execute their flavor.

---

## Tier 1: Sensei

**Receives from the user (or cycle start)**:

| Context Item | Source | Purpose |
|-------------|--------|---------|
| Full `skill.md` | `.kata/skill/skill.md` | Complete methodology understanding |
| `cli-reference.md` | `.kata/skill/cli-reference.md` | All CLI commands with JSON schemas |
| `file-structure.md` | `.kata/skill/file-structure.md` | How to read state files |
| `orchestration.md` | `.kata/skill/orchestration.md` | How to manage flavors and gates |
| `context-flow.md` | `.kata/skill/context-flow.md` | This file — for worker context construction |
| `run-id` | from `kata cycle start --json` | Identifies the active run being orchestrated |
| `cycle-id` | from user or `kata cycle start --json` | Parent cycle context |
| `bet-prompt` | from `run.json` or `kata cycle start --json` | The north star for the active run |
| `kata-pattern` | from `run.json` | Which named pattern (e.g., "full-feature") |

**Does NOT receive**:
- Step-level prompts (those come from `kata step next --json`)
- Flavor-specific resources (those go to delegated workers)

---

## Tier 2: Delegated Worker Agent

**Receives from sensei**:

| Context Item | Source | Why |
|-------------|--------|-----|
| Condensed `skill.md` | `.kata/skill/skill.md` (workflow + CLI sections only) | Understands the basics without full overhead |
| `cli-reference.md` | `.kata/skill/cli-reference.md` | Needs artifact and decision CLI commands |
| `run-id` | from sensei | To call `kata artifact record` and `kata decision record` |
| `stage` | from sensei | The stage category being executed |
| `flavor` | from sensei | This agent's assigned flavor |
| `bet-prompt` | from sensei | The north star context |
| `step-prompt` | from `kata step next --json` `.prompt` field | The actual instructions for the current step |
| `step-resources` | from `kata step next --json` `.resources` field | Which tools/agents to use |
| `prior-artifacts` | from `kata step next --json` `.priorArtifacts` field | Artifacts from earlier steps in this flavor |
| `prior-stage-syntheses` | from `kata step next --json` `.priorStageSyntheses` field | Stage-level handoffs from completed stages |

**Does NOT receive**:
- `orchestration.md` — workers don't orchestrate, they execute
- `context-flow.md` — workers don't spawn further workers
- `file-structure.md` — workers don't need to browse state files; they use the artifact paths provided
- Full run state — workers work within their flavor only

---

## What `kata step next --json` Provides

The `kata step next --json` output is the **primary context injection mechanism**. When sensei calls it, the response includes everything the active flavor needs:

```json
{
  "runId": "...",
  "stage": "build",
  "flavor": "rust-compilation",
  "step": "compile",
  "prompt": "Full prompt text with {{betPrompt}} interpolated...",
  "resources": {
    "tools": ["Bash", "Read", "Write"],
    "agents": [],
    "skills": []
  },
  "gates": {
    "entry": [...],
    "exit": [...]
  },
  "priorArtifacts": [...],
  "betPrompt": "Implement OAuth2 login flow",
  "priorStageSyntheses": [
    { "stage": "research", "filePath": "/absolute/path/..." }
  ]
}
```

Sensei extracts this context and passes the relevant fields to the delegated worker.

---

## Constructing Delegated Worker Context

When spawning a delegated worker, pass:

```
You are executing the "<flavor>" flavor for stage "<stage>" in run "<run-id>".

## Your objective
<bet-prompt>

## Your current step
Step: <step>
<prompt (from kata step next --json)>

## Resources available
<resources.tools, resources.agents, and resources.skills from kata step next --json>

## Entry gates to check before starting
<gates.entry from kata step next --json>

## Exit gates to satisfy before finishing
<gates.exit from kata step next --json>

## Prior artifacts in this flavor
<priorArtifacts from kata step next --json>

## Prior stage syntheses
<priorStageSyntheses — read these files for handoff context>

## How to record your work
- Record artifacts: kata artifact record <run-id> --stage <stage> --flavor <flavor> --step <step> --file <path> --summary "..."
- Record decisions: kata decision record <run-id> --stage <stage> --flavor <flavor> --type <type> ...

[Attach condensed skill.md sections: "The Workflow" and "CLI vs. File Access"]
[Attach cli-reference.md]
```

---

## Key Principle: Minimal Context for Worker Agents

Worker agents operate within a narrow, well-defined scope. Providing too much context creates confusion and wastes tokens. Provide only what is listed above.

Sensei holds the full picture. The worker executes a slice of it.
