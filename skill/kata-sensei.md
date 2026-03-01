# kata-sensei — The Meta-Orchestrator

> Sensei (先生) coordinates multi-stage pipelines, passing artifacts between stages and synthesizing pipeline-level learnings.

---

## What Sensei Does

The sensei (MetaOrchestrator) activates when `kata kiai` receives more than one stage category:

```bash
kata kiai research plan build review
```

For each stage in sequence, sensei:
1. Loads available flavors for that category
2. Builds an OrchestratorContext with artifacts from all prior stages
3. Creates and runs the stage-level orchestrator
4. Accumulates stage artifacts for the next stage
5. After all stages complete, runs a pipeline-level reflect phase

---

## Stage Handoff

Artifacts from stage N are passed as `availableArtifacts` to stage N+1. This lets the build orchestrator know that a `plan-artifact` exists, influencing flavor selection.

---

## Pipeline Output

```json
{
  "stageResults": [
    { "stageCategory": "research", "selectedFlavors": ["..."], ... },
    { "stageCategory": "plan",     "selectedFlavors": ["..."], ... }
  ],
  "pipelineReflection": {
    "overallQuality": "high",
    "learnings": ["..."]
  }
}
```

---

## Confidence Gates in Pipelines

Each stage runs with `confidenceThreshold: 0.7` by default. Low-confidence decisions pause the pipeline for human approval.

Use `--yolo` to skip all confidence gates across the entire pipeline:

```bash
kata kiai research plan build --yolo
```

---

## Using Sensei as an Agent

When you receive a bet and need to run a full pipeline:

```bash
kata kiai research plan build review \
  --kataka "$KATAKA_ID" \
  --bet '{"title":"Add OAuth2 login","appetitePercent":30}' \
  --json
```

Parse the JSON output to extract `stageResults[].stageArtifact` for synthesis.
