---
shaping: true
---

# Wave C — Session 3 + 4: Cooldown Feedback Loop — Shaping

## Requirements (R)

| ID  | Requirement                                                                                                    | Status       |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------ |
| R0  | Practitioners can review and act on rule suggestions during cooldown, activating learnings for the next cycle  | Core goal    |
| R1  | `KiaiRunner` must instantiate and pass `RuleRegistry` to orchestrators (currently omitted — suggestions never created) | Must-have |
| R2  | `CooldownSession` reads all pending `RuleSuggestion[]` from `RuleRegistry` and includes them in its result     | Must-have    |
| R3  | `kata cooldown` presents interactive accept/reject/defer for each pending rule suggestion                       | Must-have    |
| R4  | Accepted suggestions call `ruleRegistry.acceptSuggestion(id)` → rule becomes active immediately               | Must-have    |
| R5  | `--json` output includes rule suggestions, review outcomes, and cross-run pattern data                         | Must-have    |
| R6  | `RunSummary` extended with per-stage `selectedFlavors` and gap descriptions for cross-run analysis             | Must-have    |
| R7  | Cross-run analysis detects recurring gaps (2+ bets) and flavor frequency anomalies                             | Must-have    |
| R8  | `ProposalGenerator` produces cross-gap and unused-flavor proposals from cross-run analysis                     | Must-have    |
| R9  | `--yolo` low-confidence decisions are counted per run and surfaced in cooldown output                          | Nice-to-have |
| R10 | `kata rule accept <id>` and `kata rule reject <id> --reason "..."` commands for programmatic/LLM-driven rule review without running full cooldown | Must-have |
| R11 | `kata cooldown --auto-accept-suggestions` flag accepts all pending suggestions non-interactively for headless/automated runs | Nice-to-have |

---

## Shape A: Single session — full #45 scope

All R1–R9 in one session: KiaiRunner fix + CooldownSession ruleRegistry + interactive CLI +
cross-run analyzer + --yolo review.

## Shape B: Two-session split — wiring first

**Session 3:** R1 + R2 + R3 + R4 + R5 (rule suggestion pipeline end-to-end)
**Session 4:** R6 + R7 + R8 + R9 (cross-run pattern analysis)

## Shape C: Surface-only — no interaction

Session 3: R1 + R2 + R5 only — surface rule suggestions in `--json` and formatter, no interactive review.
Interactive review as a future ticket.

---

## Fit Check

| Req | Requirement                                                                           | Status       | A  | B  | C  |
| --- | ------------------------------------------------------------------------------------- | ------------ | -- | -- | -- |
| R0  | Practitioners can review and act on suggestions during cooldown                       | Core goal    | ✅ | ✅ | ❌ |
| R1  | KiaiRunner → RuleRegistry wiring                                                      | Must-have    | ✅ | ✅ | ✅ |
| R2  | CooldownSession reads pending RuleSuggestion[]                                        | Must-have    | ✅ | ✅ | ✅ |
| R3  | Interactive accept/reject/defer in kata cooldown                                      | Must-have    | ✅ | ✅ | ❌ |
| R4  | Accepted rules activated immediately                                                  | Must-have    | ✅ | ✅ | ❌ |
| R5  | --json includes rule suggestions and review outcomes                                  | Must-have    | ✅ | ✅ | ❌ |
| R6  | RunSummary extended with stageDetails                                                 | Must-have    | ✅ | ✅ (S4) | ❌ |
| R7  | Cross-run recurring gap + flavor frequency detection                                  | Must-have    | ✅ | ✅ (S4) | ❌ |
| R8  | ProposalGenerator cross-gap + unused-flavor proposals                                 | Must-have    | ✅ | ✅ (S4) | ❌ |
| R9  | --yolo low-confidence decision counting                                               | Nice-to-have | ✅ | ✅ (S4) | ❌ |
| R10 | `kata rule accept/reject` programmatic commands for LLM/agent-driven rule review     | Must-have    | ✅ | ✅ (S3) | ❌ |
| R11 | `kata cooldown --auto-accept-suggestions` headless flag                               | Nice-to-have | ✅ | ✅ (S3) | ❌ |

**Notes:**
- C fails R0, R3, R4, R5, R10, R11 — the feedback loop is incomplete without interactive review, rule activation, and programmatic access.
- A passes all but is 8–9 verticals in one session — high scope risk.
- B passes all across two achievable sessions. Session 3 delivers the highest-value items; Session 4 adds the pattern intelligence layer.

**Selected shape: B**

---

## Detail B — Session 3: Rule Suggestion Pipeline

### Parts

| Part     | Mechanism                                                                                                     | Flag |
| -------- | ------------------------------------------------------------------------------------------------------------- | :--: |
| **B1**   | **KiaiRunner → RuleRegistry wiring**                                                                          |      |
| B1.1     | `kiai-runner.ts`: instantiate `RuleRegistry(kataDirPath(kataDir, 'rules'))` and pass as `ruleRegistry` to `createStageOrchestrator()` and `createMetaOrchestrator()` |      |
| B1.2     | Both `StageOrchestratorDeps.ruleRegistry` and `MetaOrchestratorDeps.ruleRegistry` are already optional — no interface change needed |      |
| B1.3     | Test: after `KiaiRunner.run()` with a mock orchestrator that calls `suggestRule()`, verify the suggestion exists in the RuleRegistry |      |
| **B2**   | **CooldownSession rule suggestion aggregation**                                                               |      |
| B2.1     | Add `ruleRegistry?: IStageRuleRegistry` to `CooldownSessionDeps` (optional — backward compat)                |      |
| B2.2     | Add `ruleSuggestions?: RuleSuggestion[]` to `CooldownSessionResult`                                          |      |
| B2.3     | In `run()`: if `ruleRegistry` provided, call `ruleRegistry.getPendingSuggestions()` and include in result — no cycle-filtering (all pending suggestions are surfaced; user-reviewed ones clear each cooldown) |      |
| B2.4     | Test: `run()` with `ruleRegistry` that has 2 pending suggestions → `result.ruleSuggestions.length === 2`      |      |
| **B3**   | **Interactive accept/reject/defer in `kata cooldown`**                                                        |      |
| B3.1     | After bet outcomes, before proposal generation: if `result.ruleSuggestions.length > 0` and not `--skip-prompts`, present each suggestion interactively |      |
| B3.2     | Per-suggestion display: effect (boost/penalize/require/exclude), flavor name, condition, reasoning, observation count |      |
| B3.3     | `@inquirer/prompts` `select`: choices are `accept`, `reject` (prompts for reason), `defer` (leave pending)   |      |
| B3.4     | Collect `SuggestionReviewRecord[]` keyed by id + decision                                                     |      |
| **B4**   | **Apply accepted/rejected suggestions via RuleRegistry**                                                      |      |
| B4.1     | For each accepted: call `ruleRegistry.acceptSuggestion(id)` → rule is written to `.kata/rules/{category}/{id}.json` and becomes active |      |
| B4.2     | For each rejected: call `ruleRegistry.rejectSuggestion(id, reason)` → marked `'rejected'` on disk            |      |
| B4.3     | Deferred suggestions: no action — remain `'pending'` for next cooldown                                        |      |
| B4.4     | Accepted/rejected/deferred counts included in `CooldownSessionResult`                                         |      |
| **B5**   | **Formatter + --json updates**                                                                                 |      |
| B5.1     | `--json` output: add `ruleSuggestions` (original list) and `suggestionReview` (`{ accepted, rejected, deferred }` counts) |      |
| B5.2     | Formatted output: `--- Rule Suggestions ---` section showing reviewed counts and each accepted rule's name/effect |      |
| B5.3     | `kata cooldown` wires `ruleRegistry: new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'))` into `CooldownSessionDeps` |      |
| **B10**  | **`kata rule` programmatic commands — agent/LLM path (R10 + R11)**                                                    |      |
| B10.1    | New module `src/cli/commands/rules.ts`: `kata rule accept <id>` and `kata rule reject <id> --reason <reason>` commands |      |
| B10.2    | Each command: instantiate `new RuleRegistry(kataDirPath(ctx.kataDir, 'rules'))`, call `acceptSuggestion(id)` or `rejectSuggestion(id, reason)` |      |
| B10.3    | `--json` output: `{ id, decision: 'accepted'\|'rejected', rule? }` for machine-readable confirmation                  |      |
| B10.4    | `kata cooldown --auto-accept-suggestions`: when flag set, suggestion review loop accepts all pending suggestions non-interactively (skips prompts, calls `acceptSuggestion` for each) |      |
| B10.5    | Test: seed a pending suggestion → `kata rule accept <id>` → suggestion file becomes accepted, active rule file written |      |

### New type

```typescript
// src/features/cycle-management/types.ts
export interface SuggestionReviewRecord {
  id: string;
  decision: 'accepted' | 'rejected' | 'deferred';
  rejectionReason?: string;  // populated when decision === 'rejected'
}
```

`CooldownSessionResult` gains:
```typescript
ruleSuggestions?: RuleSuggestion[];
suggestionReview?: { accepted: number; rejected: number; deferred: number };
```

---

## Detail B — Session 4: Cross-Run Pattern Analysis

### Parts

| Part     | Mechanism                                                                                                     | Flag |
| -------- | ------------------------------------------------------------------------------------------------------------- | :--: |
| **B6**   | **Extend RunSummary with stage details**                                                                       |      |
| B6.1     | Add `stageDetails: Array<{ category: StageCategory; selectedFlavors: string[]; gaps: Array<{ description: string; severity: 'low'\|'medium'\|'high' }> }>` to `RunSummary` |      |
| B6.2     | Add `yoloDecisionCount: number` to `RunSummary` (count of `DecisionEntry` where `lowConfidence === true`)     |      |
| B6.3     | Update `loadRunSummaries()`: populate `stageDetails` from each `StageState` (`selectedFlavors`, `gaps`), count `lowConfidence` entries in `decisions.jsonl` |      |
| B6.4     | All existing tests remain valid — additive fields only                                                        |      |
| **B7**   | **CrossRunAnalyzer**                                                                                           |      |
| B7.1     | New module `src/features/cycle-management/cross-run-analyzer.ts` (pure functions — no class)                  |      |
| B7.2     | `analyzeFlavorFrequency(summaries: RunSummary[]): Map<string, number>` — counts selections per flavor name across all `stageDetails` |      |
| B7.3     | `analyzeRecurringGaps(summaries: RunSummary[]): Array<{ description: string; severity: string; betCount: number }>` — groups gap descriptions by normalized text (lowercase trim), filters to `betCount >= 2` |      |
| **B8**   | **ProposalGenerator cross-run proposals**                                                                      |      |
| B8.1     | Add `analyzeCrossRunPatterns(summaries: RunSummary[]): CycleProposal[]` to `ProposalGenerator`                |      |
| B8.2     | Recurring gap in 2+ bets → high-priority `'cross-gap'` proposal with `relatedBetIds` populated               |      |
| B8.3     | Flavor with 0 selections across all runs → medium-priority `'unused-flavor'` proposal                         |      |
| B8.4     | Update `generate()` to call `analyzeCrossRunPatterns(runSummaries)` when `runSummaries` provided              |      |
| B8.5     | Add `'cross-gap'` and `'unused-flavor'` to `CycleProposal.source` union; add to `sourceOrder` map            |      |
| **B9**   | **--yolo surfacing**                                                                                           |      |
| B9.1     | `analyzeRunData()` in `ProposalGenerator`: if `sum(yoloDecisionCount) > 0` across all summaries, emit a low-priority `'low-confidence'` proposal summarizing total --yolo count |      |
| B9.2     | Formatter: `--- Run Summaries ---` line shows `yoloDecisionCount` when > 0                                    |      |
| B9.3     | `--json` output: `runSummaries` now includes `yoloDecisionCount` and `stageDetails`                           |      |

### New source types

```typescript
// src/features/cycle-management/proposal-generator.ts
source: 'unfinished' | 'unblocked' | 'learning' | 'dependency' |
        'run-gap' | 'low-confidence' | 'cross-gap' | 'unused-flavor';
```

`sourceOrder` additions: `'cross-gap': 1.5` (between dependency and run-gap), `'unused-flavor': 3.5` (between unblocked and learning).

---

## Decision Points Log

| #  | Decision                                   | Options                   | Selected | Rationale                                                                                                                      |
| -- | ------------------------------------------ | ------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D1 | Single session vs. two-session split       | A (single), B (split), C (surface-only) | B | A is too risky at 8–9 verticals; C fails the core feedback loop. B delivers the highest-value items (interactive review + rule activation) in S3, then pattern intelligence in S4. |
| D2 | Cycle-filter rule suggestions or surface all | Filter to cycle's decision IDs vs. surface all pending | All pending | Filtering by decision UUID requires joining suggestion `triggerDecisionIds` against all `decisions.jsonl` entries — complex and brittle. In practice, pending suggestions are recent; users clear them each cooldown. Keep it simple. |
| D3 | Vocabulary seeding in scope?               | In scope vs. out of scope | Out      | No `VocabularyStore` infrastructure exists. Adding vocabulary CLI is a significant new investment outside #45's critical path. Filed as future work. |
| D4 | Where does CrossRunAnalyzer live?          | Class vs. pure functions  | Pure functions in `cross-run-analyzer.ts` | Consistent with `analyzeRecurringGaps` / `analyzeFlavorFrequency` being stateless transforms over `RunSummary[]`. No dependencies to inject. |
| D5 | Programmatic rule review — new commands vs. agent-driven cooldown only | New `kata rule accept/reject` commands vs. `kata cooldown --auto-accept-suggestions` only | Both | LLM agents need atomic `kata rule accept <id>` composability without re-running full cooldown (e.g., agent reviews suggestions as a separate step in its workflow). `--auto-accept-suggestions` provides headless convenience for fully automated pipelines. Both paths share the same `RuleRegistry.acceptSuggestion()`/`rejectSuggestion()` write operations. |
