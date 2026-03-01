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
