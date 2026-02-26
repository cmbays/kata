---
impl-plan: true
pipeline: 20260225-wave-c-s1
issues: "#103, #104, #49"
---

# Wave C Session 1 — Implementation Plan

> Generated from breadboard at `docs/workspace/20260225-wave-c-s1/breadboard.md`.
> Shape: A (in-place wiring). Slices: V1 (#103), V2 (#104), V3 (#49 MVP).

---

## Pre-Flight Checks

| Risk | Status | Notes |
|------|--------|-------|
| All domain types already exist | ✅ Verified | `GapReport`, `ExecutionPlan.gaps`, `ReflectionResult.ruleSuggestions`, `DecisionType['gap-assessment']` — no schema changes |
| `OrchestratorResult` port needs `gaps` | ⚠️ 1 line | Port interface missing `readonly gaps?: GapReport[]` |
| `computeRuleAdjustments()` return not wired to `score` | ⚠️ Known stub | `score: base` ignores ruleAdj — must fix |
| 1 existing test counts `record` calls at exactly 4 | ⚠️ Fix in Step 4a | Gap-assessment adds 5th call; update assertion to 5 |
| `RuleSuggestion.suggestedRule` requires full `StageRuleSchema` shape | ✅ Verified | `source: 'auto-detected'`, `evidence: [decisionId]` covers all required fields |
| Layer violations | ✅ None | All changes stay in `domain/services/` + `domain/ports/` |

---

## Scope Summary

| File | Changes | Closes |
|------|---------|--------|
| `src/domain/ports/stage-orchestrator.ts` | +1 field to `OrchestratorResult` | — |
| `src/domain/services/stage-orchestrator.ts` | +5 methods, ~3 modified, 1 removed | #103 #104 #49 |
| `src/domain/services/stage-orchestrator.test.ts` | Fix 1 test, +3 describe blocks (~24 tests) | — |
| `skill/orchestration.md` | Remove stub language, describe active behavior | — |

**Total: 4 files, 0 new files, 0 new dependencies, 0 layer violations.**

---

## Step 0 — Port Interface (unblocks type checking for all steps)

**File:** `src/domain/ports/stage-orchestrator.ts`

- Add `GapReport` to the import from `@domain/types/orchestration.js`
- Add `readonly gaps?: GapReport[]` to `OrchestratorResult`

_Optional field for backward-compatibility — tests without vocabulary get `undefined`._

---

## Step 1 — V1: Rule Effects in `match()` (#103)

**File:** `src/domain/services/stage-orchestrator.ts`

### 1a. Imports

Add `GapReport` to existing orchestration import. Add:
```ts
import type { StageRule } from '@domain/types/rule.js';
```

### 1b. Module-level stop words constant

```ts
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has',
  'do', 'does', 'will', 'would', 'could', 'should', 'may', 'might', 'to',
  'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'or', 'and', 'but',
  'not', 'this', 'that', 'it', 'if', 'when', 'then', 'there', 'which', 'who',
]);
```

### 1c. Internal type (add near other internal types)

```ts
interface ClassifiedRules {
  excluded: Set<string>;
  required: Set<string>;
  adjustments: Map<string, number>;
}
```

### 1d. New private method: `evaluateRuleCondition()`

```ts
private evaluateRuleCondition(
  rule: StageRule,
  bText: string,
  artifacts: readonly string[],
  category: string,
): boolean {
  const words = rule.condition
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  if (words.length === 0) return false;

  const haystack = [bText, category, ...artifacts.map((a) => a.toLowerCase())].join(' ');
  return words.some((w) => haystack.includes(w));
}
```

### 1e. New private method: `classifyRuleEffects()`

```ts
private classifyRuleEffects(
  rules: StageRule[],
  context: OrchestratorContext,
): ClassifiedRules {
  const excluded = new Set<string>();
  const required = new Set<string>();
  const adjustments = new Map<string, number>();
  const bText = betText(context);

  for (const rule of rules) {
    if (!this.evaluateRuleCondition(rule, bText, context.availableArtifacts, this.stageCategory)) {
      continue;
    }
    switch (rule.effect) {
      case 'exclude':
        excluded.add(rule.name);
        break;
      case 'require':
        required.add(rule.name);
        break;
      case 'boost':
        adjustments.set(rule.name, (adjustments.get(rule.name) ?? 0) + rule.magnitude * rule.confidence);
        break;
      case 'penalize':
        adjustments.set(rule.name, (adjustments.get(rule.name) ?? 0) - rule.magnitude * rule.confidence);
        break;
    }
  }
  return { excluded, required, adjustments };
}
```

### 1f. Remove `computeRuleAdjustments()` stub (entire private method deleted)

### 1g. Modify `match()`

After building `excluded` and `pinned` from stage config but BEFORE filtering `candidateNames`, insert:

```ts
// Apply rule effects to excluded/pinned sets and compute per-flavor score adjustments
const ruleAdjMap = new Map<string, number>();
const firedRuleNames: string[] = [];
if (this.deps.ruleRegistry) {
  const rules = this.deps.ruleRegistry.loadRules(this.stageCategory);
  const classified = this.classifyRuleEffects(rules, context);
  for (const name of classified.excluded) excluded.add(name);
  for (const name of classified.required) {
    if (!excluded.has(name)) pinned.add(name);
  }
  for (const [name, adj] of classified.adjustments) {
    ruleAdjMap.set(name, adj);
  }
  firedRuleNames.push(...classified.excluded, ...classified.required, ...classified.adjustments.keys());
}
```

In the `matchReports` candidates mapping:
- Replace `const ruleAdj = this.computeRuleAdjustments(flavor)` with `const ruleAdj = ruleAdjMap.get(flavor.name) ?? 0`
- Change `score: base` to `score: Math.max(0, Math.min(1, base + ruleAdj))`
- Annotate reasoning: append ` Rule fired for "${flavor.name}".` when `firedRuleNames.includes(flavor.name)`

---

## Step 2 — V2: Gap Analysis in `planExecution()` (#104)

### 2a. New private method: `detectGaps()`

```ts
private detectGaps(
  selectedFlavors: Flavor[],
  allFlavors: Flavor[],
  context: OrchestratorContext,
): GapReport[] {
  const keywords = this.vocabulary?.keywords ?? [];
  if (keywords.length === 0) return [];

  const bText = betText(context);
  const selectedNames = new Set(selectedFlavors.map((f) => f.name));

  // Build coverage set from selected flavor names + descriptions
  const covered = new Set<string>();
  for (const flavor of selectedFlavors) {
    const text = [flavor.name, flavor.description ?? ''].join(' ').toLowerCase();
    for (const word of text.split(/\s+/)) {
      if (word.length > 2) covered.add(word);
    }
  }

  const gaps: GapReport[] = [];
  const total = keywords.length;

  keywords.forEach((keyword, index) => {
    const kwLower = keyword.toLowerCase();
    if (!bText.includes(kwLower)) return; // not in bet context — not a gap
    if (covered.has(kwLower)) return;     // covered by selected flavor — not a gap

    const suggestedFlavors = allFlavors
      .filter((f) => !selectedNames.has(f.name))
      .filter((f) => [f.name, f.description ?? ''].join(' ').toLowerCase().includes(kwLower))
      .map((f) => f.name);

    const severity: 'high' | 'medium' | 'low' =
      index < Math.ceil(total / 3) ? 'high'
      : index < Math.ceil((2 * total) / 3) ? 'medium'
      : 'low';

    gaps.push({
      description: `Bet context mentions "${keyword}" but no selected flavor covers it.`,
      severity,
      suggestedFlavors,
    });
  });

  return gaps;
}
```

### 2b. Modify `planExecution()` return type

Add `gaps: GapReport[]` to the returned shape.

### 2c. In `planExecution()`, after building `selected`, add:

```ts
// Gap analysis: detect vocabulary coverage gaps after flavor selection
const allFlavors = [...candidates, ...pinnedFlavors];
const gaps = this.detectGaps(selected, allFlavors, context);

// Record gap-assessment decision (non-fatal — gap analysis is informational)
try {
  this.deps.decisionRegistry.record({
    stageCategory: this.stageCategory,
    decisionType: 'gap-assessment',
    context: {
      gapCount: gaps.length,
      gaps,
      selectedFlavors: selected.map((f) => f.name),
    },
    options: ['gaps-found', 'no-gaps'],
    selection: gaps.length > 0 ? 'gaps-found' : 'no-gaps',
    reasoning:
      gaps.length > 0
        ? `Found ${gaps.length} coverage gap(s): ${gaps.map((g) => g.description).join('; ')}`
        : 'No coverage gaps detected — selected flavors cover bet context keywords.',
    confidence: 0.8,
    decidedAt: new Date().toISOString(),
  });
} catch (err) {
  logger.warn(
    `Orchestrator: failed to record gap-assessment decision: ${err instanceof Error ? err.message : String(err)}`,
  );
}

return { selectedFlavors: selected, executionMode, selectionDecision, modeDecision, gaps };
```

### 2d. Modify `run()`

Destructure `gaps` from `planExecution()` call and add to final return object.

---

## Step 3 — V3: Reflect Suggestions in `reflect()` (#49 MVP)

### 3a. New private method: `generateRuleSuggestions()`

```ts
private generateRuleSuggestions(
  decisions: Decision[],
  decisionOutcomes: ReflectionResult['decisionOutcomes'],
): string[] {
  if (!this.deps.ruleRegistry) return [];

  const suggestionIds: string[] = [];

  for (const decision of decisions) {
    if (decision.decisionType !== 'flavor-selection') continue;

    const outcomeEntry = decisionOutcomes.find((o) => o.decisionId === decision.id);
    if (!outcomeEntry) continue;

    const quality = outcomeEntry.outcome.artifactQuality;
    if (quality !== 'good' && quality !== 'poor') continue;

    const effect: 'boost' | 'penalize' = quality === 'good' ? 'boost' : 'penalize';
    const flavorName = decision.selection;

    // Build condition from bet context stored in the flavor-selection decision
    const bet = decision.context['bet'] as Record<string, unknown> | undefined;
    const betTitle = typeof bet?.['title'] === 'string' ? String(bet['title']) : '';
    const betDesc = typeof bet?.['description'] === 'string' ? String(bet['description']) : '';
    const conditionBase = `${betTitle} ${betDesc}`.trim().slice(0, 50);
    const condition =
      conditionBase.length > 0
        ? `pattern from "${conditionBase}" context`
        : `pattern from ${this.stageCategory} context`;

    try {
      const suggestion = this.deps.ruleRegistry.suggestRule({
        suggestedRule: {
          category: this.stageCategory,
          name: flavorName,
          condition,
          effect,
          magnitude: 0.3,
          confidence: 0.6,
          source: 'auto-detected',
          evidence: [decision.id],
        },
        triggerDecisionIds: [decision.id],
        observationCount: 1,
        reasoning: `Flavor "${flavorName}" had ${quality} outcome during ${this.stageCategory} stage.`,
      });
      suggestionIds.push(suggestion.id);
    } catch (err) {
      logger.warn(
        `Reflect: failed to generate rule suggestion for flavor "${flavorName}": ${err instanceof Error ? err.message : String(err)}`,
        { flavorName, effect },
      );
    }
  }

  return suggestionIds;
}
```

### 3b. Modify `reflect()`

Replace the no-op block:
```ts
// REMOVE:
const ruleSuggestions: string[] = [];
if (this.deps.ruleRegistry && flavorResults.length > 1) {
  // Future: analyze patterns... no-op
}

// REPLACE WITH:
const ruleSuggestions = this.generateRuleSuggestions(decisions, decisionOutcomes);
```

---

## Step 4 — Tests (`stage-orchestrator.test.ts`)

### 4a. Fix 1 broken test (MUST fix before adding new tests)

```ts
// Line ~182: was 4, becomes 5 (gap-assessment adds a record() call)
expect(deps.decisionRegistry.record).toHaveBeenCalledTimes(5);
```

### 4b. Add `makeRuleRegistry()` mock factory

```ts
function makeRuleRegistry(rules: StageRule[] = []): IStageRuleRegistry {
  return {
    loadRules: vi.fn(() => rules),
    addRule: vi.fn((input) => ({ ...input, id: randomUUID(), createdAt: new Date().toISOString() })),
    removeRule: vi.fn(),
    suggestRule: vi.fn((input) => ({
      ...input,
      id: randomUUID(),
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
    })),
    getPendingSuggestions: vi.fn(() => []),
    acceptSuggestion: vi.fn(),
    rejectSuggestion: vi.fn(),
  };
}
```

Also need: `import { randomUUID } from 'node:crypto'` and `import type { StageRule } from '@domain/types/rule.js'` and `import type { IStageRuleRegistry } from '@domain/ports/rule-registry.js'`.

### 4c. New describe block: `'run() — rule wiring (#103)'` (~12 tests)

Key scenarios:
- Boost rule with condition word in bet title → `matchReports[n].ruleAdjustments > 0`, score increased vs base
- Penalize rule → score decreased, clamped at 0
- Multiple boost rules on same flavor → adjustments stack additively
- Exclude rule matching condition → flavor absent from `selectedFlavors`
- Require rule matching condition → flavor present in `selectedFlavors` even if not top-scored
- Exclude wins over require when both match same flavor name
- Condition word in stageCategory → rule fires
- Condition word in artifact name → rule fires
- Condition with only stop words → rule does not fire
- No ruleRegistry → no crash, `ruleAdjustments: 0` in all match reports
- Matching rule name annotated in MatchReport reasoning string

### 4d. New describe block: `'run() — gap analysis (#104)'` (~7 tests)

Key scenarios:
- No vocabulary → `result.gaps` is `undefined` or empty array
- All vocab keywords covered by selected flavor name/description → empty gaps
- Vocab keyword in bet context + not covered by selected flavor → 1 GapReport with correct description
- First-third keyword by index → severity 'high'; middle-third → 'medium'; last-third → 'low'
- Unselected flavor name/description contains keyword → appears in `gap.suggestedFlavors`
- Keyword in vocabulary but NOT in bet context → no gap created
- Gap-assessment decision recorded: `decisionRegistry.record` called with `decisionType: 'gap-assessment'`

### 4e. New describe block: `'run() — reflect suggestions (#49 MVP)'` (~5 tests)

Key scenarios:
- Good outcome + ruleRegistry present → `reflection.ruleSuggestions` has 1 UUID; `ruleRegistry.suggestRule` called with `effect: 'boost'`
- No ruleRegistry → `reflection.ruleSuggestions` is empty, no crash
- Partial outcome (neither 'good' nor 'poor') → no suggestion generated
- `reflection.ruleSuggestions[0]` is the UUID returned by `suggestRule()`
- `ruleRegistry.suggestRule()` throws → non-fatal: empty suggestions, no crash

---

## Step 5 — Update `skill/orchestration.md`

- Remove all language describing rule wiring, gap analysis, reflect as "stub", "no-op", "infrastructure ready, not yet wired"
- Update the intelligence phases section to describe active behavior:
  - Rule condition matching: keyword extraction from `rule.condition` vs bet text + artifacts + stageCategory
  - Gap detection: vocabulary keyword coverage analysis in `planExecution()`, surfaced in `OrchestratorResult.gaps`
  - MVP reflect: analyzes `flavor-selection` decisions with good/poor outcomes, calls `ruleRegistry.suggestRule()`

---

## Implementation Order

```
Step 0 → Step 1 → run tests (V1 only, ~12 new pass) →
Step 2 → run tests (V2 added, fix broken test) →
Step 3 → run tests (V3 added) →
Step 4 (all tests green) →
Step 5 (skill doc update) →
/breadboard-reflection
```
