---
shaping: true
---

# Wave C Session 1 — Shaping

## Requirements (R)

| ID   | Requirement                                                                                  | Status    |
| ---- | -------------------------------------------------------------------------------------------- | --------- |
| R0   | Wire the orchestration intelligence loop: rules affect scoring, gaps are detected, reflect generates suggestions | Core goal |
| R1   | #103: Rule effects (boost/penalize/require/exclude) change flavor scores and selection during the match phase | Must-have |
| R2   | #103: Rule precedence: exclude > require; penalize/boost stack additively; rule confidence weights magnitude | Must-have |
| R3   | #103: Rule condition matching against capability profile (bet context, artifacts, stage category) | Must-have |
| R4   | #103: Rule applications logged in MatchReport reasoning (which rule fired, what effect)      | Must-have |
| R5   | #104: After flavor selection, vocabulary coverage gap analysis produces GapReport[] entries  | Must-have |
| R6   | #104: Gap analysis records a `gap-assessment` Decision                                       | Must-have |
| R7   | #49: Reflect phase generates rule suggestions from decision outcomes via RuleRegistry.suggestRule() | Must-have |
| R8   | #49: Minimum viable scope: analyze flavor-selection decisions from current stage only (no cross-run history consultation) | Must-have |
| R9   | Session fit: scope delivers ≥2 closed issues (#103 + #104 mandatory; #49 on track)          | Must-have |
| R10  | No-go: Cooldown ↔ run data integration (#45) — XL effort, blocked by #49                   | Out       |
| R11  | No-go: Orchestrator history consultation, vocabulary enrichment, `kata knowledge rules --pending` CLI (#49 stretch) | Out       |
| R12  | No-go: Flavor-level resource aggregation + ManifestBuilder integration (#105) — step-level already works | Out       |

---

## Design Decision: Rule Condition Matching

`StageRule.condition` is a human-readable string (e.g., "when bet contains auth keywords").
How do we evaluate it in code?

**Options considered:**

| Option | Mechanism | Tradeoff |
| ------ | --------- | -------- |
| Keyword extraction | Split condition on spaces, check if any words appear in betText + stageCategory + artifact names | Simple, v1-appropriate, some false positives |
| Structured predicates | Named evaluator registry, condition is a key like `"bet-has:auth"` | Better precision, requires schema change |
| LLM evaluation | Agent reads condition and evaluates | Not appropriate — kata is not an agent runtime |

**Decision**: Keyword extraction. For v1, rules are authored by agents or users who understand
the convention. Filter out common stop words. Match significant words from condition against
capability profile. Condition confidence (rule.confidence) weights the magnitude anyway, so
imprecise matches degrade gracefully.

---

## A: In-Place Wiring with Classified Rule Effects

Wire all three intelligence phases directly in `BaseStageOrchestrator`. No new abstraction
classes. Small-diff changes to existing methods + one new private helper.

| Part   | Mechanism                                                                                    | Flag |
| ------ | -------------------------------------------------------------------------------------------- | :--: |
| **A1** | **Rule evaluation in `match()` phase (#103)**                                                |      |
| A1.1   | `evaluateRuleCondition(rule, profile)` private helper: extracts meaningful words from `rule.condition`, checks against betText, artifact names, stageCategory | |
| A1.2   | Classify active rules by effect: `excluded` set (exclude rules that fire), `required` set (require rules that fire), `adjustments` Map<flavorName, number> (boost/penalize) | |
| A1.3   | Merge rule-excluded names into `excluded` set (before pinnedFlavors check — exclude wins) | |
| A1.4   | Merge rule-required flavor names into `pinned` set (after excluded — require loses to exclude) | |
| A1.5   | Compute score adjustment per flavor: `Σ (±magnitude × confidence)` for all matching boost/penalize rules where flavor name matches rule.name or rule.condition | |
| A1.6   | Add `ruleAdjustments` to flavor score in MatchReport: `score = clamp(base + ruleAdj, 0, 1)` | |
| A1.7   | Annotate MatchReport.reasoning with which rules fired and their effects                      |      |
| **A2** | **Gap analysis in `planExecution()` phase (#104)**                                           |      |
| A2.1   | After flavor selection, extract covered keywords: union of words from each selected flavor's name + description | |
| A2.2   | Extract bet context keywords from `betText()` (title, description, tags), filter stop words  | |
| A2.3   | Gap = vocabulary keyword (from `this.vocabulary?.keywords`) in bet context not covered by any selected flavor's name/description | |
| A2.4   | For each gap keyword: find available (unselected) flavors that mention it → `suggestedFlavors` | |
| A2.5   | Severity heuristic: high if vocabulary keyword is a stage primary keyword; medium if secondary; low otherwise | |
| A2.6   | Record `gap-assessment` Decision via `decisionRegistry.record()`                             |      |
| A2.7   | Return `GapReport[]` alongside the execution plan (populate `ExecutionPlan.gaps`)            |      |
| **A3** | **Rule suggestion generation in `reflect()` phase (#49 minimum viable)**                     |      |
| A3.1   | Extract all `flavor-selection` decisions from the completed stage's decision list            |      |
| A3.2   | Correlate outcome: `good` → boost suggestion for selected flavor; `poor` → penalize suggestion | |
| A3.3   | Build suggestion with: category, condition (e.g. "pattern from `<betKeywords>` context"), effect, magnitude 0.3, confidence 0.6, evidence (decision IDs) | |
| A3.4   | Call `ruleRegistry.suggestRule()` if registry available — non-fatal if it throws (same pattern as `updateOutcome`) | |
| A3.5   | Populate `ReflectionResult.ruleSuggestions` with generated suggestion IDs                    |      |

---

## B: Extracted Collaborators

Same behavior as A but each intelligence piece lives in its own class/file:
- `RuleEvaluator` class in `src/domain/services/rule-evaluator.ts`
- `GapAnalyzer` function/class in `src/domain/services/gap-analyzer.ts`
- `ReflectAnalyzer` in `src/domain/services/reflect-analyzer.ts`

Wire into `BaseStageOrchestrator` via constructor injection or static calls.

Pros: Better testability for each component in isolation, cleaner concerns.
Cons: More files, more wiring, more moving parts for a session-sized scope.
     Creates premature abstraction — these are small, cohesive changes to one class.

---

## C: #103 Only — Rule Wiring Without Gap/Reflect

Deliver rule wiring (#103) alone. Defer gap analysis (#104) and reflect (#49).

Pros: Ship one issue with high confidence.
Cons: Session goal is "wire the intelligence loop" — this delivers only ⅓ of it.
     Gap analysis and reflect are logically coupled to rule wiring (gap suggests rules, reflect generates them).

---

## Fit Check

| Req | Requirement                                                          | Status    | A   | B   | C   |
| --- | -------------------------------------------------------------------- | --------- | --- | --- | --- |
| R0  | Wire orchestration intelligence loop                                 | Core goal | ✅  | ✅  | ❌  |
| R1  | Rule effects change flavor scores                                    | Must-have | ✅  | ✅  | ✅  |
| R2  | Rule precedence: exclude > require > boost/penalize stack            | Must-have | ✅  | ✅  | ✅  |
| R3  | Rule condition matching against capability profile                   | Must-have | ✅  | ✅  | ✅  |
| R4  | Rule applications logged in MatchReport reasoning                    | Must-have | ✅  | ✅  | ✅  |
| R5  | Gap analysis produces GapReport[] after flavor selection             | Must-have | ✅  | ✅  | ❌  |
| R6  | Gap analysis records gap-assessment Decision                         | Must-have | ✅  | ✅  | ❌  |
| R7  | Reflect phase generates rule suggestions via RuleRegistry.suggestRule() | Must-have | ✅  | ✅  | ❌  |
| R8  | Minimum viable reflect — current stage only, no cross-run history    | Must-have | ✅  | ✅  | ✅  |
| R9  | Session fit: ≥2 closed issues                                        | Must-have | ✅  | ❌  | ❌  |
| R10 | No cooldown #45                                                      | Out       | ✅  | ✅  | ✅  |
| R11 | No #49 stretch goals                                                 | Out       | ✅  | ✅  | ✅  |
| R12 | No #105 flavor/manifest layer                                        | Out       | ✅  | ✅  | ✅  |

**Notes:**
- B fails R9: more files = more setup time, session too short to deliver 2+ closed issues
- C fails R0, R5, R6, R7, R9: only wires rules, leaves gap/reflect as stubs

---

## Selected Shape: A

Shape A wins. In-place wiring keeps diffs small and focused. The three intelligence
phases (match rules, plan gaps, reflect suggestions) are tightly coupled and belong
together in `BaseStageOrchestrator`. Extracting to collaborators (B) adds overhead
without payoff at this scale.

**Parts summary:**

| Part | Closes | Files Changed |
| ---- | ------ | ------------- |
| A1   | #103   | `src/domain/services/stage-orchestrator.ts` |
| A2   | #104   | `src/domain/services/stage-orchestrator.ts` |
| A3   | #49 (MVP) | `src/domain/services/stage-orchestrator.ts` |
| Tests | All   | `src/domain/services/stage-orchestrator.test.ts` |
| Docs | All    | `skill/orchestration.md` |

---

## Decision Points Log

| # | Decision | Options | Selected | Reason |
| - | -------- | ------- | -------- | ------ |
| 1 | Rule condition matching strategy | Keyword extraction, structured predicates, LLM | Keyword extraction | Simplest for v1; rule confidence weights magnitude; no schema change needed |
| 2 | Shape selection | A (in-place), B (extracted), C (#103 only) | A | Best session fit; all three phases in one focused file |
| 3 | #49 scope | Full (history consultation + vocab enrichment + CLI), MVP (current-stage outcomes only) | MVP | History consultation requires cross-run data (blocked by #45); CLI deferred |
| 4 | #105 scope | Full (flavor aggregation + ManifestBuilder), Deferred (step-level already works) | Deferred | Step-level already works via kata step next; flavor aggregation is separate concern |
