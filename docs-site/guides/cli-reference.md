# Kata CLI Reference — Agent-Facing Commands

> All commands support `--json` for machine-readable output.
> `--json` is a global flag — append it anywhere in the command: `kata run status <id> --json`
> The program does not use positional option parsing, so placement does not matter.

---

## `kata cycle add-bet <cycle-id> <description>`

Add a bet to a cycle in `planning` state, with an optional kata assignment.

**Required**: `<cycle-id>`, `<description>` — cycle UUID and bet description text

**Optional flags**:
- `--kata <name>` — named kata pattern (e.g. `full-feature`); mutually exclusive with `--gyo`
- `--gyo <stages>` — ad-hoc stage list, comma-separated (e.g. `research,build`); mutually exclusive with `--kata`
- `-a, --appetite <pct>` — appetite percentage of cycle budget (default: 20)

**Example**:
```bash
kata cycle add-bet "$CYCLE_ID" "Implement OAuth2 login flow" \
  --kata full-feature \
  --appetite 30 --json
```

**`--json` output**:
```json
{
  "status": {
    "cycleId": "550e8400-e29b-41d4-a716-446655440000",
    "budget": { "tokenBudget": 200000 },
    "tokensUsed": 0,
    "utilizationPercent": 0,
    "perBet": [
      {
        "betId": "a87ff679-a2f3-401c-85e3-d89b5428c1de",
        "description": "Implement OAuth2 login flow",
        "appetite": 30,
        "budgetAllocation": 60000,
        "tokensUsed": 0,
        "utilizationPercent": 0
      }
    ]
  },
  "cycle": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Sprint 1",
    "budget": { "tokenBudget": 200000 },
    "bets": [
      {
        "id": "a87ff679-a2f3-401c-85e3-d89b5428c1de",
        "description": "Implement OAuth2 login flow",
        "appetite": 30,
        "outcome": "pending",
        "issueRefs": [],
        "kata": { "type": "named", "pattern": "full-feature" }
      }
    ],
    "pipelineMappings": [],
    "state": "planning",
    "cooldownReserve": 10,
    "createdAt": "2026-02-25T09:00:00Z",
    "updatedAt": "2026-02-25T09:10:00Z"
  }
}
```

---

## `kata cycle update-bet <bet-id>`

Update the kata assignment for an existing bet (before the cycle starts).

**Required**: `<bet-id>` — UUID of a bet in any `planning` cycle

**Required flags** (one of):
- `--kata <name>` — named kata pattern
- `--gyo <stages>` — ad-hoc stage list, comma-separated

**Example**:
```bash
kata cycle update-bet "$BET_ID" --kata full-feature --json
kata cycle update-bet "$BET_ID" --gyo "research,build" --json
```

**`--json` output**: Same shape as `kata cycle add-bet --json` (full `{ status, cycle }` object).

---

## `kata cycle start <cycle-id>`

Start a planning cycle. Validates that all bets have kata assignments, then creates a run tree for each bet.

**Required**: `<cycle-id>` — UUID of a cycle in `planning` state

**`--json` output**:
```json
{
  "cycleId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "runs": [
    {
      "runId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "betId": "a87ff679-a2f3-401c-85e3-d89b5428c1de",
      "betPrompt": "Implement OAuth2 login flow",
      "kataPattern": "full-feature",
      "stageSequence": ["research", "plan", "build", "review"],
      "runDir": "/absolute/path/to/.kata/runs/7c9e6679-7425-40de-944b-e07fc1f90ae7"
    }
  ]
}
```

**Errors**:
- Cycle already active → error
- Bet missing kata assignment → error listing which bets are unassigned
- Named kata pattern file not found → error

---

## `kata run status <run-id>`

Get the full aggregated status of a run.

**Required**: `<run-id>` — UUID of an existing run

**`--json` output**:
```json
{
  "run": {
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
  },
  "stages": [
    {
      "category": "research",
      "status": "completed",
      "executionMode": "parallel",
      "selectedFlavors": ["web-standards", "existing-auth"],
      "gaps": [],
      "decisionCount": 2,
      "avgConfidence": 0.88,
      "artifactCount": 3,
      "flavors": [
        {
          "name": "web-standards",
          "status": "completed",
          "stepCount": 2,
          "completedSteps": 2,
          "currentStep": null,
          "artifactCount": 2
        }
      ],
      "hasSynthesis": true
    }
  ],
  "totalDecisions": 4,
  "totalArtifacts": 6,
  "decisions": [
    {
      "id": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
      "stageCategory": "research",
      "flavor": "web-standards",
      "step": "scan",
      "decisionType": "flavor-selection",
      "context": { "stageName": "research", "betPrompt": "..." },
      "options": ["web-standards", "existing-auth"],
      "selection": "web-standards",
      "reasoning": "Need to understand OAuth2 spec first",
      "confidence": 0.92,
      "decidedAt": "2026-02-25T10:05:00Z",
      "outcome": {
        "decisionId": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
        "outcome": "good",
        "notes": "Good choice — standards review surfaced key constraints",
        "updatedAt": "2026-02-25T11:00:00Z"
      }
    }
  ]
}
```

---

## `kata step next <run-id>`

Get the next step to execute for a run. Call this to know what to work on next.

**Required**: `<run-id>` — UUID of a running run

**`--json` output — three shapes**:

### Shape 1: Active step available
```json
{
  "runId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "stage": "build",
  "flavor": "rust-compilation",
  "step": "compile",
  "prompt": "Compile the Rust project and ensure all tests pass...",
  "resources": {
    "tools": ["Bash", "Read", "Write"],
    "agents": [],
    "skills": []
  },
  "gates": {
    "entry": [
      {
        "type": "entry",
        "conditions": [{ "type": "predecessor-complete" }],
        "required": true
      }
    ],
    "exit": [
      {
        "type": "exit",
        "conditions": [{ "type": "artifact-exists", "artifactName": "build-output" }],
        "required": true
      }
    ]
  },
  "priorArtifacts": [
    {
      "id": "artifact-uuid",
      "stageCategory": "build",
      "flavor": "rust-compilation",
      "step": "prepare",
      "fileName": "Cargo.lock",
      "filePath": "stages/build/flavors/rust-compilation/artifacts/Cargo.lock",
      "summary": "Lock file after dependency resolution",
      "type": "artifact",
      "recordedAt": "2026-02-25T10:30:00Z"
    }
  ],
  "betPrompt": "Implement OAuth2 login flow",
  "priorStageSyntheses": [
    {
      "stage": "research",
      "filePath": "/absolute/path/to/.kata/runs/.../stages/research/synthesis.md"
    }
  ]
}
```

### Shape 2: Gate blocking
```json
{
  "status": "waiting",
  "gate": {
    "gateId": "confidence-3b07e7d4",
    "gateType": "confidence-gate",
    "requiredBy": "rust-compilation"
  },
  "message": "Gate \"confidence-3b07e7d4\" requires approval (confidence-gate). Run \"kata approve\" to unblock."
}
```

### Shape 3: Run complete / no flavors
```json
{ "status": "complete" }
```
or
```json
{ "status": "waiting", "message": "No flavors selected yet. Orchestrator needs to select flavors for this stage." }
```

---

## `kata artifact record <run-id>`

Record an artifact file produced during a kata run.

**Required flags**:
- `--stage <category>` — one of: `research`, `plan`, `build`, `review`
- `--flavor <name>` — the flavor that produced the artifact
- `--file <path>` — absolute or relative path to the source file (must exist)
- `--summary <text>` — short description of what the artifact contains

**Optional flags**:
- `--step <name>` — step that produced it (required for `--type artifact`)
- `--type <type>` — `artifact` (default) or `synthesis`

**Example**:
```bash
kata artifact record "$RUN_ID" \
  --stage build \
  --flavor rust-compilation \
  --step compile \
  --file /tmp/build-report.md \
  --summary "Cargo build output: 0 errors, 2 warnings" --json
```

**`--json` output**:
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

---

## `kata decision record <run-id>`

Record an orchestration decision for observability and self-improvement.

**Required flags**:
- `--stage <category>` — stage where the decision was made
- `--type <decision-type>` — known types: `flavor-selection`, `execution-mode`, `synthesis-approach`, `retry`, `confidence-gate`, `capability-analysis`, `gap-assessment`; unknown types are accepted with a warning
- `--context <json>` — JSON object with contextual snapshot at decision time
- `--options <json>` — JSON array of strings (the options considered)
- `--selected <option>` — the chosen option (must be in `--options` unless options is `[]`)
- `--confidence <0-1>` — confidence in the choice; below threshold (default 0.7) creates a confidence gate
- `--reasoning <text>` — why this option was chosen

**Optional flags**:
- `--flavor <name>` — flavor context (omit for stage-level decisions)
- `--step <name>` — step context (omit for flavor/stage-level decisions)
- `--yolo` — bypass confidence gate even if confidence < threshold

**Example**:
```bash
kata decision record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --type flavor-selection \
  --context '{"availableFlavors":["web-standards","internal-docs"],"betKeywords":["oauth","login"]}' \
  --options '["web-standards","internal-docs"]' \
  --selected web-standards \
  --confidence 0.9 \
  --reasoning "Bet mentions OAuth2 specifically; web-standards covers the RFC" --json
```

**`--json` output**:
```json
{
  "id": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
  "stageCategory": "research",
  "flavor": "web-standards",
  "decisionType": "flavor-selection",
  "context": { "availableFlavors": ["web-standards", "internal-docs"], "betKeywords": ["oauth", "login"] },
  "options": ["web-standards", "internal-docs"],
  "selection": "web-standards",
  "reasoning": "Bet mentions OAuth2 specifically; web-standards covers the RFC",
  "confidence": 0.9,
  "decidedAt": "2026-02-25T10:05:00Z"
}
```

When confidence is low and a gate is created, output includes:
```json
{
  ...decision fields...,
  "lowConfidence": true,
  "lowConfidenceGateCreated": true
}
```

When `--yolo` bypasses the gate:
```json
{
  ...decision fields...,
  "lowConfidence": true,
  "lowConfidenceYolo": true
}
```

---

## `kata approve [gate-id]`

Approve a pending gate.

**Optional args**:
- `[gate-id]` — specific gate ID; omit to get interactive selector
- `--run <run-id>` — scope search to a specific run
- `--agent` — mark approval as agent (default: human)

**Example**:
```bash
kata approve confidence-3b07e7d4 --json
kata approve --run "$RUN_ID" --json    # approve all pending in a run
```

**`--json` output** (array of approved gates):
```json
[
  {
    "gateId": "confidence-3b07e7d4",
    "gateType": "confidence-gate",
    "approvedAt": "2026-02-25T11:00:00Z",
    "approver": "human",
    "runId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "stage": "research"
  }
]
```

Empty array `[]` if no pending gates.

---

## `kata decision update <run-id> <decision-id>`

Record a post-facto outcome for a decision (used during cooldown or after observing results).

**Required flags**:
- `--outcome <value>` — one of: `good`, `partial`, `poor`, `unknown`

**Optional flags**:
- `--notes <text>` — free-text observations
- `--user-overrides <json>` — JSON string of any changes the user made

**Example**:
```bash
kata decision update "$RUN_ID" "$DECISION_ID" \
  --outcome good \
  --notes "web-standards research uncovered the critical token expiry constraint" --json
```

**`--json` output**:
```json
{
  "decisionId": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
  "outcome": "good",
  "notes": "web-standards research uncovered the critical token expiry constraint",
  "updatedAt": "2026-02-25T14:00:00Z"
}
```

---

## `kata step complete <run-id>`

Mark a step as completed within a flavor, advancing run state. Idempotent — re-running for an already-completed step is a no-op.

**Required flags**:
- `--stage <category>` — stage category (`research`, `plan`, `build`, `review`)
- `--flavor <name>` — flavor directory name (matches an entry in `selectedFlavors`)
- `--step <type>` — step type to mark as completed

**Example**:
```bash
kata step complete "$RUN_ID" \
  --stage plan --flavor shaping --step shaping --json
```

**`--json` output**:
```json
{
  "stage": "plan",
  "flavor": "shaping",
  "step": "shaping",
  "status": "completed"
}
```

The flavor's overall `status` is automatically set to `completed` when all steps in it are done, or stays `running` if sibling steps remain pending.

---

## `kata stage complete <run-id>`

Mark a stage as completed, optionally copy a synthesis file, and advance the run to the next stage. When called on the last stage, the run itself is marked `completed`.

**Required flags**:
- `--stage <category>` — stage category to complete (`research`, `plan`, `build`, `review`)

**Optional flags**:
- `--synthesis <file-path>` — path to synthesis file to copy into `.kata/runs/<id>/stages/<cat>/synthesis.md`

**Example**:
```bash
kata stage complete "$RUN_ID" \
  --stage plan --synthesis /tmp/plan-synthesis.md --json
```

**`--json` output** (mid-run):
```json
{
  "stage": "plan",
  "status": "completed",
  "nextStage": "build"
}
```

**`--json` output** (last stage):
```json
{
  "stage": "build",
  "status": "completed",
  "nextStage": null
}
```

**Errors**:
- Stage not part of this run's `stageSequence` → error; run state is not mutated
- Synthesis source file not found → error; stage is NOT marked completed

---

## `kata gate set <run-id>`

Set a pending gate on a running stage, blocking `kata step next` from advancing until the gate is approved with `kata approve <gate-id>`.

**Required flags**:
- `--stage <category>` — stage category to gate (`research`, `plan`, `build`, `review`)
- `--gate-id <id>` — gate identifier passed to `kata approve` (e.g., `human-approved-plan-review`)

**Optional flags**:
- `--type <gate-type>` — gate type descriptor (default: `human-approved`)

**Example**:
```bash
kata gate set "$RUN_ID" \
  --stage build --gate-id human-approved-plan-review --json
```

**`--json` output**:
```json
{
  "gateId": "human-approved-plan-review",
  "gateType": "human-approved",
  "stage": "build",
  "runId": "cc851338-..."
}
```

**Errors**:
- Stage not in this run's `stageSequence` → error
- Stage not initialized → error
- Stage not `running` → error (must be running before a gate can be set)
- Pending gate already set → error; run `kata approve <existing-gate-id>` first
- Gate ID already in `approvedGates` → warns but allows (sets the gate again)
