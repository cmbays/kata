# Kata Orchestration — Mapping to Claude Code

> How Kata methodology concepts map to Claude Code teams and tasks.

---

## Concept Mapping

| Kata Concept | Claude Code Equivalent |
|-------------|----------------------|
| **Bet** | Top-level `Task` call / teammate agent |
| **Stage** | A loop iteration in the bet teammate's execution |
| **Flavor** | A named composition of steps (defined in `.kata/flavors/<stage>.<name>.json`) |
| **Step** | Atomic work unit within a flavor; stored as `<type>.json` in `.kata/stages/` |
| **Parallel flavors** | Multiple `Task` calls in one message |
| **Sequential flavors** | Sequential `Task` calls (await each before starting next) |
| **Synthesis** | Bet teammate collects flavor outputs, writes `synthesis.md` |
| **Human gate** | Bet teammate pauses, messages user, waits for `kata approve` |
| **Confidence gate** | Bet teammate surfaces the low-confidence decision to user |
| **Step execution** | Flavor sub-agent reads prompt from `kata step next --json`, does the work |
| **Artifact recording** | Flavor sub-agent runs `kata artifact record` after completing work |

---

## Agent Hierarchy

```
User
└── Bet Teammate (spawned per bet)
    ├── Calls kata cycle start, kata step next
    ├── Handles gates (pauses on human-gate, surfaces confidence-gate)
    ├── Spawns Flavor Sub-Agents in parallel for each selected flavor
    │   └── Flavor Sub-Agent
    │       ├── Reads step prompts from kata step next --json
    │       ├── Does the actual work (editing code, running tests, etc.)
    │       ├── Records artifacts via kata artifact record
    │       └── Records decisions via kata decision record
    └── Writes stage synthesis after all flavors complete
```

---

## Handling "No Flavors Selected"

When `kata step next --json` returns `{ "status": "waiting", "message": "No flavors selected yet..." }`:

### Step 1: Browse available flavors

Flavor files use **dot-notation naming**: `<stage>.<flavor-name>.json`.

```bash
ls .kata/flavors/         # e.g.: plan.api-design.json, build.typescript-feature.json
cat .kata/flavors/plan.api-design.json
```

Example flavor file:
```json
{
  "name": "api-design",
  "stageCategory": "plan",
  "steps": [
    { "stepName": "shape", "stepType": "shaping" },
    { "stepName": "plan", "stepType": "impl-planning" }
  ]
}
```

### Step 2: Record your flavor-selection decision

Record the decision using the flavor's **name** (e.g., `api-design`):

```bash
kata decision record "$RUN_ID" \
  --stage plan \
  --type flavor-selection \
  --context '{"availableFlavors":["api-design","standard-plan"],"betKeywords":["jwt","auth"]}' \
  --options '["api-design","standard-plan"]' \
  --selected api-design \
  --confidence 0.88 \
  --reasoning "JWT auth needs API contract design and implementation planning."
```

### Step 3: Extract step types and set selectedFlavors

**CRITICAL**: `kata step next` resolves steps by looking up each entry in `selectedFlavors` as a **step type** in `.kata/stages/`. You must put **step types** (from the flavor's `steps[].stepType` field), **not the flavor name**, into `selectedFlavors`.

Read the flavor JSON to get its step types, then write them to stage state:

```bash
# Read step types from flavor JSON
STEP_TYPES=$(cat .kata/flavors/plan.api-design.json | node -e \
  "const d=require('fs').readFileSync('/dev/stdin','utf8');
   const f=JSON.parse(d);
   console.log(f.steps.map(s=>s.stepType).join(','))")
# STEP_TYPES = "shaping,impl-planning"

# Write to stage state
RUN_STATE=".kata/runs/$RUN_ID/stages/plan/state.json"
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('$RUN_STATE', 'utf8'));
state.selectedFlavors = ['shaping', 'impl-planning'];
state.status = 'running';
fs.writeFileSync('$RUN_STATE', JSON.stringify(state, null, 2));
"
```

### Step 4: Advance through steps (workaround for current CLI limitation)

After completing a step's work and recording its artifact, `kata step next` will return the **same step** again because there is no CLI command to mark a step complete. Use this workaround to advance:

```bash
# After completing the 'shaping' step and recording its artifact:
FLAVOR_STATE=".kata/runs/$RUN_ID/stages/plan/flavors/shaping/state.json"
mkdir -p "$(dirname $FLAVOR_STATE)"
cat > "$FLAVOR_STATE" << 'EOF'
{
  "name": "shaping",
  "stageCategory": "plan",
  "status": "completed",
  "steps": [
    {
      "type": "shaping",
      "status": "completed",
      "artifacts": [],
      "startedAt": "<ISO timestamp>",
      "completedAt": "<ISO timestamp>"
    }
  ],
  "currentStep": null
}
EOF
```

After writing this file, `kata step next` will advance to the next step type in `selectedFlavors`.

> **Why**: The CLI does not yet have a `kata step complete` command. This is a known structural gap tracked in issue #120. The `selectedFlavors` and `FlavorState` mechanism is the current workaround.

### Step 5: Call `kata step next` again

`kata step next` will now return the next step type.

---

## Concrete Example: `plan + build` Kata

**Setup**: Bet "Add JWT auth to Express API" with `--gyo plan,build`.

### Plan stage — `api-design` flavor (2 steps: shaping → impl-planning)

```
# 1. kata step next → "No flavors selected"
# 2. Browse .kata/flavors/plan.api-design.json
# 3. Record decision: --selected api-design
# 4. Write selectedFlavors: ["shaping", "impl-planning"] to stage state
# 5. kata step next → returns shaping step
# 6. Do shaping work, write artifact file
# 7. kata artifact record --flavor shaping --step shaping --file /tmp/shape.md ...
# 8. Write FlavorState for shaping (status: completed) — see Step 4 above
# 9. kata step next → returns impl-planning step
# 10. Do implementation planning, write artifact file
# 11. kata artifact record --flavor impl-planning --step impl-planning --file /tmp/plan.md ...
# 12. Write FlavorState for impl-planning (status: completed)
# 13. kata step next → "All flavors in this stage are complete"
# 14. Write stage synthesis to .kata/runs/$RUN_ID/stages/plan/synthesis.md (direct file write)
# 15. Update stage state: status=completed, synthesisArtifact=stages/plan/synthesis.md
# 16. Update run.json: currentStage=build (direct file write)
```

### Plan→Build boundary gate (human approval)

Before starting the build stage, set a human-approval gate:

```bash
RUN_STATE=".kata/runs/$RUN_ID/stages/build/state.json"
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('$RUN_STATE', 'utf8'));
state.pendingGate = {
  gateId: 'human-approved-plan-review',
  gateType: 'human-approved',
  requiredBy: 'stage'
};
fs.writeFileSync('$RUN_STATE', JSON.stringify(state, null, 2));
"
# kata step next will now return status: "waiting" with the gate
```

Surface to user: "Gate `human-approved-plan-review` requires human approval. Run `kata approve human-approved-plan-review` when ready."

The user runs:
```bash
kata approve human-approved-plan-review
```

### Build stage — `typescript-feature` flavor (2 steps: implementation-ts → test-execution)

Same pattern: read `.kata/flavors/build.typescript-feature.json`, extract step types `["implementation-ts", "test-execution"]`, write to `selectedFlavors`, advance through steps with FlavorState writes.

---

## Handling a Human Gate (Automatic)

When `kata step next` returns a pending gate:
```json
{
  "status": "waiting",
  "gate": {
    "gateId": "human-approved-plan-review",
    "gateType": "human-approved",
    "requiredBy": "stage"
  }
}
```

The bet teammate **messages the user**:
> "Gate `human-approved-plan-review` requires human approval. Run `kata approve human-approved-plan-review` to unblock."

Then **pauses** — does not call `kata step next` again until approval confirmation.

---

## Advancing the Run Between Stages

After completing all steps in a stage, `kata step next` returns `{ "status": "complete", "message": "All flavors in this stage are complete" }`. To advance to the next stage:

1. Write stage synthesis to `<runDir>/stages/<category>/synthesis.md`
2. Update stage state: `status = "completed"`, `synthesisArtifact = "stages/<category>/synthesis.md"`
3. Update `run.json`: `currentStage = <next-stage>`

```bash
# After completing 'plan' stage, advance to 'build':
node -e "
const fs = require('fs');
const state = JSON.parse(fs.readFileSync('.kata/runs/$RUN_ID/stages/plan/state.json', 'utf8'));
state.status = 'completed';
state.synthesisArtifact = 'stages/plan/synthesis.md';
fs.writeFileSync('.kata/runs/$RUN_ID/stages/plan/state.json', JSON.stringify(state, null, 2));

const run = JSON.parse(fs.readFileSync('.kata/runs/$RUN_ID/run.json', 'utf8'));
run.currentStage = 'build';
fs.writeFileSync('.kata/runs/$RUN_ID/run.json', JSON.stringify(run, null, 2));
"
```

After all stages are done:
```bash
node -e "
const fs = require('fs');
const run = JSON.parse(fs.readFileSync('.kata/runs/$RUN_ID/run.json', 'utf8'));
run.status = 'completed';
run.completedAt = new Date().toISOString();
fs.writeFileSync('.kata/runs/$RUN_ID/run.json', JSON.stringify(run, null, 2));
"
```

---

## Key Rules

1. **One bet, one teammate** — don't try to run multiple bets in a single agent's loop.
2. **Flavor name ≠ step types** — record decisions using the flavor NAME, but put step TYPES in `selectedFlavors`.
3. **Parallel flavors = parallel Task calls** — always spawn flavor sub-agents simultaneously when running in parallel mode.
4. **Gates always block** — never skip a gate or proceed past `status: "waiting"` without user approval.
5. **Sub-agents don't call `kata step next` at the run level** — only the bet teammate does that. Flavor sub-agents work within their assigned flavor.
6. **Record every orchestration decision** — flavor selection, execution mode choice, gap assessments. This data drives self-improvement during cooldown.
7. **Step advancement requires FlavorState write** — after completing a step, write the FlavorState JSON with `status: "completed"` to advance. See Step 4 above.
8. **Stage advancement requires direct file writes** — update stage state, write synthesis, update run.json. The CLI has no commands for these operations yet.
