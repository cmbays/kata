# kata-sensei — The Meta-Orchestrator

> Sensei (先生) coordinates multi-stage pipelines, passing artifacts between stages and synthesizing pipeline-level learnings.

---

## What Sensei Does

The sensei (MetaOrchestrator) activates when `kata kiai` receives more than one stage category:

```bash
kata kiai research plan build review
```

For each stage in sequence, sensei:
1. Loads available flavors for that category
2. Builds an OrchestratorContext with artifacts from all prior stages
3. Creates and runs the stage-level orchestrator
4. Accumulates stage artifacts for the next stage
5. After all stages complete, runs a pipeline-level reflect phase

---

## Stage Handoff

Artifacts from stage N are passed as `availableArtifacts` to stage N+1. This lets the build orchestrator know that a `plan-artifact` exists, influencing flavor selection.

---

## Pipeline Output

```json
{
  "stageResults": [
    { "stageCategory": "research", "selectedFlavors": ["..."], ... },
    { "stageCategory": "plan",     "selectedFlavors": ["..."], ... }
  ],
  "pipelineReflection": {
    "overallQuality": "high",
    "learnings": ["..."]
  }
}
```

---

## Confidence Gates in Pipelines

Each stage runs with `confidenceThreshold: 0.7` by default. Low-confidence decisions pause the pipeline for human approval.

Use `--yolo` to skip all confidence gates across the entire pipeline:

```bash
kata kiai research plan build --yolo
```

---

## Using Sensei as an Agent

When you receive a bet and need to run a full pipeline:

```bash
kata kiai research plan build review \
  --kataka "$KATAKA_ID" \
  --bet '{"title":"Add OAuth2 login","appetitePercent":30}' \
  --json
```

Parse the JSON output to extract `stageResults[].stageArtifact` for synthesis.

---

## Cycle-as-a-Team

When running a full cycle with Claude Code teams, the sensei acts as the **team lead** — orchestrating bets, spawning kataka teammates, and managing the shared `.kata/` state.

### Role

- Sensei is the meta-orchestrator for the **entire cycle and all its bets**.
- Create a team with `TeamCreate`, then manage work via the task list.
- One task per bet; subtasks for individual stages/flavors within each bet.

### Teammates Are Kataka

Teammates are spawned **per stage/flavor**, not per bet. They are ephemeral — created for a specific execution, then shut down.

### Naming Convention

Teammate names follow `{bet-slug}/{kataka-name}`:

```
auth-fix/bugfix-ts
db-migration/research-deep
ui-overhaul/bugfix-ts-2     ← disambiguation index when same kataka runs twice
```

Use `generateTeammateName()` from `@shared/lib/naming.js` or apply the convention manually: slugify the bet title (lowercase, hyphens, max 20 chars), append `/{katakaName}`, add `-{index}` if needed.

### Worktree Decision

Each flavor declares an `isolation` field:

| `flavor.isolation` | Meaning | Agent tool parameter |
|---------------------|---------|---------------------|
| `"worktree"` | Modifies source code | `isolation: "worktree"` |
| `"shared"` (default) | Reads code or writes only to `.kata/` | Omit `isolation` |

Before spawning a teammate, check the flavor's isolation mode. Code-modifying flavors (build stages) typically need worktree isolation. Review and research flavors typically run shared.

### Shared `.kata/` Path

**All teammates must use the main repo's `.kata/` path for operational data.** Worktree agents get an isolated copy of source code, but their `.kata/` reads/writes must target the original location.

In the teammate's prompt, always include:

```
KATA_DIR=/absolute/path/to/project/.kata
All kata commands must use --cwd /absolute/path/to/project or operate against $KATA_DIR.
```

This ensures observations, artifacts, decisions, and run data are written to the shared store where other stages (and cooldown) can find them.

### Task List Pattern

```
Task 1: [bet] Add OAuth2 login (appetite: 30%)
  Task 1a: [research] deep-research flavor
  Task 1b: [plan] ui-planning flavor
  Task 1c: [build] bugfix-ts flavor       ← isolation: worktree
  Task 1d: [review] bugfix-verify flavor   ← isolation: shared
Task 2: [bet] Fix pagination bug (appetite: 10%)
  Task 2a: [build] bugfix-ts flavor
  Task 2b: [review] bugfix-verify flavor
```

Bets can run concurrently when they don't share files. Sequential stages within a bet must complete in order (research → plan → build → review).

### Artifact Handoff

Stages produce artifacts in `.kata/artifacts/`. When stage N completes:

1. Read the artifact from `.kata/artifacts/{artifactName}-{timestamp}.md`
2. Pass the artifact path (or content summary) in the next stage's prompt
3. The next stage's entry gate (`artifact-exists`) will verify the artifact is present

Since all teammates write to the shared `.kata/`, artifacts are automatically visible across stages.

### Concurrent Safety

The `.kata/` data model is designed for concurrent access:

- **JSONL files** (observations, decisions, history): append-only — concurrent writes are safe
- **Run directories**: use UUIDs — no collisions between concurrent bets
- **Artifact files**: use timestamps in filenames — no overwrites
- **config.json**: read-only during execution — no contention

### Cooldown

Run cooldown **in the main session** after all bets complete. All data is already in the shared `.kata/`:

```bash
kata cooldown --prepare     # gathers stats, prepares reflection input
kata cooldown               # interactive cooldown session
kata cooldown --complete    # finalize and generate proposals
```

Cooldown reads from the same `.kata/` that all teammates wrote to, so it sees the full picture.
