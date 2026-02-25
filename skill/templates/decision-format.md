# Decision Record Format — Examples

> Use `kata decision record <run-id>` to record every orchestration judgment.
> Record decisions at the time of making them, not retroactively.

---

## Example 1: Flavor Selection Decision

**Scenario**: The orchestrator is in the `research` stage and must choose which flavors to run.

```bash
kata decision record "$RUN_ID" \
  --stage research \
  --type flavor-selection \
  --context '{
    "stageName": "research",
    "availableFlavors": ["web-standards", "internal-docs", "prior-art"],
    "betKeywords": ["oauth2", "login", "token"],
    "projectType": "typescript-node"
  }' \
  --options '["web-standards", "internal-docs", "prior-art"]' \
  --selected web-standards \
  --confidence 0.88 \
  --reasoning "Bet mentions OAuth2 specifically; web-standards flavor covers the RFC and PKCE spec. internal-docs is secondary and can run in parallel."
```

To select a second flavor (record a separate decision):
```bash
kata decision record "$RUN_ID" \
  --stage research \
  --type flavor-selection \
  --context '{
    "stageName": "research",
    "primaryFlavorAlreadySelected": "web-standards",
    "betKeywords": ["oauth2", "login", "token"]
  }' \
  --options '["internal-docs", "prior-art"]' \
  --selected internal-docs \
  --confidence 0.72 \
  --reasoning "internal-docs likely has an existing auth pattern we should not duplicate"
```

---

## Example 2: Capability Analysis Decision (Low Confidence)

**Scenario**: The orchestrator assesses whether the codebase has the capability needed for the bet. Confidence is low because the codebase was unfamiliar.

```bash
kata decision record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --type capability-analysis \
  --context '{
    "capability": "OAuth2 PKCE support",
    "evidenceFound": ["found passport-oauth2 in package.json", "no PKCE-specific code found"],
    "filesScanned": 12
  }' \
  --options '["capability-present", "capability-absent", "uncertain"]' \
  --selected uncertain \
  --confidence 0.55 \
  --reasoning "Found OAuth2 library but no PKCE implementation. Cannot confirm PKCE is supported without deeper code search."
```

This will create a **confidence gate** because 0.55 < 0.7 (default threshold). `kata step next --json` will return `status: "waiting"` until approved.

To bypass the gate (if the uncertainty is acceptable and you want to continue):
```bash
kata decision record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --type capability-analysis \
  --context '{"capability": "OAuth2 PKCE support", "evidenceFound": [...]}' \
  --options '["capability-present", "capability-absent", "uncertain"]' \
  --selected uncertain \
  --confidence 0.55 \
  --reasoning "..." \
  --yolo
```

---

## Decision Types Reference

| Type | When to Use |
|------|-------------|
| `flavor-selection` | Choosing which flavor(s) to run for a stage |
| `execution-mode` | Choosing parallel vs. sequential flavor execution |
| `capability-analysis` | Assessing whether a codebase has a required capability |
| `gap-assessment` | Identifying coverage gaps in the current flavor selection |
| `synthesis-approach` | How to combine flavor outputs into a stage synthesis |
| `skip-justification` | Why a step or flavor was skipped |

Unknown types are accepted with a warning — use descriptive names for novel decision categories.

---

## Fields Reference

| Flag | Type | Notes |
|------|------|-------|
| `--stage` | enum | `research` \| `plan` \| `build` \| `review` |
| `--flavor` | string? | Omit for stage-level decisions |
| `--step` | string? | Omit for flavor/stage-level decisions |
| `--type` | string | See table above |
| `--context` | JSON object | Snapshot of available information at decision time |
| `--options` | JSON string[] | All options considered (can be `'[]'` for assessment decisions) |
| `--selected` | string | The chosen option (must be in `--options` unless options is empty) |
| `--confidence` | 0-1 | Your confidence in this choice |
| `--reasoning` | string | Why you chose this option |
| `--yolo` | flag | Bypass confidence gate |
