# Research Analysis: Better Agents vs Kata

**Date**: 2026-03-02
**Source**: [langwatch/better-agents](https://github.com/langwatch/better-agents)

## Context

Investigating whether LangWatch's Better Agents tool overlaps with, competes with, or could benefit Kata's development methodology engine.

---

## What Better Agents Actually Is

**Better Agents is a project scaffolding CLI** — it runs `better-agents init` to generate a new agent project with an opinionated directory structure, pre-configured testing templates, prompt management files, and MCP server setup. It's essentially a `create-react-app` for agent projects, not an agent improvement engine itself.

### What it generates:
- `app/` or `src/` — framework-specific agent code (Agno, Mastra, LangGraph, Google ADK, Vercel AI)
- `tests/scenarios/` — stub scenario test files using LangWatch's Scenario framework
- `tests/evaluations/` — Jupyter notebook templates for component evaluation
- `prompts/` — YAML prompt files + `prompts.json` registry
- `.mcp.json` — MCP server config that gives coding assistants framework expertise
- `AGENTS.md` — generated development guidelines document

### Its core philosophy: "The Agent Testing Pyramid"
Three layers of validation:
1. **Unit/Integration Tests** — traditional software tests for tool correctness
2. **Evaluations** — measure non-deterministic components (RAG accuracy, classification)
3. **Agent Simulations (Scenario)** — end-to-end multi-turn conversation testing with LLM-powered user simulators and judge agents

### What it is NOT:
- Not a runtime execution engine
- Not a learning/knowledge system
- Not a methodology framework
- Not a pipeline orchestrator
- Has no self-improvement loop
- Has no domain model beyond config types (language, framework, LLM provider, coding assistant)
- The generated scaffolding is static — it doesn't evolve or learn

---

## Comparison

| Dimension | Better Agents | Kata |
|-----------|--------------|------|
| **What it is** | Project scaffolding CLI | Development methodology engine |
| **When it runs** | Once, at project init | Continuously, throughout development |
| **Domain** | Agent application projects | Software development process |
| **Intelligence** | Static templates | Self-improving knowledge system |
| **Learning** | None — generates and forgets | Rich learning lifecycle with tiers, decay, promotion |
| **Execution** | Generates files, exits | Orchestrates pipelines with gates and adapters |
| **Self-improvement** | None | Pattern detection, prediction matching, friction analysis, calibration detection, synthesis |
| **Complexity** | ~20 source files, simple types | 52+ test files, 10+ domain schemas, rich service layer |
| **Backed by** | LangWatch (observability platform) | Standalone methodology engine |

---

## Answers

### Is it a direct competitor?

**No.** They operate at completely different abstraction levels:
- Better Agents: "How should I structure my agent project?" (one-time scaffolding)
- Kata: "How should I structure my development process and learn from it?" (continuous methodology engine)

Better Agents is a scaffolding tool tied to LangWatch's observability platform. It generates boilerplate and guides developers toward LangWatch's commercial products.

Kata is a methodology engine that models the entire development lifecycle as executable, composable, self-improving stages. Kata's knowledge system alone (5-tier hierarchy, permanence levels, confidence decay, citation tracking, synthesis pipeline) is more sophisticated than Better Agents' entire codebase.

### What benefits our building of Kata?

Very little from the tool itself, but some valuable principles:

1. **Agent Testing Pyramid** — their 3-layer approach (unit tests → evaluations → simulations) could inform formalizing evaluation tiers in Kata
2. **MCP Server for Methodology Expertise** — Better Agents configures `.mcp.json` to give coding assistants domain expertise. Kata could ship as an MCP server for Shape Up methodology expertise
3. **Scenario Simulation Testing** — LangWatch's separate Scenario framework could be interesting for end-to-end pipeline testing

### Could their tool have a place in our project building?

Only tangentially:
- If using Kata to develop an agent project, `better-agents init` could be a build stage scaffolding step
- LangWatch's Scenario testing framework (separate product) could be integrated as an evaluation gate in Kata pipelines that produce agent code

### Principles worth adopting

| Principle | Kata Status | Worth Adopting? |
|-----------|-------------|-----------------|
| Testing pyramid (unit → eval → simulation) | Has unit tests + pattern detection, no simulation | **Yes** — formalize evaluation tiers |
| Prompt versioning as YAML artifacts | Has promptTemplate + PromptUpdater | **Partial** — Kata's learning versioning is already more advanced |
| AGENTS.md as generated living doc | CLAUDE.md is hand-maintained | **Maybe** — auto-generate from stage/pipeline definitions |
| MCP servers for domain expertise | Not currently applicable | **Yes** — ship Kata as MCP server |
| Observability built-in | Has TokenTracker, history, observations | **Already stronger** |
| Scenario-based end-to-end testing | No simulation testing | **Worth exploring** |

---

## Deep Dive: Four Key Questions

### Q1: Agent Testing Pyramid — Tool to build Kata, or tool within Kata?

**Neither. It's a principle to formalize within Kata's domain model.**

The pyramid's three layers map to Kata concepts:

| Pyramid Layer | Kata Equivalent Today | Gap |
|---|---|---|
| L1: Unit tests | 711 vitest tests | Covered |
| L2: Evaluations | Gate conditions (`schema-valid`, `artifact-exists`) | Validates *presence*, not *quality*. No mechanism to score stage output quality |
| L3: Simulation | Nothing | No way to simulate full pipeline runs with synthetic inputs |

The opportunity: model evaluation *as methodology* within Kata's domain, not adopt an external tool.
- A `quality-eval` gate type that scores stage artifact quality
- A `scenario-sim` pipeline validation mode that plays through pipelines with synthetic inputs and judge criteria
- These would be Kata-native concepts, not LangWatch dependencies

### Q2: What would MCP offer vs our CLI?

**MCP Resources are the killer feature. MCP Tools are largely redundant with the CLI.**

Benchmarks show CLI is 28-33% more effective for task completion and 5-10x more token-efficient. The full GitHub MCP server's 93 tools cost ~55,000 tokens just for schema definitions. This is ironic for Kata, which *tracks token budgets*.

| Scenario | CLI-only | CLI + MCP Resources |
|---|---|---|
| Agent starts build stage | Reads KATA.md (snapshot from last cooldown) | Gets live gate requirements + injected learnings via resource subscription |
| Agent makes a decision | Human runs `kata decision record` after the fact | Agent calls a small MCP tool inline during execution |
| Agent finishes a stage | Human runs gate check | Agent reads gate status resource, knows pass/fail immediately |
| Agent needs learnings | Reads static KATA.md bunkai section | Gets dynamically filtered learnings for current stage via resource |

**Recommended strategy**: Keep CLI as primary. Add MCP as a thin context delivery layer:
1. **Resources** (killer feature): Current stage, gate status, active learnings, budget remaining — surfaced proactively
2. **Small curated Tools** (5-10, not 20+): Record observation, record decision, evaluate gates, query knowledge
3. **Prompts**: Methodology templates (shaping session, gate evaluation, cooldown reflection)
4. **Do NOT** expose every CLI command as an MCP tool — context bloat defeats the purpose

### Q3: How would Scenario simulation fit into Kata?

LangWatch Scenario uses three agents in a simulation loop:
1. **Agent Under Test** — wrapped in an `AgentAdapter` with a `call()` method
2. **User Simulator** — LLM-powered synthetic user generating messages based on scenario description
3. **Judge Agent** — LLM evaluator watching every turn, deciding success/failure against criteria

**Where it maps to Kata**:
- Agent Under Test = a Kata pipeline executing stages with an adapter
- User Simulator = synthetic input exercising a pipeline against edge cases
- Judge = configurable criteria evaluating methodology adherence
- Criteria = exit gates expressed in natural language

**Concrete value it would add**:
1. **Pipeline design validation** — catch methodology gaps before real cycles (does the pipeline enforce research-before-build?)
2. **Regression testing for methodology changes** — when stages are reordered, simulation catches broken workflows
3. **Training scenarios** — simulate different experience levels (beginner vs experienced) against the same pipeline
4. **Learning validation** — run same scenario with/without learning injection to test whether learnings improve outcomes

This is a new Kata feature idea — "methodology simulation" — where the thing being tested is the methodology's structural soundness, not an agent's responses.

### Q4: KATA.md vs AGENTS.md

**AGENTS.md** is assembled from 4 static section builders:
1. `overview-section.ts` — project name, framework, language
2. `principles-section.ts` — hardcoded rules ("every feature MUST have scenario tests", "use LangWatch Prompt CLI")
3. `framework-section.ts` — framework API knowledge from providers
4. `workflow-section.ts` — 7-step process + Always/Never checklists

**KATA.md** is generated by `kata-md-generator.ts` with `KataMdRefresher` auto-updating delimited sections:
1. Project metadata
2. Active Cycle (auto-updated)
3. Kataka Registry (auto-populated)
4. Methodology Preferences
5. Project Bunkai / Learnings (auto-updated after cooldown)
6. Open Gaps

| Dimension | AGENTS.md | KATA.md |
|---|---|---|
| Generated by | One-time scaffolding | `kata init` + refreshed every cooldown |
| Content | Static rules + framework docs | Live state + learned knowledge |
| Updates | Overwrite-only (`fs.writeFile`), no merge logic | Auto-update with user-edit preservation via delimited markers |
| Rules | Hardcoded by LangWatch | Emergent from knowledge system |
| Evolves | No — manual edits only | Yes — learnings, gaps, cycle state refresh automatically |
| Framework knowledge | Yes (Agno, LangGraph, etc.) | No (methodology-focused) |
| Re-init safety | Overwrites all manual customizations | Preserves user content outside markers |

**What AGENTS.md does that KATA.md doesn't**: Prescribes explicit behavioral rules. KATA.md reports *state* but doesn't say "you MUST do X before Y."

**What to adopt**: Surface constitutional learnings and active stage rules as explicit prescriptions in KATA.md. Not because a scaffolding tool wrote them, but because the project *earned* them through practice and promotion through the knowledge hierarchy.

---

## Recommended Actions

Six actionable items, prioritized by impact-to-effort ratio. Each is scoped to a single implementable unit.

### Tier 1: High Impact, Low Effort

#### 1. Prescriptive Rules in KATA.md from Constitutional Learnings

**What**: Add a new auto-refreshed section to KATA.md that surfaces high-confidence learnings as explicit behavioral rules (e.g., "you MUST validate schema before advancing past Build").

**Why**: KATA.md currently reports *state* but doesn't prescribe *behavior*. AGENTS.md's one advantage is explicit Always/Never rules — but those are hardcoded. Kata can generate them from earned knowledge, which is strictly better.

**Where it touches**:
- `KataMdRefresher` — add a new delimited section for prescriptive rules
- `KnowledgeStore.loadForStage()` — filter by confidence threshold + permanence level to select rule-worthy learnings
- New formatter to render learnings as imperative prescriptions

**Effort**: Small. Extends existing refresh pipeline with one new section builder.

#### 2. `quality-eval` Gate Type

**What**: A new `GateConditionType` that scores artifact content against quality criteria, not just presence. Criteria can be structured rubrics or natural-language descriptions evaluated by the execution adapter's LLM.

**Why**: Current gates (`artifact-exists`, `schema-valid`) answer "is it there?" and "is it shaped right?" but never "is it good enough?". This is the L2 gap in the testing pyramid — evaluations that measure quality of non-deterministic output.

**Where it touches**:
- `GateConditionType` enum in `src/domain/types/gate.ts` — add `quality-eval`
- `GateEvaluator` in `src/features/pipeline-run/` — add evaluation branch that sends artifact + criteria to the execution adapter
- Gate schema — add optional `criteria: string[]` field for quality-eval conditions

**Effort**: Medium-small. The gate evaluation architecture already supports exhaustive condition checking; this adds one new branch.

### Tier 2: High Impact, Medium Effort

#### 3. MCP Resource Server for Methodology Context

**What**: A lightweight MCP server that exposes Kata's live state as **Resources** — read-only, URI-addressed data that MCP-compatible hosts (Claude Code, Cursor, Copilot) can subscribe to and surface proactively.

**Resources to expose**:

| Resource URI | Source Service | What It Surfaces |
|---|---|---|
| `kata://pipeline/current` | `PipelineComposer` | Active stage, completion %, next gate requirements |
| `kata://cycle/budget` | `CycleManager.getBudgetStatus()` | Remaining tokens/time for active cycle and bet |
| `kata://knowledge/stage/{id}` | `KnowledgeStore.loadForStage()` | Learnings filtered to current stage |
| `kata://gates/status` | `GateEvaluator` | Pass/fail status of current stage's exit gates |
| `kata://cycle/active` | `CycleManager.get()` | Active cycle details, bet list, outcomes |

**Why**: This is the single biggest workflow improvement for AI-assisted development. The agent gets methodology awareness without running commands or burning tokens on tool schemas. Resources are push-based — the host decides when to surface them, costing zero tokens when not needed.

**Where it touches**:
- New `src/infrastructure/mcp/` module with MCP server setup
- Thin wrappers calling existing services (no new business logic)
- New entrypoint in tsup config for `mcp/index`

**Effort**: Medium. The MCP SDK handles protocol; Kata's services already expose the data. Wiring only.

#### 4. Curated MCP Tool Set (5-7 Tools)

**What**: A small, intentional set of MCP tools for operations that happen *during* AI-assisted work — things awkward to do via CLI mid-flow.

**Tools to expose**:

| Tool | Maps To | Why Not CLI |
|---|---|---|
| `record_observation` | `KnowledgeStore.capture()` | Agent captures inline during work, not after |
| `record_decision` | New: structured decision record | Decisions happen mid-thought, not as a separate command |
| `evaluate_gate` | `GateEvaluator.evaluateGate()` | Agent checks gate without context-switching to terminal |
| `query_knowledge` | `KnowledgeStore.query()` | Filtered retrieval with structured params |
| `report_progress` | Pipeline stage status update | Real-time progress without CLI round-trip |

**Why**: These 5 tools cover the operations where MCP adds genuine value over CLI. Everything else (init, pipeline start, cycle management, cooldown) stays CLI-only to avoid schema bloat.

**Where it touches**: Same `src/infrastructure/mcp/` module as Resources. Tool handlers delegate to existing services.

**Effort**: Medium. Couples with item 3 — build together.

### Tier 3: High Impact, Higher Effort (Future Wave)

#### 5. Methodology Simulation Mode

**What**: A new pipeline execution mode — `kata pipeline simulate` — that validates methodology design by running synthetic scenarios through the pipeline with an LLM judge evaluating adherence.

**Three-agent architecture** (inspired by LangWatch Scenario):
1. **Pipeline Under Test** — a Kata pipeline definition with its stages and gates
2. **Work Simulator** — generates synthetic stage inputs (shaped pitches, build artifacts, etc.)
3. **Methodology Judge** — evaluates whether the pipeline enforces correct ordering, catches missing gates, and handles edge cases

**Use cases**:
- Validate new pipeline designs before real cycles
- Regression-test methodology changes (reordered stages, new gates)
- Compare pipeline variants (with/without learning injection)
- Training: simulate beginner vs experienced developer behavior against the same pipeline

**Where it touches**:
- New `src/features/simulation/` module
- New CLI command: `kata pipeline simulate --scenario <file>`
- Scenario definition schema (description, synthetic inputs, judge criteria)
- Integration with execution adapters for LLM-powered simulation

**Effort**: Large. This is a new feature domain. Worth shaping as its own cycle bet.

#### 6. MCP Prompt Templates for Methodology Workflows

**What**: Pre-built prompt templates exposed via MCP's Prompts primitive, selectable in the IDE.

**Templates**:
- "Start shaping session" — injects relevant learnings, cycle budget constraints, artifact requirements
- "Evaluate gate readiness" — structures reasoning about whether exit criteria are met
- "Generate cooldown reflection" — includes execution history, token usage, bet outcomes
- "Review knowledge" — surfaces learnings for human review with confidence scores

**Why**: Lower priority than Resources because KATA.md already delivers most methodology context statically. Prompts add value when the workflow is interactive and benefits from structured framing.

**Where it touches**: Extends the MCP server from items 3-4 with prompt definitions. Templates reference Resource URIs for dynamic data injection.

**Effort**: Medium-small once the MCP server exists. Depends on items 3-4.

### What NOT to Do

| Anti-pattern | Why to Avoid |
|---|---|
| Expose every CLI command as an MCP tool | 20+ tools = 10,000+ schema tokens. Defeats Kata's own token budget tracking |
| Adopt LangWatch Scenario as a dependency | The *principle* is valuable; the *library* is tied to their ecosystem and commercial platform |
| Copy AGENTS.md's static rule approach | KATA.md's auto-refresh with edit preservation is already superior. Adopt *prescriptive voice*, not static content |
| Build MCP Tools before Resources | Resources are the killer feature with zero token overhead. Tools are commodity — add them second |
| Build simulation before MCP | MCP delivers immediate value for every AI-assisted session. Simulation is a methodology R&D tool — valuable but lower frequency |

### Implementation Sequence

```
Wave 5 (next):
  Session 10: Prescriptive KATA.md rules (item 1) + quality-eval gate (item 2)
  Session 11: MCP Resource server (item 3) + curated tools (item 4)

Wave 6 (future):
  Session 12: MCP Prompt templates (item 6)
  Session 13: Methodology simulation (item 5) — shape as its own cycle bet first
```

---

## Sources

- [langwatch/better-agents GitHub](https://github.com/langwatch/better-agents)
- [langwatch/scenario GitHub](https://github.com/langwatch/scenario)
- [LangWatch Scenario Testing Framework](https://langwatch.ai/scenario/)
- [LangWatch Agent Evaluation Blog](https://langwatch.ai/blog/framework-for-evaluating-agents)
- [LangWatch Platform](https://langwatch.ai/)
- [MCP vs CLI Benchmark](https://elite-ai-assisted-coding.dev/p/mcp-vs-cli-benchmarking)
- [Why CLI Tools Are Beating MCP](https://jannikreinhard.com/2026/02/22/why-cli-tools-are-beating-mcp-for-ai-agents/)
- [MCP Features Guide](https://workos.com/blog/mcp-features-guide)
- [Scenario npm Package](https://www.npmjs.com/package/@langwatch/scenario)
