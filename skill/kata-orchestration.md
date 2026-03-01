# kata-orchestration — Running Stage Orchestration

> How to drive kata's kiai (execute) system: stage categories, flavor selection, and pipeline execution.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| **gyo** (stage) | A category of work: `research`, `plan`, `build`, `review` |
| **ryu** (flavor) | A named composition of steps registered for a stage |
| **kiai** (execute) | The orchestration command — selects and runs flavors |
| **kime** (decision) | A recorded flavor-selection decision with confidence score |
| **kataka** | The agent driving the run, identified by `--kataka <id>` |

---

## Running a Single Stage

```bash
kata kiai <category>
# e.g.
kata kiai build
kata kiai research
```

**With options**:
```bash
kata kiai build \
  --ryu typescript-feature \    # pin a specific flavor
  --kataka "$KATAKA_ID" \       # attribute this run to your kataka
  --dry-run                     # preview without persisting artifacts
```

**Pipeline (multiple stages)**:
```bash
kata kiai research plan build review
```

---

## Flags

| Flag | Description |
|------|-------------|
| `--ryu <flavor>` | Pin a specific flavor (repeatable) |
| `--kataka <id>` | Attribute the run to a registered kataka |
| `--gyo <stages>` | Inline comma-separated stage list |
| `--kata <name>` | Load a saved stage sequence |
| `--save-kata <name>` | Save a successful run as a named kata |
| `--dry-run` | Preview selection without persisting artifacts |
| `--yolo` | Skip confidence gate checks — all decisions proceed without approval |
| `--json` | Machine-readable output |

---

## Saved Katas

```bash
kata kiai build review --save-kata feature-ship   # save a sequence
kata kiai --kata feature-ship                      # replay it
kata kiai --list-katas                             # see all saved
kata kiai --delete-kata feature-ship               # remove one
```

Kata names cannot contain `/`, `\`, or `..`.

---

## Reading Orchestration Output

```json
{
  "stageCategory": "build",
  "executionMode": "intelligent",
  "selectedFlavors": ["typescript-feature"],
  "decisions": [
    {
      "decisionType": "flavor-selection",
      "selection": "typescript-feature",
      "confidence": 0.92
    }
  ],
  "stageArtifact": { "name": "build-artifact", "value": {} }
}
```

Decisions with `confidence < 0.7` (the default threshold) trigger a confidence gate that requires human approval unless `--yolo` is set.

---

## Checking Status After a Run

```bash
kata kiai status    # recent artifacts
kata kiai stats     # analytics by stage
kata kiai stats --category build
```
