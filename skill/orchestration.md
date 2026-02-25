# Kata Orchestration — Mapping to Claude Code

> How Kata methodology concepts map to Claude Code teams and tasks.

---

## Concept Mapping

| Kata Concept | Claude Code Equivalent |
|-------------|----------------------|
| **Bet** | Top-level `Task` call / teammate agent |
| **Stage** | A loop iteration in the bet teammate's execution |
| **Flavor** | Sub-agent spawned via `Task` tool per flavor |
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

## Concrete Example: `plan + build` Kata with 2 Flavors Each

**Setup**: A bet "Add password reset via email" with kata pattern `plan-and-build`.
- Stage sequence: `plan`, `build`
- Plan flavors: `api-design`, `data-model` (parallel)
- Build flavors: `backend-impl`, `frontend-impl` (parallel)

### Step 1: Bet teammate starts the run

```
kata cycle start <cycle-id> --json
# → gets run-id "7c9e-..."
```

### Step 2: Bet teammate calls `kata step next` for plan stage

```
kata step next 7c9e-... --json
# → { status: "waiting", message: "No flavors selected yet..." }
```

The orchestrator (bet teammate) selects flavors. Record the selection decision:

```
kata decision record 7c9e-... \
  --stage plan \
  --type flavor-selection \
  --context '{"availableFlavors":["api-design","data-model","ux-flow"]}' \
  --options '["api-design","data-model","ux-flow"]' \
  --selected api-design \
  --confidence 0.85 \
  --reasoning "Password reset needs both an API endpoint design and a data model"
```

(The bet teammate also needs to update stage state with selected flavors — future Wave C.)

### Step 3: Spawn flavor sub-agents in parallel

Send **one message** with two `Task` tool calls:

```
Task(
  "Execute api-design flavor for run 7c9e-...",
  context={skill condensed, cli-reference, run-id, stage=plan, flavor=api-design, betPrompt=...}
)
Task(
  "Execute data-model flavor for run 7c9e-...",
  context={skill condensed, cli-reference, run-id, stage=plan, flavor=data-model, betPrompt=...}
)
```

### Step 4: Each flavor sub-agent executes steps

**api-design sub-agent**:
1. Reads prompt from step definition for its current step
2. Does the design work (creates `api-spec.md`)
3. Records artifact:
   ```
   kata artifact record 7c9e-... \
     --stage plan --flavor api-design --step design \
     --file /tmp/api-spec.md --summary "REST API spec for password reset"
   ```
4. Reports completion to bet teammate

**data-model sub-agent** works in parallel, doing the same pattern.

### Step 5: Bet teammate does plan synthesis

After both flavor sub-agents report completion:

1. Reads artifacts from both flavors
2. Writes `synthesis.md` combining key findings
3. Records it:
   ```
   kata artifact record 7c9e-... \
     --stage plan --flavor api-design \
     --file /tmp/plan-synthesis.md --summary "Plan synthesis: API + data model" \
     --type synthesis
   ```

### Step 6: Bet teammate advances to build stage

Calls `kata step next 7c9e-... --json` again — now in the `build` stage. Repeats the flavor selection and sub-agent spawning pattern.

### Step 7: Handling a human gate

During build, `kata step next` returns:
```json
{
  "status": "waiting",
  "gate": {
    "gateId": "human-approved-exit-build",
    "gateType": "human-approved",
    "requiredBy": "stage"
  },
  "message": "..."
}
```

The bet teammate **messages the user**:
> "The build stage is complete and ready for human review. Please run `kata approve human-approved-exit-build` when you've reviewed the build artifacts and are ready to proceed to review."

The bet teammate then **pauses** — it does not call `kata step next` again until it receives a message that the gate has been approved.

---

## Key Rules

1. **One bet, one teammate** — don't try to run multiple bets in a single agent's loop.
2. **Parallel flavors = parallel Task calls** — always spawn flavor sub-agents simultaneously when running in parallel mode.
3. **Gates always block** — never skip a gate or proceed past `status: "waiting"` without user approval.
4. **Sub-agents don't call `kata step next` at the run level** — only the bet teammate does that. Flavor sub-agents work within their assigned flavor.
5. **Record every orchestration decision** — flavor selection, execution mode choice, gap assessments. This data drives self-improvement during cooldown.
