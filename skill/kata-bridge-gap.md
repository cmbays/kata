# kata-bridge-gap — Recording and Resolving Gaps

> Gaps are friction points, missing capabilities, or knowledge holes captured during practice.
> Recording them turns ad-hoc frustration into structured improvement work.

---

## Recording a Gap

```bash
kata observe record \
  --type gap \
  --subject "No flavor for Rust async patterns" \
  --context "Needed async runtime selection during build stage, fell back to manual" \
  --stage build \
  --kataka "$KATAKA_ID"
```

Or via short form:
```bash
kata kansatsu record --type gap --subject "Missing X" --stage build
```

---

## Gap Fields

| Field | Required | Description |
|-------|----------|-------------|
| `--type gap` | Yes | Marks this observation as a gap |
| `--subject` | Yes | One-line description of the missing capability |
| `--context` | No | When/why you encountered it; what you had to do instead |
| `--stage` | No | Which stage category surfaced this gap |
| `--kataka` | No | Agent ID that encountered the gap |

---

## Querying Open Gaps

```bash
kata observe list --type gap --json
```

```json
[
  {
    "id": "...",
    "type": "gap",
    "subject": "No flavor for Rust async patterns",
    "stage": "build",
    "capturedAt": "2026-03-01T10:00:00.000Z"
  }
]
```

---

## Bridging a Gap

Gaps are bridged by creating new flavors, steps, or skill files:

1. **Create a flavor** for the missing capability:
   ```bash
   kata flavor create --name "rust-async" --stage build
   ```
2. **Add steps** to the new flavor:
   ```bash
   kata step create --stage build --name "select-async-runtime"
   ```
3. **Record resolution** with an observation:
   ```bash
   kata observe record \
     --type learning \
     --subject "Rust async: prefer tokio for web services" \
     --references-gap <gap-id>
   ```

---

## Gap Lifecycle

```
gap observed → flavor/step created → learning recorded → gap resolved
```

Gaps surface in `.kata/KATA.md` under `## Open Gaps` after each cooldown (Wave I).

---

## Quality Gate

The `--bridge-gaps` flag enforces a quality gate — execution is blocked until high-severity gaps are resolved. Medium/low gaps are captured as step-tier learnings and execution continues.

```bash
kata kiai build --bridge-gaps
# [kata] Blocked by 1 high-severity gap(s):
#   • Missing authentication layer
```

High-severity gaps indicate critical coverage problems. Resolve them by selecting additional flavors or adjusting your kata sequence before running again.

---

## Knowledge Capture

Gaps become `step`-tier learnings in the knowledge store automatically when `--bridge-gaps` is used. Each non-high-severity gap is recorded with:
- Tier: `step` (narrowest scope — specific to this execution context)
- Confidence: `0.6` (moderate — gap was identified by the orchestrator, not validated by outcome)
- Category: `gap-<hash>` (unique per gap description)

These learnings feed the belt system's `gapsIdentified` metric. Over time, consistently identified gaps can be promoted to `flavor` or `stage` tier through hierarchical promotion during cooldown.

---

## Full Lifecycle

Gap to Learning to Belt progression:

1. **Observe**: `kata observe record --type gap` — manually record a coverage gap
2. **Auto-detect**: `kata kiai <category>` — orchestrator identifies gaps during planning
3. **Bridge**: `kata kiai <category> --bridge-gaps` — quality gate check; high-severity gaps block execution
4. **Capture**: Medium/low gaps are captured as step-tier learnings
5. **Promote**: During `kata cooldown`, hierarchical promoter bubbles gap learnings up the tier hierarchy
6. **Belt**: Captured gaps contribute to `gapsIdentified` metric; closed gaps (via bridging) contribute to `gapsClosed` on the belt system
