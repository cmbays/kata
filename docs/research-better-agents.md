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

## Sources

- [langwatch/better-agents GitHub](https://github.com/langwatch/better-agents)
- [LangWatch Scenario Testing Framework](https://langwatch.ai/scenario/)
- [LangWatch Agent Evaluation Blog](https://langwatch.ai/blog/framework-for-evaluating-agents)
- [LangWatch Platform](https://langwatch.ai/)
