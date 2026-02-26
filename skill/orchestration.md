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

### Step 4: Mark step complete

After completing a step's work and recording its artifact, mark it complete with:

```bash
kata step complete "$RUN_ID" \
  --stage plan \
  --flavor shaping \
  --step shaping
```

`kata step next` will then advance to the next step type in `selectedFlavors`.

- If the flavor has more pending steps, the flavor stays `running`.
- If all steps in the flavor are done, the flavor is automatically marked `completed`.

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
# 8. kata step complete $RUN_ID --stage plan --flavor shaping --step shaping
# 9. kata step next → returns impl-planning step
# 10. Do implementation planning, write artifact file
# 11. kata artifact record --flavor impl-planning --step impl-planning --file /tmp/plan.md ...
# 12. kata step complete $RUN_ID --stage plan --flavor impl-planning --step impl-planning
# 13. kata step next → "All flavors in this stage are complete"
# 14. Write stage synthesis to /tmp/plan-synthesis.md
# 15. kata stage complete $RUN_ID --stage plan --synthesis /tmp/plan-synthesis.md
#     (copies synthesis, marks stage completed, advances run.json currentStage to build)
# 16. [If human gate required] kata gate set $RUN_ID --stage build --gate-id human-approved-plan-review
# 17. kata step next → returns gate (status: "waiting") — surface to user and pause
# 18. [User runs: kata approve human-approved-plan-review]
# 19. kata step next → proceeds to build stage
```

### Plan→Build boundary gate (human approval)

Before starting the build stage, set a human-approval gate:

```bash
kata gate set "$RUN_ID" --stage build --gate-id human-approved-plan-review
# kata step next will now return status: "waiting" with the gate
```

Surface to user: "Gate `human-approved-plan-review` requires human approval. Run `kata approve human-approved-plan-review` when ready."

The user runs:
```bash
kata approve human-approved-plan-review
```

### Build stage — `typescript-feature` flavor (2 steps: implementation-ts → test-execution)

Same pattern: read `.kata/flavors/build.typescript-feature.json`, extract step types `["implementation-ts", "test-execution"]`, write to `selectedFlavors`, advance through steps with `kata step complete`.

```
# 1–12. (same flavor execution pattern as plan stage)
# 13. kata step next → "All flavors in this stage are complete"
# 14. Write build synthesis to /tmp/build-synthesis.md
# 15. kata stage complete $RUN_ID --stage build --synthesis /tmp/build-synthesis.md
#     (build is the LAST stage — marks run.status = "completed" automatically)
```

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

## Resources in `kata step next` Output

`kata step next --json` includes a `resources` field containing the merged union of:

1. **Step-level resources** — tools, agents, and skills declared on the step definition
2. **Flavor-level resources** — additional tools, agents, and skills declared on the flavor itself (available across all steps in that flavor)

Step definitions **win** on name conflicts — if both the step and the flavor declare a resource with the same name, the step's version is used.

```json
{
  "status": "ready",
  "runId": "...",
  "stage": "build",
  "flavor": "typescript-feature",
  "step": "implementation-ts",
  "prompt": "...",
  "resources": {
    "tools": [
      { "name": "tsc", "purpose": "Type checking", "command": "npx tsc --noEmit" },
      { "name": "vitest", "purpose": "Run tests", "command": "npm test" }
    ],
    "agents": [
      { "name": "everything-claude-code:build-error-resolver", "when": "when build fails" }
    ],
    "skills": []
  }
}
```

The executing agent (flavor sub-agent) should consult `resources` to discover available tools, agents, and skills for the current work. If the flavor is not registered, `resources` falls back to the step's own resources.

---

## Orchestration Intelligence

The `BaseStageOrchestrator` runs a 6-phase loop per stage. Three phases are now active and shape flavor selection automatically — agents don't drive these directly, but the outputs are visible in `OrchestratorResult` and `kata decision list`.

### Phase 2 — Match: Rule Effects

Before scoring flavors, the orchestrator loads rules from the `RuleRegistry` for the current stage category. Each rule has:

- **`condition`** — a human-readable string (e.g. `"when bet contains auth keywords"`)
- **`effect`** — `boost`, `penalize`, `require`, or `exclude`
- **`name`** — the flavor it targets
- **`magnitude` × `confidence`** — weighted strength of the effect

Rules fire when significant words from their condition string appear in the bet title, description, tags, stageCategory, or available artifact names. Stop words (`the`, `is`, `for`, etc.) are filtered out.

**Effect semantics:**

| Effect | What happens |
|--------|-------------|
| `boost` | Score += magnitude × confidence (clamped to 1) |
| `penalize` | Score -= magnitude × confidence (clamped to 0) |
| `require` | Flavor is pinned (treated as selected regardless of score) |
| `exclude` | Flavor is removed from candidates — **exclude wins over require** |

When a rule fires, the MatchReport `reasoning` string is annotated with which rule matched and its effect. The `ruleAdjustments` field on MatchReport reflects the net adjustment applied.

### Phase 3 — Plan: Gap Analysis

After flavor selection, the orchestrator checks coverage. It:

1. Builds a coverage set from each selected flavor's name and description words
2. Checks each vocabulary keyword (from `StageVocabulary.keywords`) against the bet context
3. Any keyword present in the bet but **not** covered by a selected flavor → `GapReport`

Each `GapReport` contains:
- `description` — which keyword is uncovered and why it's a gap
- `severity` — `high` / `medium` / `low` based on keyword position in the vocabulary list
- `suggestedFlavors` — unselected flavors whose name or description mentions the keyword

Gaps are surfaced in `OrchestratorResult.gaps`. A `gap-assessment` decision is recorded in the registry (informational — gaps do not block execution). If no vocabulary is configured or all keywords are covered, `gaps` will be empty or absent.

Agents can inspect gaps: if the orchestrator chose flavors that miss a critical bet keyword, a gap report explains it. The `suggestedFlavors` list shows what could have covered it.

### Phase 6 — Reflect: Rule Suggestions

After all flavors complete, the orchestrator analyzes `flavor-selection` decisions from the current stage. For decisions where artifact quality was recorded:

| Quality | Suggestion |
|---------|-----------|
| `good` | Submit `boost` rule suggestion for that flavor |
| `poor` | Submit `penalize` rule suggestion for that flavor |
| `partial` or unset | No suggestion generated |

The suggested rule uses the bet's title/description as the condition context and is submitted via `ruleRegistry.suggestRule()` with `confidence: 0.6`, `magnitude: 0.3`, and `source: 'auto-detected'`. If `suggestRule()` throws, the failure is non-fatal — reflect continues with partial suggestions.

Generated suggestion IDs are returned in `ReflectionResult.ruleSuggestions`. These are pending suggestions in the `RuleRegistry` — they must be reviewed and accepted (e.g., during cooldown) before they influence future runs.

---

## Advancing the Run Between Stages

After completing all steps in a stage, `kata step next` returns `{ "status": "complete", "message": "All flavors in this stage are complete" }`. Use `kata stage complete` to advance:

```bash
# After completing 'plan' stage, advance to 'build':
kata stage complete "$RUN_ID" --stage plan --synthesis /tmp/plan-synthesis.md
# → copies synthesis file, marks stage completed, sets run.currentStage = "build"

# After completing the last stage:
kata stage complete "$RUN_ID" --stage build --synthesis /tmp/build-synthesis.md
# → copies synthesis file, marks stage completed, sets run.status = "completed"
```

`kata stage complete --json` returns `{ stage, status, nextStage }` where `nextStage` is `null` when the run is complete.

---

## Key Rules

1. **One bet, one teammate** — don't try to run multiple bets in a single agent's loop.
2. **Flavor name ≠ step types** — record decisions using the flavor NAME, but put step TYPES in `selectedFlavors`.
3. **Parallel flavors = parallel Task calls** — always spawn flavor sub-agents simultaneously when running in parallel mode.
4. **Gates always block** — never skip a gate or proceed past `status: "waiting"` without user approval.
5. **Sub-agents don't call `kata step next` at the run level** — only the bet teammate does that. Flavor sub-agents work within their assigned flavor.
6. **Record every orchestration decision** — flavor selection, execution mode choice, and gap assessments are all recorded automatically. Reflect phase mines these decisions and generates rule suggestions. This data drives self-improvement during cooldown.
7. **`kata step complete` to advance steps** — after completing a step, run `kata step complete` to mark it done. Flavor status updates automatically.
8. **`kata stage complete` to advance stages** — marks stage done, copies synthesis, and advances `run.currentStage`. Run status becomes `completed` after the last stage.
