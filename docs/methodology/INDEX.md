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
| `learnings-synthesis.md` | 5-dimension pattern extraction from build cycles | `ma` / cooldown stage |

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
| `execution-manifest-template.yaml` | YAML manifest structure for pipeline execution |

### `how-we-work.md` — Project Development Process

How the kata project itself is built: Shape Up workflow, GitHub PM, deployment model, automation trajectory.
