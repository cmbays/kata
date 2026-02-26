---
pipeline: 20260225-wave-c-s2
---

# Wave C Session 2 — Breadboard

> **Rev 2** — Updated after multi-agent review. See review findings at end of document.

## Places

| Place | Description |
| ----- | ----------- |
| **FlavorSchema** | Domain type — adds optional `resources` field |
| **ManifestBuilder** | Domain service — gains `aggregateFlavorResources()`, updated `build()` |
| **kata step next** | CLI — returns merged step + flavor resources |
| **BetSchema** | Domain type — gains optional `runId` field |
| **CycleManager** | Domain service — gains `setRunId()` |
| **kata cycle start** | CLI — writes `runId` back to each bet after run creation |
| **RunSummary** | Exported interface in `src/features/cycle-management/types.ts` |
| **CooldownSession** | Feature — gains `runsDir`, `loadRunSummaries()`, enriched `run()` |
| **ProposalGenerator** | Feature — gains `analyzeRunData()`, updated `generate()` |
| **kata cooldown / kata ma** | CLI — passes `runsDir`, displays run summaries |
| **skill/orchestration.md** | Skill file — updated to reflect merged resources in `kata step next` |

---

## Part A1 — Flavor Resources (#105)

### UI Affordances

| Affordance | Where | Notes |
| ---------- | ----- | ----- |
| `kata step next <run-id>` — `resources` field in output | CLI | Now returns merged step + flavor resources, not step-only |
| flavor JSON author adds `resources` block | flavor .json file | New optional field recognized at load time |

### Code Affordances

| Affordance | Signature | Wiring |
| ---------- | --------- | ------ |
| `FlavorSchema.resources?` | `resources: StepResourcesSchema.optional()` | New field on existing Zod object. **Add JSDoc**: "Additive-only flavor-level resources. Step-defined resources take priority on name conflicts. Process with `ManifestBuilder.aggregateFlavorResources()` — do not read this field directly." |
| `ManifestBuilder.aggregateFlavorResources(flavor, stepDefs)` | `(flavor: Flavor, stepDefs: Step[]) => StepResources` | Method on the `ManifestBuilder` object (not a class — no `static` keyword). Iterates `flavor.steps`, unions `stepDef.resources` for each matched `stepDef`; appends `flavor.resources`; deduplicates by `.name` within each array. If a `FlavorStepRef` has no matching `stepDef` in the provided array, skip it (no throw). |
| `ManifestBuilder.build(step, context, learnings?, flavorResources?)` | adds `flavorResources?: StepResources` | **Replace** the existing `if (stage.resources)` block with: merge `step.resources` + `flavorResources` into `effectiveResources` (same dedup-by-name rule); serialize once. Do NOT add a second serialization pass — this risks double-printing step resources. |
| `kata step next` — FlavorRegistry wiring | in `step.ts` `next` action | See detail below |

### `kata step next` FlavorRegistry Wiring (Detail)

`step.ts` currently has no Flavor-domain awareness. Adding merged resources requires these new steps after `stepDef` is resolved:

```
1. Instantiate FlavorRegistry: new FlavorRegistry(flavorsDir) where
   flavorsDir = kataDirPath(ctx.kataDir, 'flavors')

2. Resolve Flavor object: flavorObj = flavorRegistry.get(currentStage, activeFlavor)
   - currentStage is StageCategory (already available)
   - activeFlavor is the string flavor name (already available from stageState)
   - If registry.get() throws (unknown flavor), fall back to stepDef?.resources ?? {}

3. Resolve all step definitions for this flavor: for each ref in flavorObj.steps,
   call stepRegistry.get(ref.stepType) — skip (don't throw) if not found

4. Call ManifestBuilder.aggregateFlavorResources(flavorObj, resolvedStepDefs)
   → use result as `resources` in the step-next output (replaces stepDef?.resources ?? {})
```

### Wiring Diagram

```
FlavorSchema.resources (optional) ──────────────────────────────────┐
                                                                     ▼
StepSchema.resources (optional) ──► ManifestBuilder                 │
                                    .aggregateFlavorResources()  ◄───┘
                                         │
                                         ▼  merged + deduped StepResources
                                    kata step next output.resources
                                         │
                                         ▼  (ManifestBuilder.build() flavorResources)
                                    ExecutionManifest prompt
                                    "## Suggested Resources" section (serialized once)
```

### Deduplication Rule

Within each array (`tools`, `agents`, `skills`), deduplicate by `.name`. Step definitions
win (listed first); flavor additions fill in any names not already present. This means:
- A flavor tool with the same `.name` as a step tool is silently dropped (step wins entirely,
  including `.purpose` and `.command`).
- For agents and skills, if a step defines `foo:bar` with `when: "on failure"` and the flavor
  also defines `foo:bar` with `when: "always"`, the step's version is kept. **Document this
  behavior in a code comment** so flavor authors understand why their entry may be absent.

---

## Part A2 — BetSchema.runId + CycleManager.setRunId (#112 schema)

### Code Affordances

| Affordance | Signature | Wiring |
| ---------- | --------- | ------ |
| `BetSchema.runId?` | `runId: z.string().uuid().optional()` | New optional field. **Add JSDoc**: "UUID of the run created for this bet by `kata cycle start`. Absent on bets not yet started or created before Wave C S2. Used by `CooldownSession` to load execution summaries." |
| `CycleManager.setRunId(cycleId, betId, runId)` | `(cycleId: string, betId: string, runId: string) => Cycle` | Finds bet in cycle; sets `bet.runId = runId`; persists via `this.store`. **Idempotency contract**: if `bet.runId` is already set, overwrite it (last call wins — `kata cycle start` is not expected to call this twice for the same bet, but the method should not throw if it does). Throw `KataError` for unknown `cycleId` or unknown `betId`. |
| `kata cycle start` → `setRunId` | in `cycle.ts` start action | After `createRunTree(runsDir, run)`, call `manager.setRunId(cycleId, bet.id, runId)`. If `setRunId` throws for a bet, log a warning and continue (do not abort the whole `cycle start`). |

### Wiring Diagram

```
kata cycle start
  ├── manager.startCycle(cycleId)
  ├── for each bet:
  │     ├── createRunTree(runsDir, run)  →  .kata/runs/<runId>/run.json
  │     └── manager.setRunId(cycleId, bet.id, runId)  →  cycle.json bet.runId = runId
  └── output runs[]
```

### Pre-existing Cycles Note

Bets from cycles started before this change have no `runId`. `loadRunSummaries()` silently
skips bets without `runId` (no `RunSummary` produced, no error). This is a known limitation.
A future migration command could scan `.kata/runs/` and back-fill `runId` via `setRunId()`.

---

## Part A3 — CooldownSession reads run data (#112 core)

### RunSummary Interface

**Location**: `src/features/cycle-management/types.ts` (new file, exported).
Both `CooldownSession` and `ProposalGenerator` import from here.

```typescript
/**
 * Per-bet execution summary assembled from .kata/runs/ data during cooldown.
 * betId and runId are UUIDs. avgConfidence is null when no decisions were recorded.
 */
export interface RunSummary {
  betId: string;           // UUID
  runId: string;           // UUID
  stagesCompleted: number; // count of stages with status 'completed'
  gapCount: number;        // total gap entries across all stage states
  gapsBySeverity: { low: number; medium: number; high: number };
  avgConfidence: number | null; // null = no decisions recorded; number in [0, 1]
  artifactPaths: string[];      // filePath values from run-level artifact-index.jsonl
}
```

**Why `avgConfidence: number | null`**: A bet with zero decisions is in an "unknown" state,
not a "low confidence" state. Defaulting to `0` would generate misleading "low confidence"
proposals for bets that simply didn't record decisions (e.g., early-failed runs).

**Why `gapsBySeverity`**: Allows `analyzeRunData()` to escalate proposal priority to `high`
when a bet has high-severity gaps, rather than treating all gaps as medium.

### Code Affordances

| Affordance | Signature | Wiring |
| ---------- | --------- | ------ |
| `CooldownSessionDeps.runsDir?` | `runsDir?: string` | Optional — existing tests omit; production CLI passes it |
| `CooldownSession.loadRunSummaries(cycle)` | `private (cycle: Cycle) => RunSummary[]` | See wiring detail below |
| `CooldownSessionResult.runSummaries` | `runSummaries: RunSummary[]` | Added to result shape (empty array when no run data available) |
| `CooldownSession.run()` enriched | in `run()` step 5 | Before generating proposals: `const runSummaries = this.deps.runsDir ? this.loadRunSummaries(cycle) : []`; pass to `proposalGenerator.generate(cycleId, runSummaries)` |

### `loadRunSummaries` Wiring Detail

```
loadRunSummaries(cycle):
  for each bet in cycle.bets where bet.runId is defined:
    1. Read run.json via runPaths(runsDir, bet.runId).runJson
       → Get run.stageSequence (source of truth for which stage categories exist)
       → Skip bet entirely if read fails (logger.warn)

    2. For each category in run.stageSequence:
       Read stateJson(category) via runPaths(...)
       → count stages with state.status === 'completed' → stagesCompleted
       → sum state.gaps.length → gapCount total
       → sum by state.gaps[].severity → gapsBySeverity
       → skip category if file missing (graceful — createRunTree creates these, but may fail)

    3. Read decisions.jsonl via JsonlStore.readAll(decisionsJsonl, DecisionEntrySchema)
       → If entries.length === 0: avgConfidence = null
       → Else: avgConfidence = sum(entry.confidence) / entries.length

    4. Read artifact-index.jsonl via JsonlStore.readAll(artifactIndexJsonl, ArtifactIndexEntrySchema)
       → artifactPaths = entries.map(e => e.filePath)

    5. Assemble RunSummary; add to results
```

### Imports Needed in cooldown-session.ts

```typescript
import { runPaths } from '@infra/persistence/run-store.js';
import { JsonlStore } from '@infra/persistence/jsonl-store.js';
import { RunSchema, StageStateSchema, DecisionEntrySchema, ArtifactIndexEntrySchema }
  from '@domain/types/run-state.js';
import type { RunSummary } from './types.js';
```

Note: `@infra` imports are used elsewhere in `features/` (e.g., `init-handler.ts`,
`prompt-updater.ts`) — this follows established project patterns.

### Error Handling

Missing or unreadable run files → `logger.warn` + skip that bet (not a fatal error).
A bet without `runId` → skip silently (no warning needed — expected for pre-migration bets).

---

## Part A4 — ProposalGenerator run data analysis (#112 proposals)

### Code Affordances

| Affordance | Signature | Wiring |
| ---------- | --------- | ------ |
| `CycleProposal.source` extended | adds `'run-gap' \| 'low-confidence'` to union | TypeScript literal union — backward compatible widening |
| `prioritize()` — sourceOrder updated | `{ unfinished: 0, dependency: 1, 'run-gap': 2, unblocked: 3, learning: 4, 'low-confidence': 5 }` | **Must update** — without this, new source types fall back to `?? 3` and sort nondeterministically |
| `ProposalGenerator.generate(cycleId, runSummaries?)` | adds `runSummaries?: RunSummary[]` | Optional param — backward compatible. Calls `analyzeRunData(runSummaries)` when provided; includes results in combined list before `prioritize()` |
| `ProposalGenerator.analyzeRunData(summaries)` | `(summaries: RunSummary[]) => CycleProposal[]` | See trigger table below |
| Import `RunSummary` | in `proposal-generator.ts` | `import type { RunSummary } from './types.js'` |

### Proposal Triggers

| Trigger | Priority | Source | Notes |
| ------- | -------- | ------ | ----- |
| `gapsBySeverity.high > 0` | **high** | `'run-gap'` | Escalate to high when any high-severity gap found |
| `gapCount > 0` (no high gaps) | medium | `'run-gap'` | General gap coverage issue |
| `avgConfidence !== null && avgConfidence < 0.6` | low | `'low-confidence'` | Skip when `avgConfidence` is `null` (no decisions = unknown, not low confidence) |

### Proposal Text Examples

| Trigger | Description | Rationale |
| ------- | ----------- | --------- |
| `gapCount > 0` | `"Address methodology gaps: <bet description>"` | `"<N> gap(s) detected (H:<high>/M:<medium>/L:<low>) — areas not covered by any selected flavor. Consider creating new flavors or expanding vocabulary."` |
| `avgConfidence < 0.6` | `"Review low-confidence decisions: <bet description>"` | `"Average decision confidence was <X>% — below the 60% threshold. Review decisions from this bet before the next cycle."` |

### Wiring Diagram

```
ProposalGenerator.generate(cycleId, runSummaries?)
  ├── analyzeUnfinishedWork(cycle)   →  []CycleProposal (high, 'unfinished')
  ├── analyzeLearnings(cycleId)      →  []CycleProposal (low, 'learning')
  ├── analyzeDependencies(cycle)     →  []CycleProposal (medium, 'dependency')
  └── analyzeRunData(runSummaries)   →  []CycleProposal (high|medium, 'run-gap')
                                                          (low, 'low-confidence')
       └── prioritize([...all])  →  sorted by priority then sourceOrder
```

---

## Part A5 — CLI enrichment (#112 output)

### UI Affordances

| Affordance | Where | Notes |
| ---------- | ----- | ----- |
| `kata cooldown <cycle-id> --json` | CLI | `result.runSummaries` array in JSON output |
| `kata cooldown <cycle-id>` (non-JSON) | CLI | Per-bet table: stages ✓, gaps (H/M/L), confidence % or "no decisions" |

### Code Affordances

| Affordance | Where | Wiring |
| ---------- | ----- | ------ |
| `kata cooldown` passes `runsDir` | `cycle.ts` cooldown action | `runsDir: kataDirPath(ctx.kataDir, 'runs')` in `CooldownSessionDeps` |
| Non-JSON display of run summaries | `cycle.ts` cooldown action | After proposals section, print per-bet run summary table |

### Non-JSON Output Sketch

```
Run summaries:
  ✓ Build a search API
    Stages: 3/4 completed  |  Gaps: 2 (H:1/M:1/L:0)  |  Avg confidence: 72%
    Artifacts: .kata/runs/<id>/stages/build/flavors/api/artifacts/spec.md

  ✓ Auth middleware refactor
    Stages: 4/4 completed  |  Gaps: 0  |  Avg confidence: 88%

  ~ Payments integration
    Stages: 1/3 completed  |  Gaps: 0  |  Avg confidence: no decisions recorded
```

---

## Part A6 — skill/orchestration.md update

### Deliverable

Update `skill/orchestration.md` to reflect that `kata step next --json` output's `resources`
field now contains **merged** step + flavor resources (not step-only).

The skill file is the primary reference agents use for the step execution loop. If it still
describes resources as step-level only, agents will not know flavor-level tool/agent/skill
hints exist.

### Changes needed

- In the `kata step next` output description: note that `resources` includes flavor-level
  additions, deduplicated by name, step definitions taking priority on conflicts.
- No other orchestration behavior changes in this session.

---

## Vertical Slices

### Slice V1 — Flavor resources schema + aggregation (independent, #105)

Deliverable: `FlavorSchema.resources` field + `ManifestBuilder.aggregateFlavorResources()` + tests.

Acceptance: unit tests pass for aggregation, deduplication, registry-miss skip, empty flavor.
`FlavorSchema` parse accepts `resources` field.

### Slice V2 — kata step next wiring + skill update (#105)

Deliverable: `kata step next` returns merged resources via FlavorRegistry lookup.
`skill/orchestration.md` updated. Builds on V1.

Acceptance: `kata step next --json` output's `resources` reflects merged step + flavor.
`skill/orchestration.md` updated paragraph on resources.

### Slice V3 — BetSchema.runId + CycleManager.setRunId (#112 schema)

Deliverable: Schema change + JSDoc + `setRunId()` with idempotency contract + `kata cycle start`
integration + tests. Independent of V1/V2.

Acceptance: `kata cycle start --json` output includes `runId` per run;
`cycle.json` shows `bet.runId` set; `setRunId` tests pass including idempotency case.

### Slice V4 — RunSummary type + CooldownSession run data loading (#112 core)

Deliverable: `src/features/cycle-management/types.ts` with `RunSummary` (`avgConfidence: number | null`,
`gapsBySeverity`) + `loadRunSummaries()` + `CooldownSessionDeps.runsDir` + enriched `run()`.
Depends on V3.

Acceptance: unit tests pass including: bets without `runId` skipped, missing run files
skipped gracefully, `avgConfidence` is `null` when no decisions, `gapsBySeverity` counts correct.

### Slice V5 — ProposalGenerator run data analysis (#112 proposals)

Deliverable: `analyzeRunData()`, extended `generate()`, extended source union, updated
`sourceOrder` in `prioritize()`. Depends on V4 for `RunSummary` type.

Acceptance: unit tests for: gap proposals (medium), high-severity gap escalates to high,
low-confidence proposals, `avgConfidence === null` skipped, `avgConfidence === 0.6` skipped
(boundary — strict `< 0.6`), deduplication with existing sources.

### Slice V6 — CLI output enrichment (#112 output)

Deliverable: `kata cooldown` passes `runsDir`, displays run summaries with severity breakdown
and null-confidence handling. Depends on V4/V5.

Acceptance: `kata cooldown --json` includes `runSummaries`; non-JSON shows per-bet table
including H/M/L gap breakdown and "no decisions recorded" for null confidence.

---

## Implementation Order

```
V1 (FlavorSchema + aggregateFlavorResources + types.ts stub)
  ↓
V2 (kata step next wiring + skill/orchestration.md)     V3 (BetSchema.runId + setRunId)
                                                           ↓
                                                         V4 (RunSummary type + CooldownSession)
                                                           ↓
                                                         V5 (ProposalGenerator analyzeRunData)
                                                           ↓
                                                         V6 (CLI cooldown output)
```

Target: V1+V2 first (closes #105), then V3–V6 (closes #112).

---

## Review Findings Applied (Rev 2)

The following issues were found by a three-agent review (architect, type-design, planner)
and are now incorporated into this breadboard:

| # | Severity | Finding | Resolution |
| - | -------- | ------- | ---------- |
| 1 | HIGH | `sourceOrder` not updated for new source types | Added explicit update in A4 Code Affordances |
| 2 | HIGH | `avgConfidence: 0` conflates no-data with zero-confidence | Changed to `number \| null`; guard added in analyzeRunData trigger |
| 3 | HIGH | `kata step next` FlavorRegistry wiring underspecified | Expanded A1 with step-by-step detail |
| 4 | HIGH | Missing test: `aggregateFlavorResources` with registry miss | Documented skip behavior + added to V1 acceptance |
| 5 | HIGH | `skill/orchestration.md` not in plan | Added as Part A6 and Slice V2 deliverable |
| 6 | MEDIUM | `RunSummary` cross-import (defined in CooldownSession, consumed by ProposalGenerator) | Moved to `src/features/cycle-management/types.ts` |
| 7 | MEDIUM | Missing JSDoc on `FlavorSchema.resources` (additive-only semantics) | Added JSDoc note to A1 Code Affordances |
| 8 | MEDIUM | Missing JSDoc on `BetSchema.runId` (lifecycle contract) | Added JSDoc note to A2 Code Affordances |
| 9 | MEDIUM | `setRunId` idempotency contract unspecified | Documented overwrite behavior + error cases in A2 |
| 10 | MEDIUM | `loadRunSummaries` needs to read `run.json` first for `stageSequence` | Made explicit in A3 wiring detail |
| 11 | MEDIUM | Missing boundary test: `avgConfidence === 0.6` | Added to V5 acceptance criteria |
| 12 | MEDIUM | Missing test: pre-migration bet (no `runId`) | Added to V4 acceptance criteria |
| 13 | MEDIUM | `gapCount` flat — no severity breakdown | Added `gapsBySeverity` to `RunSummary`; high gaps escalate to high priority |
| 14 | WARNING | `ManifestBuilder` is object literal — "static method" terminology misleading | Fixed to "method on the ManifestBuilder object" |
| 15 | WARNING | Double-serialization risk in `ManifestBuilder.build()` | Made explicit: replace existing `if (stage.resources)` block |
| 16 | LOW | Layer violation concern (features importing @infra) | Confirmed not a violation — established pattern in codebase |
| 17 | LOW | `'low-confidence'` naming vs noun-phrase pattern | Kept — tradeoff noted but readability wins |
| 18 | LOW | `setRunId` vs widened `updateBet` | Kept as separate method — already justified in Decision 1 |
