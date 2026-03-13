# kata-synthesis — LLM Synthesis of Cycle Learnings

> How to drive kata's synthesis pipeline: preparing a synthesis input, running LLM analysis, and completing a cycle with accepted proposals.

---

## Core Concepts

| Term | Meaning |
|------|---------|
| **ma** (cooldown) | Post-cycle reflection phase. Produces a report, proposals, and a synthesis input. |
| **synthesis input** | A JSON file at `.kata/synthesis/pending-<id>.json` containing observations, learnings, and cycle metadata — ready for LLM review. |
| **synthesis result** | A JSON file at `.kata/synthesis/result-<id>.json` written by the LLM, containing proposals for the knowledge store. |
| **proposal** | One suggested knowledge action: `new-learning`, `update-learning`, `promote`, `archive`, or `methodology-recommendation`. |
| **synthesis depth** | Controls observation and learning breadth: `quick` (top 10 obs, confidence > 0.5), `standard` (all obs, confidence > 0.3), `thorough` (everything including archived). |

---

## The Two-Phase Cooldown

The cooldown command now supports an explicit two-phase workflow:

### Phase 1 — Prepare

```bash
kata ma --prepare [cycle-id]
# or
kata cooldown --prepare [cycle-id]
```

This:
1. Collects bet outcomes and run observations for the cycle
2. Generates a cooldown report and next-cycle proposals
3. Writes a `pending-<id>.json` synthesis input file
4. Transitions the cycle to `cooldown` state (not yet `complete`)
5. Prints the path to the synthesis input file

Use `--depth` to control synthesis breadth:

```bash
kata ma --prepare [cycle-id] --depth thorough
```

### Phase 2 — Complete

After the LLM has written a `result-<id>.json` alongside the pending file:

```bash
kata ma complete <cycle-id> \
  --synthesis-input <id> \
  --accepted proposal-id-1,proposal-id-2
```

This:
1. Reads the synthesis result file
2. Applies accepted proposals to the knowledge store
3. Transitions the cycle to `complete`

### One-Shot (Legacy)

The original `kata ma [cycle-id]` (no `--prepare`) runs prepare + immediate complete in a single pass, with no LLM synthesis step.

---

## Automated Synthesis with --yolo

The `--yolo` flag runs the full prepare + LLM call + complete pipeline automatically:

```bash
kata ma --yolo [cycle-id]
```

This:
1. Runs `prepare` to generate the synthesis input
2. Invokes `claude --print` with the synthesis input as context
3. Parses the LLM JSON response as a `SynthesisResult`
4. Auto-accepts proposals with confidence > 0.8
5. Calls `complete` with the accepted proposal IDs

Useful for unattended pipeline runs. Review the accepted proposals afterward with `kata bunkai query`.

---

## Managing Knowledge Proposals

### View learnings after synthesis

```bash
kata bunkai query
# with filters
kata bunkai query --tier stage --category architecture
kata bunkai query --min-confidence 0.8
```

### Archive a learning (soft-delete)

```bash
kata bunkai archive <learning-id>
kata bunkai archive <learning-id> --reason "Replaced by newer approach"
```

The learning is retained in the store for provenance but excluded from future synthesis inputs (unless `--depth thorough`).

### Promote a learning's permanence

```bash
kata bunkai promote <learning-id> --permanence operational
kata bunkai promote <learning-id> --permanence strategic
kata bunkai promote <learning-id> --permanence constitutional
```

Permanence levels control how aggressively a learning is included in prompts:

| Level | Meaning |
|-------|---------|
| `operational` | Task-level guidance — always included for the relevant step |
| `strategic` | Cycle-level wisdom — included in cooldown and planning stages |
| `constitutional` | Agent-level axioms — always in the system prompt |

---

## Synthesis Proposal Types

| Type | What it does |
|------|-------------|
| `new-learning` | Captures a new pattern into the knowledge store |
| `update-learning` | Updates content and/or adjusts confidence of an existing learning |
| `promote` | Moves a learning to a higher tier (`step` → `flavor` → `stage` → `category` → `agent`) |
| `archive` | Soft-deletes a learning with a reason |
| `methodology-recommendation` | Logs a methodology suggestion (no knowledge store mutation) |

Each proposal must include at least 2 citations (observation or learning UUIDs) as evidence.

---

## Synthesis Input Format

The file at `.kata/synthesis/pending-<id>.json` contains:

```json
{
  "id": "<uuid>",
  "cycleId": "<uuid>",
  "cycleName": "Wave I",
  "createdAt": "<iso-datetime>",
  "depth": "standard",
  "tokenBudget": 75000,
  "tokensUsed": 42300,
  "observations": [...],
  "learnings": [...]
}
```

The LLM agent should read this file and produce a result file.

---

## Synthesis Result Format

The LLM writes `.kata/synthesis/result-<id>.json` (where `<id>` matches the input `id`):

```json
{
  "inputId": "<same-uuid>",
  "proposals": [
    {
      "id": "<uuid>",
      "type": "new-learning",
      "confidence": 0.87,
      "citations": ["<obs-uuid>", "<obs-uuid>"],
      "reasoning": "Observed this pattern in 3 separate runs",
      "createdAt": "<iso-datetime>",
      "proposedContent": "Always validate schema at system boundaries",
      "proposedTier": "stage",
      "proposedCategory": "architecture"
    }
  ]
}
```

---

## Tier Promotion Rules

Tier promotions are one-directional (no demotion allowed):

```
step → flavor → stage → category → agent
```

Attempting to promote to the same tier or a lower tier throws `INVALID_TIER_PROMOTION`.

---

## JSON Output

All synthesis-related commands support `--json`:

```bash
kata ma --prepare [cycle-id] --json
kata bunkai archive <id> --json
kata bunkai promote <id> --permanence operational --json
```

---

## Files Written

| Path | When | Content |
|------|------|---------|
| `.kata/synthesis/pending-<id>.json` | `kata ma --prepare` | `SynthesisInput` |
| `.kata/synthesis/result-<id>.json` | LLM agent | `SynthesisResult` |
| `.kata/history/<cycle-id>-diary.json` | `kata ma complete` | Cooldown diary entry |
