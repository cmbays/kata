---
shaping: true
---

# Wave C Session 2 — Shaping

## Requirements (R)

| ID  | Requirement                                                                                         | Status    |
| --- | --------------------------------------------------------------------------------------------------- | --------- |
| R0  | Close #105: flavor-level resources wired so agents see merged tool/agent/skill guidance             | Core goal |
| R1  | `FlavorSchema` gains `resources?: StepResources` — flavor-level additions beyond step defaults      | Must-have |
| R2  | `ManifestBuilder.aggregateFlavorResources(flavor, steps)` — union all step resources + flavor additions, deduplicate by name; skip FlavorStepRef with no matching stepDef (no throw) | Must-have |
| R3  | `kata step next` returns merged resources (step's own + flavor-level) via FlavorRegistry lookup — not step-only | Must-have |
| R4  | `ManifestBuilder.build()` accepts optional `flavorResources?: StepResources`; **replaces** existing `if (stage.resources)` block with single merge-then-serialize (no double-print risk) | Must-have |
| R5  | Gate conditions and artifact requirements remain non-overridable (already enforced by schema design) | Must-have |
| R6  | Tests: aggregation, deduplication (same name from step + flavor), empty cases, ManifestBuilder integration, **registry-miss skip** (FlavorStepRef with no stepDef) | Must-have |
| R6a | `skill/orchestration.md` updated to document merged resources in `kata step next` output | Must-have |
| R7  | Close #112: cooldown reads `.kata/runs/` data and enriches proposals                               | Core goal |
| R8  | `BetSchema` gains `runId?: string` with JSDoc lifecycle contract; `CycleManager` gains `setRunId(cycleId, betId, runId)` with idempotency: overwrite if already set, throw on unknown ids | Must-have |
| R9  | `kata cycle start` calls `manager.setRunId(cycleId, bet.id, runId)` after creating each run        | Must-have |
| R10 | `CooldownSessionDeps` gains optional `runsDir?: string` (backward compat — existing tests unaffected) | Must-have |
| R10a| `RunSummary` interface exported from `src/features/cycle-management/types.ts` (shared between CooldownSession and ProposalGenerator) | Must-have |
| R10b| `RunSummary.avgConfidence` is `number \| null` — `null` when no decisions recorded (not `0`) | Must-have |
| R10c| `RunSummary.gapsBySeverity: { low, medium, high }` — breakdown in addition to `gapCount` total | Must-have |
| R11 | `CooldownSession.loadRunSummaries()` reads `run.json` first for `stageSequence`, then iterates categories; skips bets without `runId` silently; skips missing files with `logger.warn` | Must-have |
| R12 | `ProposalGenerator.generate(cycleId, runSummaries?)` — optional run summaries enrich proposals     | Must-have |
| R13 | `ProposalGenerator.analyzeRunData(summaries)` — high-severity gaps → high priority; other gaps → medium; `avgConfidence !== null && < 0.6` → low | Must-have |
| R13a| `prioritize()` `sourceOrder` map updated to include `'run-gap': 2` and `'low-confidence': 5`      | Must-have |
| R14 | `kata cooldown`/`kata ma` `--json` includes per-bet `runSummary` (stages, gapsBySeverity, avgConfidence) | Must-have |
| R15 | Tests: BetSchema.runId, setRunId idempotency, CooldownSession with no-runId bets, avgConfidence null, gapsBySeverity, ProposalGenerator boundary at avgConfidence=0.6, sourceOrder sort | Must-have |
| R16 | No-go: interactive suggestion review (accept/reject rules/vocab)                                   | Out       |
| R17 | No-go: `kata cooldown start` subcommand redesign                                                   | Out       |
| R18 | No-go: cross-run flavor frequency, outcome pattern detection (full #45)                            | Out       |

---

## Design Decision 1: Run Lookup Strategy

When `CooldownSession` needs to find runs for a cycle's bets, two options:

| Option | Mechanism | Tradeoff |
| ------ | --------- | -------- |
| Forward lookup | Add `runId` to `BetSchema`; set in `kata cycle start` | O(1) lookup; requires schema change + write-back |
| Reverse scan | Scan `.kata/runs/`; filter by `run.betId` | No schema change; O(n) scan; simpler |

**Decision**: Forward lookup via `BetSchema.runId`. Issue #112 explicitly specifies this field.
It also makes `CooldownSession` code straightforward — no directory scan needed.
`CycleManager.setRunId()` is added as a separate, focused method rather than overloading the
existing `updateBet()` signature.

---

## Design Decision 2: Where does aggregateFlavorResources live?

| Option | Location | Notes |
| ------ | -------- | ----- |
| A | `ManifestBuilder` static method | Co-located with `serializeResources()` — same cohesion |
| B | Separate `flavor-utils.ts` utility | Cleaner separation; one more file |
| C | Inline in `kata step next` (step.ts) | Leaks domain logic into CLI layer |

**Decision**: `ManifestBuilder` static method (Option A). Same reasoning as `serializeResources()`
already living there. Both are about transforming step/flavor definitions into prompt text.
CLI layer calls it rather than reimplementing.

---

## Design Decision 3: How to pass run data to ProposalGenerator

| Option | Mechanism | Notes |
| ------ | --------- | ----- |
| A | `generate(cycleId, runSummaries?)` — caller passes pre-loaded data | ProposalGenerator stays stateless; CooldownSession controls loading |
| B | `ProposalGeneratorDeps.runsDir` — generator loads itself | ProposalGenerator gains I/O dependency; harder to test |
| C | New `RunAwareProposalGenerator` subclass | Over-engineered for this scope |

**Decision**: Option A — optional `runSummaries` parameter on `generate()`. Keeps
ProposalGenerator pure; CooldownSession loads the data and passes summaries in.
Tests for ProposalGenerator remain in-memory.

---

## Shape A — In-Place Wiring

Wire both issues directly into existing files. No new classes. Small, focused diffs.

### Part A1 — #105: Flavor resources schema + aggregation

| Step | Change | File |
| ---- | ------ | ---- |
| A1.1 | Add `resources?: StepResources` to `FlavorSchema` | `src/domain/types/flavor.ts` |
| A1.2 | Add `ManifestBuilder.aggregateFlavorResources(flavor, stepDefs)` method on the ManifestBuilder object | `src/domain/services/manifest-builder.ts` |
| A1.3 | `aggregateFlavorResources`: iterate `flavor.steps`, union each resolved `stepDef.resources`; append `flavor.resources`; deduplicate by `.name` within each array; skip FlavorStepRef with no matching stepDef (no throw) | `src/domain/services/manifest-builder.ts` |
| A1.4 | Add optional `flavorResources?: StepResources` param to `ManifestBuilder.build()` | `src/domain/services/manifest-builder.ts` |
| A1.5 | In `build()`, **replace** the existing `if (stage.resources)` block: merge `step.resources` + `flavorResources` into `effectiveResources`; serialize once (no double-print) | `src/domain/services/manifest-builder.ts` |
| A1.6 | In `kata step next`: instantiate `FlavorRegistry(flavorsDir)`; call `.get(currentStage, activeFlavor)` to get Flavor; resolve each FlavorStepRef via StepRegistry; call `aggregateFlavorResources(flavor, stepDefs)` as the `resources` output | `src/cli/commands/step.ts` |
| A1.7 | Tests: aggregation with no flavor resources, step-only resources, flavor additions, deduplication (step wins on name conflict), empty flavor, **registry-miss skip** | `src/domain/services/manifest-builder.test.ts` |

### Part A2 — #112: BetSchema.runId + CycleManager + kata cycle start

| Step | Change | File |
| ---- | ------ | ---- |
| A2.1 | Add `runId: z.string().uuid().optional()` to `BetSchema` | `src/domain/types/bet.ts` |
| A2.2 | Add `setRunId(cycleId, betId, runId)` method to `CycleManager` | `src/domain/services/cycle-manager.ts` |
| A2.3 | In `kata cycle start`, after `createRunTree()`, call `manager.setRunId(cycleId, bet.id, runId)` | `src/cli/commands/cycle.ts` |
| A2.4 | Tests: `setRunId()` persists, throws on unknown cycleId/betId, **idempotent overwrite** (second call with different runId overwrites, no throw) | `src/domain/services/cycle-manager.test.ts` |

### Part A3 — #112: CooldownSession reads run data

| Step | Change | File |
| ---- | ------ | ---- |
| A3.1 | Add `runsDir?: string` to `CooldownSessionDeps` | `src/features/cycle-management/cooldown-session.ts` |
| A3.2 | Create `RunSummary` exported interface: `{ betId, runId, stagesCompleted, gapCount, gapsBySeverity, avgConfidence: number\|null, artifactPaths }` | `src/features/cycle-management/types.ts` (new file) |
| A3.3 | Add `loadRunSummaries(cycle)` private method: reads `run.json` first (for stageSequence), then stage states, then `decisions.jsonl` (`avgConfidence = null` if empty), then `artifact-index.jsonl`; skips bets without `runId` silently; skips missing files with `logger.warn` | `src/features/cycle-management/cooldown-session.ts` |
| A3.4 | Call `loadRunSummaries()` in `run()` when `runsDir` is present; pass summaries to `ProposalGenerator.generate()` | `src/features/cycle-management/cooldown-session.ts` |
| A3.5 | Include `runSummaries` in `CooldownSessionResult` | `src/features/cycle-management/cooldown-session.ts` |
| A3.6 | Tests: with/without runsDir, missing run files gracefully skipped | `src/features/cycle-management/cooldown-session.test.ts` |

### Part A4 — #112: ProposalGenerator run data analysis

| Step | Change | File |
| ---- | ------ | ---- |
| A4.1 | Add `runSummaries?: RunSummary[]` param to `generate(cycleId, runSummaries?)` | `src/features/cycle-management/proposal-generator.ts` |
| A4.2 | Add `analyzeRunData(summaries)` method: `gapsBySeverity.high > 0` → high-priority `'run-gap'`; other `gapCount > 0` → medium; `avgConfidence !== null && avgConfidence < 0.6` → low `'low-confidence'` (skip when `null`) | `src/features/cycle-management/proposal-generator.ts` |
| A4.3 | Call `analyzeRunData()` in `generate()` when summaries provided; include in combined + prioritized output | `src/features/cycle-management/proposal-generator.ts` |
| A4.4 | Add `'run-gap' \| 'low-confidence'` to `CycleProposal.source` union; **update `sourceOrder`** to `{ unfinished:0, dependency:1, 'run-gap':2, unblocked:3, learning:4, 'low-confidence':5 }` | `src/features/cycle-management/proposal-generator.ts` |
| A4.5 | Tests: gap proposals (medium), high-severity gap → high, `avgConfidence === null` skipped, **`avgConfidence === 0.6` skipped** (boundary), `avgConfidence === 0.59` fires, deduplication with existing sources | `src/features/cycle-management/proposal-generator.test.ts` |

### Part A5 — #112: CLI enrichment

| Step | Change | File |
| ---- | ------ | ---- |
| A5.1 | Pass `runsDir` to `CooldownSessionDeps` in `kata cooldown`/`kata ma` command | `src/cli/commands/cycle.ts` |
| A5.2 | Include `runSummaries` in `--json` output | `src/cli/commands/cycle.ts` |
| A5.3 | Display per-bet run summary in non-JSON output (stages completed, gap count, avg confidence %) | `src/cli/commands/cycle.ts` |

---

## Shape B — Extracted Collaborators

Same behavior but `FlavorResourceAggregator` class in `src/domain/services/` and
`RunDataLoader` class in `src/features/cycle-management/`.

Pros: Better isolation in tests, cleaner single-responsibility.
Cons: Two new files, more wiring, same behavior — premature for session-sized scope.

---

## Fit Check

| Req | Requirement                                              | A  | B  |
| --- | -------------------------------------------------------- | -- | -- |
| R0  | Close #105                                               | ✅ | ✅ |
| R1  | FlavorSchema.resources field                             | ✅ | ✅ |
| R2  | aggregateFlavorResources()                               | ✅ | ✅ |
| R3  | kata step next returns merged resources                  | ✅ | ✅ |
| R4  | ManifestBuilder.build() accepts flavorResources          | ✅ | ✅ |
| R6  | Tests for aggregation                                    | ✅ | ✅ |
| R7  | Close #112                                               | ✅ | ✅ |
| R8  | BetSchema.runId + CycleManager.setRunId()                | ✅ | ✅ |
| R9  | kata cycle start sets runId                              | ✅ | ✅ |
| R10 | CooldownSessionDeps.runsDir optional                     | ✅ | ✅ |
| R11 | CooldownSession loads run data                           | ✅ | ✅ |
| R12 | ProposalGenerator.generate() accepts runSummaries        | ✅ | ✅ |
| R13 | ProposalGenerator.analyzeRunData()                       | ✅ | ✅ |
| R14 | kata cooldown --json includes runSummaries               | ✅ | ✅ |
| R16 | No-go: interactive review                                | ✅ | ✅ |
| R17 | No-go: cooldown start subcommand                         | ✅ | ✅ |
| R18 | No-go: full #45 cross-run patterns                       | ✅ | ✅ |
| Session fit (2 closed issues, focused diffs)             | ✅ | ❌ |

**B fails session fit**: extra files create enough overhead to risk not closing both issues
in a single session.

---

## Selected Shape: A

In-place wiring across existing files. Two clear parts (A1 and A2-A5) map directly to
the two issues. Five affected source files, each receiving focused additions only.

| Part | Closes | Primary Files Changed |
| ---- | ------ | --------------------- |
| A1   | #105   | `flavor.ts`, `manifest-builder.ts`, `step.ts` |
| A1 skill | #105 | `skill/orchestration.md` |
| A2   | #112 partial | `bet.ts`, `cycle-manager.ts`, `cycle.ts` |
| A3-A5 | #112 core | `src/features/cycle-management/types.ts` (new), `cooldown-session.ts`, `proposal-generator.ts`, `cycle.ts` |
| Tests | both  | `manifest-builder.test.ts`, `cycle-manager.test.ts`, `cooldown-session.test.ts`, `proposal-generator.test.ts` |

---

## Decision Points Log

| # | Decision | Options | Selected | Reason |
| - | -------- | ------- | -------- | ------ |
| 1 | Run lookup strategy | Forward (BetSchema.runId) vs Reverse scan | Forward | Issue #112 specifies it; O(1) lookup; cleaner CooldownSession code |
| 2 | aggregateFlavorResources location | ManifestBuilder vs utility file vs CLI | ManifestBuilder | Co-located with serializeResources(); same cohesion |
| 3 | Run data injection into ProposalGenerator | Optional param vs deps field vs subclass | Optional param | Keeps ProposalGenerator stateless and testable; caller controls loading |
| 4 | Shape selection | A (in-place) vs B (extracted) | A | Session fit; in-place for two-issue scope; extracting is premature |
| 5 | #45 scope | Full XL (patterns + interactive review) vs #112 MVP (data wiring) | #112 MVP | Full #45 is XL with interactive review; wiring is the unblocked Wave C deliverable |
