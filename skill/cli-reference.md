# Kata CLI Reference — Agent-Facing Commands

> All commands support `--json` for machine-readable output.
> Global flag `--json` must precede the subcommand: `kata --json run status <id>`.

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
    "agentHints": ["use cargo build --release"]
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
  --summary "Cargo build output: 0 errors, 2 warnings"
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
- `--type <decision-type>` — known types: `flavor-selection`, `execution-mode`, `capability-analysis`, `gap-assessment`, `synthesis-approach`, `skip-justification`; unknown types are accepted with a warning
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
  --reasoning "Bet mentions OAuth2 specifically; web-standards covers the RFC"
```

**`--json` output**:
```json
{
  "id": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
  "stageCategory": "research",
  "flavor": "web-standards",
  "step": null,
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
kata approve confidence-3b07e7d4
kata approve --run "$RUN_ID"    # approve all pending in a run
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
  --notes "web-standards research uncovered the critical token expiry constraint"
```

**`--json` output**:
```json
{
  "decisionId": "3b07e7d4-ab84-4b94-8e5c-0a9f0e46cc12",
  "outcome": "good",
  "notes": "web-standards research uncovered the critical token expiry constraint",
  "userOverrides": null,
  "updatedAt": "2026-02-25T14:00:00Z"
}
```
