# Methodology Reference

Source material for kata's built-in stages, prompt templates, and methodology model.

## Directory Structure

### `skills/` — Core Methodology Specifications (Ready to Use)

Fully generic methodology definitions. No project-specific content. These are the
primary source material for kata's 8 built-in stage prompt templates.

| File | Covers | Used By (kata stage) |
|------|--------|---------------------|
| `shaping.md` | R x S methodology, fit checks, spikes, parts notation | `shape` stage |
| `breadboarding.md` | Places, affordances, wiring, slicing | `breadboard` stage |
| `breadboard-reflection.md` | Naming test, smell taxonomy, wiring verification | QA gate between breadboard → plan |

### `reference/` — Quick-Reference Cards (Ready to Use)

Compact notation tables and concept summaries.

| File | Covers |
|------|--------|
| `shaping-concepts.md` | Shaping notation, status values, fit check rules |
| `breadboarding-concepts.md` | Breadboarding element catalog, wiring conventions |
| `app-flow-standard.md` | Application flow documentation template |

### `templates/` — Artifact Templates (Ready to Use)

Markdown scaffolds for methodology artifacts.

| File | Produces |
|------|----------|
| `frame-template.md` | Frame document (Source/Problem/Outcome) |
| `shaping-template.md` | Shaping document (Requirements/Shapes/Fit Check/Decisions) |
| `breadboard-template.md` | Breadboard document (Places/Affordances/Wiring/Slices) |

### `adapt/` — Methodology Patterns (Generic)

Reusable methodology patterns adapted for general use. All project-specific
references have been removed.

| File | Pattern |
|------|---------|
| `implementation-planning.md` | Wave/manifest model, session prompt design |
| `build-session-protocol.md` | 7-phase completion protocol (build → review → merge → wrap-up) |
| `review-orchestration.md` | 6-stage quality gate pipeline, risk scoring, gap detection |
| `vertical-discovery.md` | Research + user interview framework, journey mapping |
| `cool-down.md` | Harvest-synthesize-shape-bet retrospective |
| `pre-build-interrogator.md` | 6-dimension exhaustive questioning |
| `feature-strategy.md` | Feature framework typology (7 lenses), phased planning |
| `doc-sync.md` | Documentation drift detection pattern |
| `learnings-synthesis.md` | 5-dimension pattern extraction from build cycles |
| `how-we-work.md` | Shape Up philosophy, pipeline types, automation levels |
| `agents-architecture.md` | Agent design principles, orchestration patterns, handoff protocol |
| `execution-manifest-template.yaml` | YAML manifest structure for build sessions |
| `impl-plan-template.md` | Implementation plan markdown structure |
| `merge-checklist-template.md` | Pre-merge verification checklist |
