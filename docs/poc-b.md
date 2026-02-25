# POC-B Findings — Wave B Session 2

> **Date**: 2026-02-25
> **Issue**: #117 (Wave B Session 2 — POC execution + skill package iteration)
> **Scenario**: "Add JWT authentication to the Express API — login endpoint, token issuance, protected route middleware"
> **Kata**: `plan + build` (ad-hoc `--gyo plan,build`)
> **Run ID**: `cc851338-a9d1-492f-8c45-a5daba717026`

---

## Setup

Fresh `kata init` in `/tmp/kata-poc-b`. Verified `.kata/skill/` contains all 9 skill files from PR #118.

```bash
kata cycle new --skip-prompts --budget 200000 --name "POC-B Sprint"
kata cycle add-bet <cycle-id> "Add JWT authentication to the Express API..." --gyo plan,build --appetite 40
kata cycle start <cycle-id>
# → Run ID: cc851338-a9d1-492f-8c45-a5daba717026
```

---

## What Worked

| Operation | Result |
|-----------|--------|
| `kata init` — skill package copy | ✅ All 9 files copied to `.kata/skill/` |
| `kata cycle new/add-bet/start` | ✅ Cycle + run created correctly |
| `kata step next` — no flavors state | ✅ Returns `{ status: "waiting", message: "No flavors selected..." }` |
| `kata decision record` | ✅ Decision appended to `decisions.jsonl`; confidence gate logic works |
| `kata step next` — with step types in `selectedFlavors` | ✅ Returns correct step info after workaround |
| `kata artifact record` | ✅ File copied, `artifact-index.jsonl` updated |
| `kata step next` — pending gate | ✅ Returns `{ status: "waiting", gate: {...} }` correctly |
| `kata approve <gate-id>` | ✅ Gate cleared, recorded in `approvedGates` |
| `kata run status --json` | ✅ Full aggregated view of completed run |

---

## What the Agent Got Wrong (Without Skill Updates)

### Deviation 1: Used flavor NAME in `selectedFlavors` → instant false completion

**What happened**: Agent followed `orchestration.md`'s instruction to "update stage state with selected flavors" and put the flavor name (`api-design`) in `selectedFlavors`. Called `kata step next`. Got:

```json
{ "status": "complete", "message": "All steps in active flavor are complete" }
```

**Why**: `kata step next` uses `registry.list({ type: activeFlavor })` to find steps. When `activeFlavor = "api-design"` (a flavor name), no step is found → returns "complete" immediately.

**Root cause**: The CLI's step resolution uses `selectedFlavors` entries as **step types** in the registry, not as flavor names.

**Skill fix**: Updated `orchestration.md` — "Handling 'No Flavors Selected'" section now explains:
1. Read the flavor JSON file to get step types
2. Write **step types** (not flavor name) to `selectedFlavors`
3. Decision records use the flavor name; `selectedFlavors` uses step types

---

### Deviation 2: No way to advance past a step — infinite loop

**What happened**: After recording an artifact for the `shaping` step, calling `kata step next` again returned the same `shaping` step. The step never advanced.

**Why**: `kata artifact record` does NOT create `FlavorState` JSON or mark steps complete. `kata step next` checks `readFlavorState(..., { allowMissing: true })` — gets `undefined` — falls back to first step from registry → same step every time.

**Root cause**: No `kata step complete` command. `FlavorState` JSON must be written manually to advance steps.

**Skill fix**: Updated `orchestration.md` with "Step 4: Advance through steps" — explains the manual `FlavorState` write workaround. New issue #120 filed for `kata step complete` CLI command.

---

### Deviation 3: Stage advancement has no CLI commands

**What happened**: After all steps in the plan stage completed, `kata step next` returned `{ "status": "complete", "message": "All flavors in this stage are complete" }`. No CLI command existed to:
- Mark the stage as completed
- Write the stage synthesis artifact path to stage state
- Advance `run.json` `currentStage` to `build`

**Root cause**: These operations require direct file writes. The CLI has no `kata stage complete` or equivalent.

**Skill fix**: Updated `orchestration.md` "Advancing the Run Between Stages" section with the exact file-write pattern. New issue #121 filed for `kata stage complete` CLI command.

---

### Deviation 4: No CLI command to set a human-approval gate

**What happened**: The scenario required a human-approval gate at plan→build boundary. There is no CLI command to set this gate. Agent would need to write directly to `stages/build/state.json`.

**Root cause**: No `kata gate set` or equivalent CLI command.

**Skill fix**: Updated `orchestration.md` "Plan→Build boundary gate" section with the direct-write pattern. New issue #122 filed.

---

### Deviation 5: Flavor file naming convention undocumented

**What happened**: Agent browsed `.kata/flavors/` and found files named `plan.api-design.json`, not `api-design.json`. The original skill file said "browse `.kata/flavors/*.json`" without mentioning the dot-notation convention.

**Skill fix**: Updated `file-structure.md` directory tree + added note about `<stage>.<name>.json` naming convention.

---

### Deviation 6: Prompt templates don't load — agent gets short description only

**What happened**: `kata step next` returned the step's `description` field ("Define requirements, solution shapes...") instead of the full prompt template from `shape.md`. The template path `"../prompts/shape.md"` is relative to `.kata/stages/`, but `step.ts` resolves it relative to `.kata/` — wrong directory.

**Why**: `resolve(ctx.kataDir, stepDef.promptTemplate)` with `kataDir = ".kata/"` and `promptTemplate = "../prompts/shape.md"` resolves to `.../prompts/shape.md` (project root) not `.kata/prompts/shape.md`.

**CLI bug**: New issue #123 filed for `kata step next` prompt path resolution. The fix is to use `stagesDir` as the resolve base, not `kataDir`.

---

## Skill File Changes Summary

| File | Change |
|------|--------|
| `orchestration.md` | **Full rewrite** — added flavor file naming convention, step-type vs flavor-name distinction, `selectedFlavors` with step types, FlavorState write workaround, stage advancement section, gate placement |
| `file-structure.md` | Updated directory tree with dot-notation naming, added FlavorState write note, updated CLI vs file write table |
| `skill.md` | Added "Known CLI Limitations" section listing all write operations that require direct file writes |

---

## New Issues Filed

| Issue | Description |
|-------|-------------|
| #120 | `kata step complete` command — mark a step as completed without manual FlavorState write |
| #121 | `kata stage complete` / stage advancement CLI — advance stage and run state |
| #122 | `kata gate set` command — set human-approval gate on a stage from CLI |
| #123 | Bug: `kata step next` prompt template path resolution — uses `kataDir` instead of `stagesDir` |

---

## Assessment Against Success Criterion

> **Target**: Agent completes the full kata with **zero user corrections** beyond the designated human gate approval.

**Result**: ❌ Not achievable with current CLI — 4 structural gaps require direct file writes that are not described in the original skill files.

**With updated skill files**: The agent CAN complete the kata by following the new `orchestration.md` workarounds (step 4, stage advancement, gate placement). Each workaround involves direct `node -e` writes to state JSON files. This is not ideal but is the only path until Wave C ships.

**Corrections required (even with updated skill files)**:
1. Set `selectedFlavors` with step types (not flavor name) — covered by skill, but requires reading flavor JSON first
2. Write FlavorState JSON after each step — covered by skill
3. Advance stage state + run.json after each stage — covered by skill
4. Set human-approval gate manually — covered by skill

These are 4 deliberate write operations. An agent with the updated skill files can complete them without user corrections, but needs to follow the workaround patterns exactly.

---

## Final Run Status (`kata run status --json`)

```json
{
  "run": {
    "id": "cc851338-a9d1-492f-8c45-a5daba717026",
    "cycleId": "45968cd8-4948-4836-8628-9d96f2a6321d",
    "betId": "c95eb8cd-6cde-4cc4-b608-79103b1f0ac0",
    "betPrompt": "Add JWT authentication to the Express API — login endpoint, token issuance, protected route middleware",
    "stageSequence": ["plan", "build"],
    "currentStage": "build",
    "status": "completed",
    "startedAt": "2026-02-25T16:46:55.784Z",
    "completedAt": "2026-02-25T16:52:10.000Z"
  },
  "stages": [
    {
      "category": "plan",
      "status": "completed",
      "selectedFlavors": ["shaping", "impl-planning"],
      "gaps": [],
      "decisionCount": 1,
      "avgConfidence": 0.9,
      "artifactCount": 2,
      "flavors": [
        { "name": "shaping", "status": "completed", "stepCount": 1, "completedSteps": 1, "artifactCount": 1 },
        { "name": "impl-planning", "status": "completed", "stepCount": 1, "completedSteps": 1, "artifactCount": 1 }
      ],
      "hasSynthesis": true
    },
    {
      "category": "build",
      "status": "completed",
      "selectedFlavors": ["implementation-ts", "test-execution"],
      "gaps": [],
      "decisionCount": 1,
      "avgConfidence": 0.92,
      "artifactCount": 2,
      "flavors": [
        { "name": "implementation-ts", "status": "completed", "stepCount": 1, "completedSteps": 1, "artifactCount": 1 },
        { "name": "test-execution", "status": "completed", "stepCount": 1, "completedSteps": 1, "artifactCount": 1 }
      ],
      "hasSynthesis": true
    }
  ],
  "totalDecisions": 2,
  "totalArtifacts": 4,
  "decisions": [
    {
      "id": "65202d9c-af36-46c2-97ba-d8149c74cfa4",
      "stageCategory": "plan",
      "decisionType": "flavor-selection",
      "selection": "api-design",
      "confidence": 0.9,
      "reasoning": "JWT auth needs API contract design and implementation planning. api-design flavor covers both shaping and impl-planning."
    },
    {
      "id": "77c59864-ebee-46aa-8bfd-39dda710d182",
      "stageCategory": "build",
      "decisionType": "flavor-selection",
      "selection": "typescript-feature",
      "confidence": 0.92,
      "reasoning": "Express API uses TypeScript, typescript-feature flavor provides typed implementation + test steps."
    }
  ]
}
```

**Verification checklist**:
- [x] `run.status = "completed"`
- [x] Both stages completed (`plan`, `build`)
- [x] Artifact index has 4 entries (2 per stage)
- [x] Decision log has 2 decisions (one per stage)
- [x] Gate `human-approved-plan-review` approved (in `build.approvedGates`)
- [x] Both syntheses exist on disk (`stages/plan/synthesis.md`, `stages/build/synthesis.md`)
- [x] `hasSynthesis: true` for both stages
