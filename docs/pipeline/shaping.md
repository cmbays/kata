---
shaping: true
---

# Methodology Engine — Shaping

## Requirements (R)

| ID   | Requirement                                                      | Status    |
| ---- | ---------------------------------------------------------------- | --------- |
| R0   | Encode development methodology as executable, composable stages  | Core goal |
| R1   | Stages have entry gates, exit gates, artifact schemas, and learning hooks | Must-have |
| R2   | Pipelines are ordered compositions of stages (reusable, reorderable, repeatable stages) | Must-have |
| R3   | Cycles are budget-bounded compositions of pipelines across projects (Shape Up betting model) | Must-have |
| R4   | Self-improving knowledge system captures and feeds back learnings | Must-have |
| R5   | Null-state onboarding — works with zero config, built-in stage templates are self-sufficient | Must-have |
| R6   | Execution-layer agnostic — produces manifests, doesn't manage agent lifecycle | Must-have |
| R7   | Dashboard/UI for visualizing pipelines, stages, stats, and methodology configuration | Nice-to-have |
| R8   | JSON-first configuration with `$ref` support for prompt templates | Must-have |

### R0: Encode development methodology as executable, composable stages

The core abstraction is the **Stage** — an atomic unit of methodology with defined inputs,
outputs, quality gates, and learning capture. Stages are the building blocks that compose
into pipelines. The system ships with built-in stages inspired by Shape Up (research,
interview, shape, breadboard, plan, build, review, wrap-up) but supports custom stages.

### R1: Stages have entry gates, exit gates, artifact schemas, and learning hooks

Each stage defines:
- **Entry gate**: preconditions (artifacts exist, human approves, predecessor complete)
- **Exit gate**: postconditions (artifact produced, quality threshold met)
- **Artifact schema**: Zod-validated output structure
- **Learning hooks**: what knowledge to capture on completion
- **Prompt template**: self-sufficient instructions (the null-state execution path)
- **Skill refs**: optional skill/agent enhancements
- **Stage variants (flavors)**: same container, different content (e.g., research →
  competitive-analysis, domain-research, repo-exploration)

### R2: Pipelines are ordered compositions of stages

A pipeline is a named sequence of stage instances. The same stage type can appear multiple
times. Built-in pipeline types: `vertical`, `bug-fix`, `polish`, `spike`, `cooldown`.
Users define custom pipeline types by composing stages.

Pipeline metadata links to external tracking (issue/epic IDs, project refs).

### R3: Cycles are budget-bounded compositions of pipelines across projects

A cycle is a Shape Up-inspired betting period:
- **Budget**: token estimate and/or time box
- **Bets**: epics/initiatives from various projects, each with an appetite (portion of budget)
- **Strategy pipeline**: opens the cycle (evaluate roadmap, select bets)
- **Work pipelines**: the actual building (one or more per bet)
- **Cooldown pipeline**: closes the cycle (retrospective, learning synthesis, next-cycle proposal)

Bets within a cycle should be independent. The system warns on cross-bet dependencies
(methodology smell) and suggests: combine into one bet, sequence across cycles, or decouple.

Multiple cycles may be needed to complete a project. Projects have dependency graphs that
inform which epics are available to bet on. The cooldown phase evaluates:
- What did this cycle unblock?
- What was discovered that requires pivot or reprioritization?
- What can we bet on in the next cycle?

### R4: Self-improving knowledge system

Three-tier learning model:

| Tier | Scope | Loading | Example |
| ---- | ----- | ------- | ------- |
| **Tier 1: Stage-level** | Applies to all instances of a stage type | Automatic on stage entry | "Research stages produce better output when starting with competitor analysis before domain research" |
| **Tier 2: Category** | Applies within a stage flavor or skill domain | Subscription-based | "Competitive analysis findings are more actionable when structured as feature-gap matrices" |
| **Tier 3: Agent-specific** | Personal behavioral patterns | Always loaded for that agent | "This agent tends to over-scope during shaping — remind to constrain appetite" |

Context lifecycle: load learnings on stage entry → work stage → capture raw learnings on
stage exit → flush context → load fresh learnings for next stage.

In null state: base agent subscribes to all Tier 1 learnings for the current stage.

Knowledge graph backing (future): nodes = concepts/decisions/patterns, edges = enables/
contradicts/refines/depends-on. KB renders as human-readable view of the graph.

### R5: Null-state onboarding

The tool must work from zero configuration:
- Install package → run init → get built-in Shape Up stages and pipeline templates
- Each built-in stage template is a self-sufficient prompt — no agents or skills required
- The system detects what capabilities are available ("You have no research agent — the
  built-in template will guide you, or you can create a specialized agent")
- Progressive enhancement: null state → custom flavors → registered skills → knowledge
  accumulation → self-improving loop → agent lifecycle integration

### R6: Execution-layer agnostic

The methodology engine produces **execution manifests** — structured documents describing
what to do, not how to run an agent. Adapters translate manifests into execution:
- `ClaudeCliAdapter`: opens Claude with the manifest as prompt (null state)
- `ComposioAdapter`: calls `ao spawn` with manifest context
- `ManualAdapter`: prints instructions for human execution
- Custom adapters: any tool that can consume a JSON manifest

The engine consumes **execution results** — artifacts produced, learnings captured, metrics
(tokens, time). It never spawns processes, manages worktrees, or monitors agent health.

### R7: Dashboard/UI

Visualization of the methodology system:
- Pipeline and stage registry (what's defined, what's available)
- Cycle history (bets, outcomes, budget utilization)
- Stage variant browser (flavors, associated skills/agents)
- Execution stats (pipeline frequency, stage success rates)
- Self-improvement timeline (how learnings have changed stage prompts over time)
- Configuration editor (stage gates, artifact schemas, prompt templates)

Deferred to Phase 5 of build. Could be web (Next.js), TUI (Ink), or both.

### R8: JSON-first configuration

All machine-readable artifacts use JSON:
- Stage definitions, pipeline templates, cycle configs
- `$ref` support for prompt templates (JSON structure references `.md` files for long-form content)
- Zod schemas validate all config at load time
- No YAML — JSON is unambiguous for LLM parsing and programmatic manipulation

---

## A: Methodology Engine as TypeScript Library + CLI

A standalone npm package providing the methodology engine as a library (importable API)
with a CLI wrapper for interactive use.

### Parts

| Part   | Mechanism                                                        | Flag |
| ------ | ---------------------------------------------------------------- | :--: |
| **A1** | **Core Domain Types** — Zod schemas for Stage, Pipeline, Cycle, Gate, Artifact, Bet, Learning. All types derived via `z.infer<>`. | |
| **A2** | **Stage Registry** — Register, query, and resolve stages by type and flavor. Built-in Shape Up stages ship as defaults. Custom stages registered at runtime or via config. | |
| **A3** | **Pipeline Composer** — Validate stage ordering, produce pipeline definitions from stage sequences. Enforce gate compatibility (stage N exit gate satisfies stage N+1 entry gate). | |
| **A4** | **Cycle Manager** — Create/manage cycles with budget constraints. Track bets, map pipelines to bets. Warn on cross-bet dependencies. Produce cycle proposals during cooldown. | |
| **A5** | **Execution Manifest Builder** — Compose stage prompt template + context + learnings into execution manifest JSON. Resolve `$ref` prompt files. Attach artifact schemas and gate definitions. | |
| **A6** | **Execution Adapter Interface** — Port interface for execution backends. Built-in `ClaudeCliAdapter` (null state), `ManualAdapter` (print instructions). `ComposioAdapter` as optional integration. | |
| **A7** | **Knowledge Store** — JSON-file-backed storage for learnings (3 tiers). Stage-entry loading, stage-exit capture. Category-based subscriptions. Agent memory resolution. | |
| **A8** | **Self-Improving Loop** — Extract patterns from execution results across pipeline runs. Surface learning suggestions (new Tier 1/2 learnings). Update stage prompt templates when confidence threshold met. | |
| **A9** | **CLI** — Commands: `init`, `stage list/create/inspect`, `pipeline define/start/status`, `cycle new/bet/cooldown`, `knowledge query/stats`. Commander.js or similar. | |

### Architecture

```
src/
  domain/                    # Core domain — zero dependencies
    types/                   # Zod schemas: stage, pipeline, cycle, gate, artifact, bet, learning
    services/                # Pipeline composer, cycle manager, manifest builder
    rules/                   # Gate evaluation, dependency validation, budget constraints

  infrastructure/            # Adapters and persistence
    registries/              # Stage registry, pipeline registry, skill registry
    knowledge/               # Knowledge store (JSON files), learning extraction
    execution/               # Execution adapters (ClaudeCliAdapter, ManualAdapter, ComposioAdapter)
    config/                  # JSON config loader with $ref resolution

  features/                  # Use cases / application services
    init/                    # Project initialization, null-state detection
    pipeline-run/            # Pipeline traversal, stage transition, gate checking
    cycle-management/        # Cycle CRUD, betting, cooldown, proposals
    self-improvement/        # Learning analysis, prompt update suggestions

  shared/                    # Cross-cutting
    lib/                     # Utilities, logger, validators

  cli/                       # CLI entry points (thin wrappers over features)
```

Domain-driven design with clean architecture layers. Same architectural discipline as
Screen Print Pro but purpose-built for a TypeScript library/CLI (not a web app).

### Built-in Stage Templates (Shape Up Default Set)

| Stage Type   | Purpose | Key Artifacts | Gate Pattern |
| ------------ | ------- | ------------- | ------------ |
| `research`   | Investigate problem space, competitors, prior art | research-summary.json | Entry: epic/issue defined → Exit: summary produced |
| `interview`  | Gather user needs, pain points, priorities | interview-notes.json | Entry: research complete → Exit: needs documented |
| `shape`      | Define requirements (R) and solution shapes (S) | frame.json, shaping.json | Entry: interview done → Exit: shape selected, no ⚠️ flags |
| `breadboard` | Map affordances, wiring, vertical slices | breadboard.json | Entry: shape selected → Exit: slices defined |
| `plan`       | Produce execution manifest with waves | manifest.json | Entry: breadboard done → Exit: waves defined, dependencies mapped |
| `build`      | Execute implementation work | PR URL, test results | Entry: manifest ready → Exit: PR created, tests pass |
| `review`     | Quality gate — code review, design audit, security check | review-findings.json | Entry: PR created → Exit: findings addressed |
| `wrap-up`    | Retrospective, KB entry, learning extraction | kb-entry.json, learnings.json | Entry: review complete → Exit: learnings captured |

Each template includes a self-sufficient prompt that guides any LLM through the stage
without requiring specialized agents or skills.

### Null-State Experience Flow

```
1. npm install -g methodology-engine
2. cd my-project
3. me init
   → Detects: git repo, no agents, no skills, no config
   → Creates: .methodology/ directory with defaults
   → Ships: 8 built-in stages, 5 pipeline templates

4. me cycle new
   → Budget prompt (tokens/time)
   → Bet selection (link issues or describe epics)
   → Creates cycle with strategy pipeline

5. me pipeline start <pipeline-id>
   → Traverses stages sequentially
   → At each stage: load learnings → present manifest → gate check
   → ClaudeCliAdapter: opens Claude with stage prompt + context
   → Or: prints manifest for manual execution

6. me pipeline status
   → Shows current stage, gate status, artifacts produced

7. Stage completion triggers:
   → Exit gate validation (artifacts exist, schema valid)
   → Learning capture (what worked, what didn't)
   → Advance to next stage (or block at gate)
```

### Stage Variant Architecture

Stage types have flavors — same gates and hooks, different content:

```json
{
  "type": "research",
  "flavor": "competitive-analysis",
  "promptTemplate": { "$ref": "./prompts/research/competitive-analysis.md" },
  "entryGate": { "conditions": ["epic-defined"] },
  "exitGate": { "artifacts": ["research-summary"] },
  "learningHooks": ["research-quality", "domain-insights"],
  "config": {
    "focusAreas": ["feature-gaps", "pricing-models", "ux-patterns"],
    "outputFormat": "feature-gap-matrix"
  }
}
```

Built-in flavors ship with the package. Users create custom flavors by providing a prompt
template and optional config overrides.

---

## Fit Check

| Req | Requirement                                                     | Status    | A   |
| --- | --------------------------------------------------------------- | --------- | --- |
| R0  | Encode development methodology as executable, composable stages | Core goal | ✅  |
| R1  | Stages have entry gates, exit gates, artifact schemas, and learning hooks | Must-have | ✅  |
| R2  | Pipelines are ordered compositions of stages                    | Must-have | ✅  |
| R3  | Cycles are budget-bounded compositions of pipelines across projects | Must-have | ✅  |
| R4  | Self-improving knowledge system captures and feeds back learnings | Must-have | ✅  |
| R5  | Null-state onboarding                                           | Must-have | ✅  |
| R6  | Execution-layer agnostic                                        | Must-have | ✅  |
| R7  | Dashboard/UI for visualizing methodology                        | Nice-to-have | ✅  |
| R8  | JSON-first configuration with `$ref` support                    | Must-have | ✅  |

**Notes:**
- Single shape (A) presented — this is a greenfield product with a clear architecture.
  No competing shapes because the domain model was thoroughly explored during research.
  The interesting decisions are at the component level (A7 knowledge backing, A8 self-improving
  mechanics), not at the top-level shape.

**Selected shape: A**

---

## Decision Points Log

| #  | Decision                              | Resolution                    | Reasoning |
| -- | ------------------------------------- | ----------------------------- | --------- |
| D1 | Build vs. fork Composio               | Build own, compose with Composio | Composio solves agent lifecycle; we solve methodology. Different concerns. Composable architecture. |
| D2 | TypeScript vs. enhance bash           | TypeScript                    | Type safety for complex domain model, testability, publishable as npm package, same lang as Composio + existing app. |
| D3 | YAML vs. JSON for configs             | JSON with `$ref` for prompts  | JSON is unambiguous for LLM parsing. `$ref` to `.md` files preserves human authoring for long-form content. |
| D4 | Template repo from print-4ink         | Build fresh, extract template later | Library/CLI has different project structure than Next.js app. Same architectural principles, different scaffolding. Extract template after two proven projects exist. |
| D5 | Bet dependencies within cycles        | Warn, don't block             | Shape Up says bets should be independent. System warns on cross-bet dependencies (methodology smell) and suggests combining, sequencing, or decoupling. Override with acknowledgment. |
| D6 | Knowledge base vs. knowledge graph    | Knowledge graph (JSON-backed initially) | Graph enables richer queries and relationship tracking. KB becomes human-readable view rendered from graph. Start with JSON files, interface allows future migration to Neo4j/similar. |
| D7 | Agent memory model                    | Category-based subscriptions  | Agents subscribe to learning categories. Tier 1 (stage) auto-loads. Tier 2 (category) via subscription. Tier 3 (personal) always loaded. Composable without tight coupling. |
| D8 | Null-state vs. require setup          | Null-state first              | Built-in stage templates are self-sufficient. No agents/skills required. Progressive enhancement from Level 0 (just templates) to Level 5 (full lifecycle integration). |
| D9 | Separate repo vs. monorepo with print-4ink | Separate repo              | Clean API boundaries, independent versioning, generalizable from day one, own test suite and CI. |
| D10 | Methodology framework                | Shape Up v1, extensible later | Shape Up's cycle/bet/cooldown maps directly to our domain. System designed to support other frameworks by swapping built-in stage sets and pipeline templates. |
| D11 | Knowledge graph backing               | JSON files v1, Graphology v2+ | 70% of queries are simple filters. Only 2-3 need graph traversal. JSON files are debuggable, zero-dep, trivially testable. Interface abstracts backend for future swap. |
| D12 | Knowledge vs. skills graph            | Separate graphs, typed cross-refs | Different node types (learnings vs capabilities), lifecycles (continuous growth vs stable), and query patterns. Cross-referenced via foreign keys, not merged. |
| D13 | Token budget approach                 | Track actuals first, estimate later | No historical data at null state. Read Claude JSONL files post-execution. Build estimates from accumulated averages in v2. Budget = constraint (appetite), not hard stop. |
| D14 | CLI framework                         | Commander.js + @inquirer/prompts | Execution adapters are config-based (domain layer), not CLI plugins. Eliminates need for oclif's plugin system. Zero deps, 213M weekly downloads, Composio uses it too. |
| D15 | Dashboard timing                      | Deferred to Phase 5            | TUI-first (Ink) as potential Phase 3-4 stretch. Web (Next.js) for full Phase 5. Core engine designed with clean query API so both dashboards consume same data layer. |
| D16 | Package name                          | `kata`                         | A kata is a choreographed sequence of moves (stages) practiced repeatedly (cycles) and refined over time (self-improving loop). 4 chars, clean CLI (`kata init`), not overloaded in dev tooling. "Code kata" already a recognized concept. |
| D17 | Thematic CLI naming                   | Kata vocabulary for CLI commands | stage→form, pipeline→sequence, cycle→practice, bet→focus, cooldown→reflect, knowledge→memory, init→begin. Enhances recognition without obscuring meaning. Fallback: if thematic name confuses, use plain name. See `breadboard.md` naming table. |

---

## Open Questions / Potential Spikes

| #  | Question                                                        | Status | Resolution |
| -- | --------------------------------------------------------------- | ------ | ---------- |
| S1 | Knowledge graph implementation — embedded JSON graph vs. lightweight graph DB vs. SQLite? | ✅ Resolved | JSON files + typed interfaces for v1. Graphology upgrade path for v2+. 70% of queries are simple filters; only 2-3 need graph traversal. See `spike-knowledge-graph.md`. |
| S2 | Skills graph — same graph as knowledge or separate? | ✅ Resolved | Separate graphs with typed cross-references. Different node types, lifecycles, and query patterns. Skills reference learning categories via foreign keys. See `spike-knowledge-graph.md`. |
| S3 | Token budget estimation — how do we estimate token costs? | ✅ Resolved | Track actuals first (Claude JSONL files), estimate from history later. Budget is a constraint (Shape Up appetite), not a hard stop. Alerts at 75/90/100%. See `spike-token-budget.md`. |
| S4 | CLI framework selection | ✅ Resolved | Commander.js + @inquirer/prompts. Execution adapters are config-based (domain layer), not CLI plugins — eliminates need for oclif's plugin system. Zero deps, ecosystem-dominant. See `spike-cli-framework.md`. |
| S5 | Dashboard technology | Deferred | Phase 5. TUI-first (Ink) as Phase 3-4 stretch. Web (Next.js) for full visualization. Design core with clean query API so both can consume same data layer. See `spike-dashboard-naming.md`. |
| S6 | Package naming and npm scope | ✅ Resolved | **`kata`** — a choreographed sequence of moves practiced and refined. CLI: `kata init`, `kata pipeline start`. npm: `@4ink/kata` or `kata-engine`. See `spike-dashboard-naming.md`. |
