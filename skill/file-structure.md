# Kata File Structure — State File Guide

> Use CLI for all writes. Read these files directly for browsing context.

---

## Directory Tree

```
.kata/
  config.json                  # Project config (methodology, adapter, confidence threshold)
  runs/
    <run-id>/                  # One directory per bet run (UUID)
      run.json                 # Top-level run state
      decisions.jsonl          # All decisions (append-only log)
      decision-outcomes.jsonl  # Post-facto outcomes per decision
      artifact-index.jsonl     # Index of all artifacts across all stages
      stages/
        <category>/            # research | plan | build | review
          state.json           # Stage state
          synthesis.md         # Stage-level synthesis (written DIRECTLY by bet teammate — no CLI)
          flavors/
            <flavor-name>/
              state.json                   # Flavor state
              synthesis.md                 # Flavor synthesis artifact
              artifact-index.jsonl         # Flavor-scoped artifact index
              artifacts/
                <filename>               # Actual artifact files
  stages/
    <step-type>.json           # Step definitions (user-defined + builtins)
  flavors/
    <flavor-name>.json         # Flavor definitions
  prompts/
    <step-type>.md             # Step prompt templates
  cycles/
    <cycle-id>.json            # Cycle records with bets
  katas/
    <pattern-name>.json        # Saved kata patterns (stage sequences)
  skill/
    skill.md                   # This skill package
```

---

## `run.json` — Top-Level Run State

Location: `.kata/runs/<run-id>/run.json`

```json
{
  "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "cycleId": "550e8400-e29b-41d4-a716-446655440000",
  "betId": "a87ff679-a2f3-401c-85e3-d89b5428c1de",
  "betPrompt": "Implement OAuth2 login flow",
  "kataPattern": "full-feature",
  "stageSequence": ["research", "plan", "build", "review"],
  "currentStage": "build",
  "status": "running",
  "startedAt": "2026-02-25T10:00:00Z",
  "completedAt": null
}
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Run identifier |
| `cycleId` | UUID | Parent cycle |
| `betId` | UUID | Parent bet |
| `betPrompt` | string | The bet's original description — the "north star" |
| `kataPattern` | string? | Named kata pattern; `undefined` for ad-hoc |
| `stageSequence` | string[] | Ordered stages this run will execute |
| `currentStage` | string\|null | Stage currently executing; `null` before first stage starts |
| `status` | enum | `pending` \| `running` \| `completed` \| `failed` |
| `startedAt` | ISO 8601 | Run creation time |
| `completedAt` | ISO 8601? | Set when status reaches `completed` or `failed` |

---

## `stages/<category>/state.json` — Stage State

Location: `.kata/runs/<run-id>/stages/<category>/state.json`

```json
{
  "category": "build",
  "status": "running",
  "executionMode": "parallel",
  "selectedFlavors": ["rust-compilation", "integration-test"],
  "gaps": [
    { "description": "No load testing flavor selected", "severity": "low" }
  ],
  "synthesisArtifact": "stages/build/synthesis.md",
  "decisions": ["3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12"],
  "pendingGate": {
    "gateId": "confidence-3b07e7d4",
    "gateType": "confidence-gate",
    "requiredBy": "rust-compilation"
  },
  "approvedGates": [
    {
      "gateId": "entry-build",
      "gateType": "human-approved",
      "requiredBy": "stage",
      "approvedAt": "2026-02-25T10:20:00Z",
      "approver": "human"
    }
  ],
  "startedAt": "2026-02-25T10:20:00Z"
}
```

| Field | Type | Notes |
|-------|------|-------|
| `category` | enum | `research` \| `plan` \| `build` \| `review` |
| `status` | enum | `pending` \| `running` \| `completed` \| `failed` \| `skipped` |
| `executionMode` | enum? | `parallel` \| `sequential`; set by orchestrator |
| `selectedFlavors` | string[] | Flavors chosen for this stage; empty until orchestrator selects |
| `gaps` | Gap[] | Gap analysis findings; may be empty |
| `synthesisArtifact` | string? | Relative path to synthesis.md once written directly by bet teammate |
| `decisions` | UUID[] | Decision IDs recorded in this stage |
| `pendingGate` | PendingGate? | Present when a gate is blocking; cleared by `kata approve` |
| `approvedGates` | ApprovedGate[] | History of approved gates |

**Key read patterns**:
- `pendingGate` present → execution is blocked, surface to user
- `selectedFlavors.length === 0` → orchestrator hasn't selected flavors yet
- `status === "completed"` and `synthesisArtifact` set → synthesis is available

---

## `stages/<category>/flavors/<name>/state.json` — Flavor State

Location: `.kata/runs/<run-id>/stages/<category>/flavors/<name>/state.json`

```json
{
  "name": "rust-compilation",
  "stageCategory": "build",
  "status": "running",
  "steps": [
    {
      "type": "prepare",
      "status": "completed",
      "artifacts": ["stages/build/flavors/rust-compilation/artifacts/Cargo.lock"],
      "startedAt": "2026-02-25T10:25:00Z",
      "completedAt": "2026-02-25T10:28:00Z"
    },
    {
      "type": "compile",
      "status": "running",
      "artifacts": [],
      "startedAt": "2026-02-25T10:30:00Z"
    }
  ],
  "currentStep": 1
}
```

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Flavor name (matches flavor definition) |
| `stageCategory` | enum | Stage this flavor belongs to |
| `status` | enum | `pending` \| `running` \| `completed` \| `failed` \| `skipped` |
| `steps` | FlavorStepRun[] | Ordered step records |
| `steps[].type` | string | Step type identifier |
| `steps[].status` | enum | Per-step status |
| `steps[].artifacts` | string[] | Relative paths to artifacts produced by this step |
| `currentStep` | number? | 0-based index of currently executing step; null if none |

---

## `artifact-index.jsonl` — Artifact Index

Location:
- Run-level: `.kata/runs/<run-id>/artifact-index.jsonl`
- Flavor-level: `.kata/runs/<run-id>/stages/<category>/flavors/<name>/artifact-index.jsonl`

Each line is a JSON object:
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "stageCategory": "build",
  "flavor": "rust-compilation",
  "step": "compile",
  "fileName": "build-report.md",
  "filePath": "stages/build/flavors/rust-compilation/artifacts/build-report.md",
  "summary": "Cargo build output: 0 errors, 2 warnings",
  "type": "artifact",
  "recordedAt": "2026-02-25T10:45:00Z"
}
```

Synthesis artifacts have `"type": "synthesis"` and `"step": null`.

**Reading the index**: The file is newline-delimited JSON. Each line is a complete JSON object. Read all lines, parse each, filter by `stageCategory` or `flavor` as needed.

---

## Artifact Files

Actual artifact content is at the path referenced by `filePath` in the index, **relative to the run directory root**:

```
.kata/runs/<run-id>/<filePath>
```

Browse them directly — no CLI needed for reads.

---

## When to Read Files vs. Call CLI

| Scenario | Approach |
|----------|----------|
| Check if a gate is pending | Read `stages/<category>/state.json`, check `pendingGate` field |
| See which flavors are selected | Read `stages/<category>/state.json`, check `selectedFlavors` |
| Read a prior stage synthesis | Read `stages/<category>/synthesis.md` directly |
| Write stage synthesis | Write directly to `<runDir>/stages/<category>/synthesis.md` — no CLI |
| Browse artifact content | Read file at `<runDir>/<artifact.filePath>` directly |
| List decisions for a stage | Read `decisions.jsonl`, filter by `stageCategory` |
| Get next step | `kata step next <run-id> --json` — has step context and prompt |
| Record anything | Always use CLI: `kata artifact record`, `kata decision record` |
| Approve a gate | Always use CLI: `kata approve <gate-id>` |
