# Artifact Record Format — Examples

> Use `kata artifact record <run-id>` to record every file produced during a run.
> Always record artifacts when a step produces output — even for small files.

---

## Example 1: Step Artifact (Regular Work Output)

**Scenario**: The `compile` step in the `rust-compilation` flavor produced a build report.

```bash
# Create the artifact file
cargo build --release 2>&1 > /tmp/build-report.md

# Record it
kata artifact record "$RUN_ID" \
  --stage build \
  --flavor rust-compilation \
  --step compile \
  --file /tmp/build-report.md \
  --summary "Cargo build --release output: 0 errors, 2 warnings (unused import in auth.rs)"
```

**`--json` output**:
```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "stageCategory": "build",
  "flavor": "rust-compilation",
  "step": "compile",
  "fileName": "build-report.md",
  "filePath": "stages/build/flavors/rust-compilation/artifacts/build-report.md",
  "summary": "Cargo build --release output: 0 errors, 2 warnings",
  "type": "artifact",
  "recordedAt": "2026-02-25T10:45:00Z"
}
```

The file is copied to `.kata/runs/<run-id>/stages/build/flavors/rust-compilation/artifacts/build-report.md`.

---

## Example 2: Multi-Step Artifact Sequence

**Scenario**: A research flavor has two steps, each producing an artifact.

Step 1 — `scan`:
```bash
# Research step produces a findings document
cat > /tmp/oauth2-spec-notes.md << 'EOF'
# OAuth2 Spec Notes
...
EOF

kata artifact record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --step scan \
  --file /tmp/oauth2-spec-notes.md \
  --summary "Key OAuth2 RFC requirements: authorization code + PKCE flow, token rotation"
```

Step 2 — `analyze` (can reference prior artifacts via priorArtifacts in kata step next):
```bash
cat > /tmp/gap-analysis.md << 'EOF'
# PKCE Gap Analysis
Based on oauth2-spec-notes.md: existing passport-oauth2 v0.6.0 lacks PKCE support.
...
EOF

kata artifact record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --step analyze \
  --file /tmp/gap-analysis.md \
  --summary "PKCE gap: passport-oauth2 must be upgraded to >= 1.7.0"
```

---

## Example 3: Flavor Synthesis Artifact

**Scenario**: After all steps in a flavor complete, write a flavor-level summary.

```bash
cat > /tmp/flavor-synthesis.md << 'EOF'
# web-standards Flavor Synthesis

## Summary
OAuth2 authorization code flow with PKCE is the current best practice.
The critical gap: existing passport-oauth2 version does not support PKCE.

## Artifacts produced
- oauth2-spec-notes.md: Full spec notes
- gap-analysis.md: PKCE gap assessment
EOF

kata artifact record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --file /tmp/flavor-synthesis.md \
  --summary "web-standards research summary: PKCE gap identified" \
  --type synthesis
```

Note: `--step` is **omitted** for synthesis artifacts. The file is stored as `synthesis.md` in the flavor directory.

---

## Rules

| Rule | Reason |
|------|--------|
| Always use absolute or resolvable paths for `--file` | Kata resolves relative paths from `process.cwd()` |
| Write the file to disk before recording | Kata copies the file; the source must exist |
| Use `--step` for all regular artifacts | Required for `--type artifact` |
| Omit `--step` for `--type synthesis` | Synthesis artifacts are flavor/stage-level, not step-level |
| Keep `--summary` to 1–2 sentences | It appears in the artifact index used by future steps and cooldown |
| Record every file produced | The artifact index is the observability trail for self-improvement |

---

## Flags Reference

| Flag | Required | Notes |
|------|----------|-------|
| `<run-id>` | Yes | Positional argument |
| `--stage` | Yes | `research` \| `plan` \| `build` \| `review` |
| `--flavor` | Yes | Name of the flavor that produced this artifact |
| `--step` | Conditional | Required for `--type artifact`; omit for `--type synthesis` |
| `--file` | Yes | Path to the source file (must exist; absolute or relative to cwd) |
| `--summary` | Yes | Short description of the artifact's content |
| `--type` | No | `artifact` (default) or `synthesis` |
