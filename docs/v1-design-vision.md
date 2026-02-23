# Kata v1 Design Vision

Brainstormed 2026-02-23. This captures the agreed-upon architectural direction for Kata v1.

## Core Thesis

Kata separates **deterministic structure** (steps, gates, artifacts, configs) from **non-deterministic judgment** (orchestrators deciding how to compose and sequence that structure). The Decision log bridges them — making non-deterministic choices visible, measurable, and learnable.

## Three-Tier Execution Hierarchy

### Stage (fixed enum, not user-editable)
- **Research, Plan, Build, Review, Wrap-up** (5 core stages)
- Each has a specific orchestrator type (research engine, planning engine, etc.)
- Entry/exit gates govern macro flow between modes of work
- Produces a synthesis artifact as one-to-one handoff to next stage
- A stage is a **mode of work** — fundamentally different type of activity

### Flavor (user-configurable, composable)
- Named composition of steps in a defined order within a stage
- Users create, edit, share flavors
- Multiple flavors can run within a single stage (parallel or sequential, per orchestrator)
- Steps can be reused across multiple flavors (many-to-many)
- Supports **hierarchical overrides**: step defines defaults, flavor can override a scoped set of properties (human approval, confidence thresholds, timeouts). Gate conditions and artifact requirements are NOT overridable.
- Users can **pin** always-run flavors or **exclude** flavors per stage per project
- Examples: "UI feature planning" flavor = [shaping, breadboarding, impl-planning]. "Data model planning" = [schema-design, migration-planning, impl-planning]

### Step (user-configurable, reusable — what we call "Stage" today)
- Atomic unit of work with entry gates, exit gates, artifacts, human approval, resources
- Reusable across flavors
- One-to-one handoff between steps within a flavor
- All existing gate evaluation, artifact validation, hooks, YOLO mode, confidence tracking stays here
- Current Stage schema, CLI commands (create, edit, delete, rename) carry over as Step layer

## Artifact Scoping Rules
- Within a flavor, a step can reference artifacts from **preceding steps in that flavor**
- A step can reference the **stage-level input artifact** (handoff from prior stage)
- A step **cannot** reference artifacts from other flavors running in parallel
- Flavors are independent; cross-flavor aggregation happens only at synthesis

## Flavor Validation
- DAG validation on save: each step's entry gate requirements must be satisfiable by exit gates of preceding steps or stage-level input
- Clear error messages: "Step X requires artifact Y which is produced by step Z, but Z is not included or is ordered after X in this flavor"

## Stage Orchestrator
- Not just a flavor selector — the intelligence layer that makes decisions
- Built-in orchestrator prompt per stage type that:
  1. Receives incoming context (bet, prior stage artifacts, project metadata)
  2. Reviews available flavors and descriptions
  3. Reviews past decisions and outcomes for similar contexts (from learning system)
  4. Makes and logs flavor selection decisions with reasoning and confidence
  5. Determines parallel vs sequential via step dependency analysis
  6. After flavors complete, drives synthesis
- v1: LLM-driven decisions, minimal config (available flavors, pins/exclusions, confidence threshold for human intervention)

## Synthesis (Automatic, Not User-Configured)
- After orchestrator launches N flavors, each flavor's final step must produce a synthesis-ready artifact (enforced by exit gate)
- Stage synthesis is built-in: collects N flavor artifacts, produces stage-level handoff
- Synthesis step checks: count of artifacts matches count of launched flavors
- Users don't need to configure or be aware of synthesis mechanics

## Decision as First-Class Domain Concept
- Logged at orchestrator level (and potentially at step level for non-trivial choices)
- Decision record captures:
  - **Context**: what information was available (bet, artifacts, project type)
  - **Options**: what choices were possible (available flavors, parallel vs sequential)
  - **Selection**: what was chosen and reasoning
  - **Confidence**: system's confidence in the choice
  - **Outcome**: how it turned out (filled in post-facto — artifact quality, gate results, rework)
- Primary input to the self-improvement / learning system
- Enables observability: dashboard shows decisions, confidence levels, flagged items
- Learning extraction analyzes decision quality over time, not just pass/fail

## Cooldown as Pipeline
- Pipeline gets a `kind` field: `execution` vs `cooldown`
- Cooldown pipeline's entry gate: new `cycle-complete` condition (all execution pipelines in cycle are done)
- Two stages in cooldown pipeline:
  1. **Reflection / Wrap-up**: bet outcomes, learnings, artifact review
  2. **Epic Crafting / Betting**: shapes bets for next cycle, produces bet artifacts
- Cooldown output = N bet artifacts → each bet seeds a pipeline in the next cycle (1:1 mapping)
- Cooldown bridges cycles rather than belonging to one

## Pipeline as DAG (Design For, Not v1 Implementation)
- Default stage ordering: research → plan → build → review → wrap-up (linear)
- Model as a DAG from the start to enable future stage cycling (e.g., plan → research → plan → build)
- Future: pipeline-level orchestrator can rearrange stage DAG based on epic needs
- Budget constraints (token/time) would govern how many cycles are allowed
- v1: linear flows only, but data model supports DAG

## Mapping from Current Codebase
- Current `Stage` schema → becomes **Step**
- Current `StageType` enum → may need expansion or opening (relates to issue #17)
- Current flavor concept (informal variant JSONs) → becomes first-class **Flavor** entity (ordered composition of steps)
- Current `Pipeline` → add `kind` field, stages become the new macro Stage enum
- Current `CooldownSession` → refactored as a cooldown pipeline with stages
- New schemas needed: **Stage** (enum + orchestrator config), **Flavor** (step composition + overrides), **Decision** (context, options, selection, confidence, outcome)
- New gate condition: `cycle-complete`

## Build Stage Philosophy
- Lightest-touch stage — Kata's primary value is in research, planning, and review
- Entry gate: solid implementation plan from planning stage
- Exit gate: PR-ready state with passing tests
- Internal orchestration is mostly "hand this to Claude Code / build tools"
- Mini-reviews within build waves before proceeding
- Final holistic review is a separate Review stage, not part of Build

## Self-Improvement Loop
- Decision logs are the primary input (richer than just execution history)
- Orchestrator flavor selection improves over time based on decision-outcome analysis
- Learnings feed back into orchestrator prompts for future decisions
- Low-confidence decisions and below-threshold items get surfaced in wrap-up for human review
- YOLO mode: bypasses human approval but logs confidence levels for post-hoc review
