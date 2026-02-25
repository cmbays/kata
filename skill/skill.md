# Kata Skill — Agent Instructions

> This file is the primary entry point. Read it fully before using any kata command.

---

## 1. What Kata Is

**Kata is a methodology framework, not an agent runtime.** It provides structured execution tracks for AI agents:

- **Stage** — one of four fixed categories: `research`, `plan`, `build`, `review`. Stages run in sequence.
- **Flavor** — a named composition of steps within a stage (e.g., `rust-compilation`, `code-review-security`). Multiple flavors may run in parallel.
- **Step** — an atomic unit of work with gates and artifacts. You execute steps by doing work.
- **Gate** — a condition that must pass before proceeding. Kata gates pause execution and require either human approval or agent action.
- **Artifact** — a named output file produced by a step or flavor, recorded via CLI.
- **Decision** — a structured record of an orchestration judgment (e.g., which flavor to use, what confidence level).

Kata does not call LLMs or run agents. **You are the agent.** Kata is the track you run on.

---

## 2. The Workflow

### Start a cycle run

```
kata cycle start <cycle-id>          # Creates run trees for each bet
```

This returns a list of run IDs. Each run ID corresponds to one bet. Use `--json` to get machine-readable output.

### Get your next step

```
kata step next <run-id> --json
```

Returns one of four shapes:
- A step context payload (the step you should execute next)
- `{ "status": "waiting", "gate": { ... } }` if a gate is blocking
- `{ "status": "waiting", "message": "No flavors selected yet..." }` if the orchestrator hasn't selected flavors for the current stage
- `{ "status": "complete" }` if the run is done

### Do the work

Read the step's `prompt` field from `kata step next --json` output. Execute the work it describes. Then:

```
kata artifact record <run-id> \
  --stage <category> --flavor <name> --step <type> \
  --file <path> --summary "what this contains"
```

### Record decisions

Any orchestration judgment should be recorded:

```
kata decision record <run-id> \
  --stage <category> \
  --type flavor-selection \
  --context '{"stageName":"build","availableFlavors":["rust","ts"]}' \
  --options '["rust","ts"]' \
  --selected rust \
  --confidence 0.9 \
  --reasoning "The project is a Rust codebase"
```

### Handle gates

When `kata step next --json` returns `status: "waiting"`, check the `gate` field:

- **`human-approved` gate**: Surface the `gateId` to the user. Say: "Gate `<gateId>` requires human approval. Run `kata approve <gateId>` when ready." Then pause — do not proceed until the user approves.
- **`confidence-gate`**: A decision was recorded below the confidence threshold. Surface it to the user. Run `kata approve <gateId>` if the user consents, or re-evaluate with higher confidence.

After the gate is approved, call `kata step next --json` again to get the next step.

### Check run status

```
kata run status <run-id> --json
```

Returns full run state: all stages, flavors, steps, decisions, and artifacts.

---

## 3. CLI vs. File Access

| Operation | Use |
|-----------|-----|
| Record artifacts | `kata artifact record` — always use CLI for writes |
| Record decisions | `kata decision record` — always use CLI for writes |
| Approve gates | `kata approve` — always use CLI |
| Get next step | `kata step next` — returns what to work on next |
| **Advance** step state | Write `FlavorState` JSON directly — no CLI exists yet (see section 7) |
| **Read** run state | Read `.kata/runs/<run-id>/run.json` directly |
| **Read** stage state | Read `.kata/runs/<run-id>/stages/<category>/state.json` directly |
| **Read** artifact files | Browse `.kata/runs/<run-id>/stages/<category>/flavors/<name>/artifacts/` directly |
| **Read** prior syntheses | Read `.kata/runs/<run-id>/stages/<category>/synthesis.md` or use `priorStageSyntheses` from `kata step next --json` |

**Rule**: Use CLI for all write operations. Read state files directly for browsing context. See section 7 for operations that currently require direct file writes.

---

## 4. Sub-Agent Model

For parallel flavor execution within a stage, spawn one sub-agent per flavor:

```
# In the bet teammate (you):
kata step next <run-id> --json          # → learn you're in "build" stage
# Spawn flavor sub-agents in parallel:
Task("Execute rust-compilation flavor for run <run-id>", context=...)
Task("Execute integration-test flavor for run <run-id>", context=...)
# Wait for both to complete, then do synthesis
```

**Bet teammate** (top-level agent):
- Owns the run lifecycle: calls `kata step next`, handles stage transitions, does synthesis
- Spawns flavor sub-agents for parallel work
- Handles gates (pauses and surfaces to user)

**Flavor sub-agent** (spawned by bet teammate):
- Executes a single flavor's steps sequentially
- Records artifacts and decisions for that flavor
- Does NOT call `kata step next` at the run level
- Reports completion to the bet teammate

See `orchestration.md` for a concrete example. See `context-flow.md` for what context to pass each tier.

---

## 5. Confidence Gates

When recording a decision with `confidence < 0.7` (the default threshold), Kata automatically creates a confidence gate unless you pass `--yolo`.

- **Without `--yolo`**: Decision is recorded, gate is set in stage state. `kata step next` will return `status: "waiting"`. Surface the low-confidence decision to the user.
- **With `--yolo`**: Decision is recorded, gate is skipped. Execution continues. The decision log notes `lowConfidence: true` for cooldown review.

Use `--yolo` for decisions where pausing would be more disruptive than the risk of the low-confidence choice (e.g., minor flavor sub-selection where the user has already trusted you with the bet).

---

## 6. Context Files

| File | Purpose |
|------|---------|
| `cli-reference.md` | Full CLI command reference with `--json` output schemas |
| `file-structure.md` | How to read `.kata/runs/` state files |
| `orchestration.md` | Mapping Kata concepts → Claude Code teams/tasks |
| `context-flow.md` | What context each agent tier receives |
| `templates/decision-format.md` | Example decision record invocations |
| `templates/artifact-format.md` | Example artifact record invocations |
| `templates/synthesis-format.md` | Example synthesis artifact structure |
| `classification.md` | *(Wave D placeholder — not yet active. Use `--gyo` for manual stage selection until Wave D ships.)* |

---

## 7. Known CLI Limitations (v1 Wave B)

The following operations require **direct file writes** because CLI commands don't exist yet. See `orchestration.md` for exact JSON shapes.

| Operation | Workaround |
|-----------|-----------|
| Mark a step as completed | Write `FlavorState` JSON to `.kata/runs/<id>/stages/<cat>/flavors/<step-type>/state.json` |
| Set `selectedFlavors` for a stage | Write directly to `.kata/runs/<id>/stages/<cat>/state.json` |
| Advance to next stage | Update `currentStage` in `.kata/runs/<id>/run.json` |
| Mark a stage as completed | Update `status` in stage `state.json` |
| Set a human-approval gate | Write `pendingGate` to stage `state.json` |
| Mark run completed | Set `status: "completed"` and `completedAt` in `run.json` |

**Flavor name ≠ step types**: Flavor composition files (`.kata/flavors/plan.api-design.json`) define multi-step sequences. You record decisions using the **flavor name**, but you write **step types** to `selectedFlavors`. Read the flavor JSON to extract step types (`steps[].stepType`).

These gaps are tracked as issues and will be resolved in Wave C (orchestration engine).
