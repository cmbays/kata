---
shaping: true
---

# S4 Spike: CLI Framework Selection

## Context

The methodology engine needs a CLI (`me init`, `me stage list`, `me pipeline start`,
`me cycle new`). We need subcommands, interactive prompts for onboarding, JSON output
mode, and plugin extensibility for execution adapters.

## Goal

Select the right CLI framework for the methodology engine's command structure and
extensibility requirements.

## Questions

| #       | Question                                                      |
| ------- | ------------------------------------------------------------- |
| **Q1**  | Which frameworks support our requirements?                    |
| **Q2**  | How important is the plugin system for execution adapters?    |
| **Q3**  | What's the right trade-off between type safety and ecosystem? |

## Findings

### Q1: Framework Comparison

Six frameworks evaluated:

| Framework | TS-First | Plugin System | Subcommands | Testing | Deps | Maintenance |
| --------- | -------- | ------------- | ----------- | ------- | ---- | ----------- |
| **Commander.js** v14 | Bolted-on types | None | Good | Manual | 0 | Excellent (213M/wk) |
| **oclif** v4 | First-class | Production-grade (npm plugins, runtime install) | Excellent (topic:command) | `@oclif/test` `runCommand()` | Heavy (~850KB) | Excellent (Salesforce) |
| **Clipanion** v3/v4 | Native (decorators) | None | Good (class hierarchy) | Manual (mock context) | 0 | Moderate (v4 RC for 1yr) |
| **citty** v0.2 | Native (`defineCommand`) | Draft PR, unmerged | Good (nested) | Manual | 0 | Active (UnJS, pre-1.0) |
| **Clerc** v1.2 | Native | Immature | Good | None | Minimal | Low (204 stars) |
| **Stricli** v1.2 | Best (form-follows-function) | None | Excellent (route maps) | Best (plain functions) | 0 | Active (Bloomberg) |

### Q2: Do We Need a Plugin System?

The execution adapter pattern could be implemented two ways:

**Option A: CLI plugins (oclif model)**
```bash
me plugins install @methodology/adapter-composio
me pipeline start --adapter composio
```
Adapters are npm packages that register CLI commands/hooks. Users install at runtime.

**Option B: Config-based adapters (no plugin system needed)**
```json
{
  "execution": {
    "adapter": "composio",
    "config": { "projectId": "my-app" }
  }
}
```
Adapters are npm packages imported at build time or resolved from config. The CLI itself
doesn't need a plugin mechanism — the adapter interface is in the domain layer.

**Assessment**: Option B is sufficient and much simpler. Execution adapters are a domain
concept (part of the `ExecutionAdapter` interface), not a CLI concept. The CLI doesn't
need to discover or install plugins — it reads config and resolves the adapter via the
registry. This eliminates the primary argument for oclif.

### Q3: Recommendation

**With plugin system eliminated as a CLI requirement, the field opens up.**

**Recommended: Commander.js** — for pragmatic reasons:

1. **Ecosystem gravity** — 213M weekly downloads. Every Stack Overflow answer, every
   tutorial, every example uses Commander. When we publish this as an open-source package,
   contributors already know it.

2. **Composio uses it** — If we integrate with Composio's `ao` tool, there's pattern
   consistency. Debugging across both tools is easier.

3. **Zero dependencies** — Important for a library package that others will install.

4. **Interactive prompts** — Pair with `@inquirer/prompts` (the modern, composable
   Inquirer). Commander handles command routing, Inquirer handles interactive flows.
   Clean separation.

5. **Good enough types** — Commander's types aren't as strong as Stricli's, but for
   our command surface (~15-20 commands), the type weakness is manageable. We can
   type-narrow in the command handler functions.

**Runner-up: Stricli** — If type safety is paramount and we're okay with a smaller
ecosystem. Best testing story (commands are plain functions), best startup perf (lazy
loading), zero deps. Downside: 998 stars, limited community, no interactive prompt
integration.

**Not recommended:**
- **oclif** — Too heavy for our needs now that plugin system is unnecessary. 850KB install
  footprint is a lot for a dev tool library.
- **citty** — Pre-1.0, plugin PR unmerged. Good philosophy but not production-ready.
- **Clipanion** — v4 RC stalled for a year. Yarn team may have moved on.
- **Clerc** — Too young, too small.

## Decision

**Commander.js + @inquirer/prompts** — proven, zero-dep, ecosystem-dominant. Execution
adapter extensibility lives in the domain layer (config-based), not the CLI layer.

## Acceptance

Spike complete — we can describe:
- Framework landscape and trade-offs ✅
- Plugin system is not a CLI requirement (config-based adapters instead) ✅
- Selected framework: Commander.js + @inquirer/prompts ✅
