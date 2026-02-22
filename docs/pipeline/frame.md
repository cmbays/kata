---
shaping: true
---

# Methodology Engine — Frame

## Source

> We have a project or epic in the backlog. We've been working on this work orchestrator
> tool and it's basically bash commands. The idea is that it's trying to help us enable
> doing agent orchestration in a more repeatable pattern where we create pipelines that
> have certain phases. We load up GitHub issues and we just make sure that the work is
> properly groomed out, all the context is in the ticket, and the pipeline can be launched.

> I came across [Composio Agent Orchestrator](https://github.com/ComposioHQ/agent-orchestrator)
> — someone's had the same idea and they're building a tool. They're much farther along
> and they've actually got it working in TypeScript. 40K lines. 3,288 tests. 17 plugins.

> I think we focus on the methodology and on the content that the agents have and use,
> like the process that they go through to solve problems. If we focus on that really well
> and make it fairly generalizable and extensible, then that's a really powerful tool, and
> then we can just layer it on top of any of these other tools like Composio, which is
> focused on the agent lifecycle.

> What should those agents do, in what order, with what knowledge, and how do we get
> better at it? Bingo.

> Basically, we are focused on automating the development methodology and having extensible
> methodologies where we can create stages. Those stages could be reordered to create
> unique new types of pipelines, or new stages could be created as well.

> I think of it as an app that we're building here. It gives you the ability to produce
> modular stages through workflows that you can link together to create pipelines. Those
> pipelines can then also be linked together to define a project build cycle, from beginning
> to the epic building process to the end where you're releasing.

> A cycle isn't necessarily a project. A cycle is some budget that you want to bet on.
> Being able to tie into subscription token budgets and estimate token budget would be
> amazing. You can have multiple different projects that have an epic that gets betted on.

> It should be able to sort of work from a null state. They don't have any agents, they
> don't have any skills, they don't have any orchestration tooling, but when they use it
> they're basically adopting a methodology framework. They get stages out of box, and those
> stages have a sense of templates for how to get the work done.

> I think we need some sort of dashboard or UI that helps them visualize and see what they
> have. What stages do they have? What pipelines do they have? How often have they run a
> certain type of pipeline? What agents or skills are associated with them?

> We want to produce a very polished experience that focuses on the AI development
> methodology and being a self-improving system in basically figuring out how to improve
> each stage that we have.

---

## Problem

AI-assisted development today has no methodology layer. Agent lifecycle tools (Composio,
Devin, Factory) solve "how do I spawn and manage agents" but not "what should agents do,
in what order, with what knowledge, and how do we improve over time."

Current state:

1. **Ad hoc agent work** — Developers prompt agents with one-off instructions. No
   repeatable process. Quality varies wildly between sessions.

2. **No structured learning** — When an agent figures out a better way to do research or
   review code, that knowledge dies with the session. The next session starts from scratch.

3. **No methodology enforcement** — No entry/exit gates, no artifact requirements, no
   quality standards between stages. Work that should follow research → shape → build →
   review skips steps unpredictably.

4. **No composability** — Stages, skills, and agents are tightly coupled to specific
   tools. Can't reuse a "research" stage across different pipeline types or swap the
   execution layer without rewriting everything.

5. **No budget-aware planning** — No way to tie development cycles to token budgets or
   time boxes. Work expands without constraints, making prioritization impossible.

Our existing `work()` bash orchestrator partially addresses this but is limited: no type
safety, no testing, no self-improving loop, no dashboard, no null-state onboarding, and
tightly coupled to our specific project.

---

## Outcome

A TypeScript package (`methodology-engine` or similar) that provides:

1. **Executable methodology** — Stages with entry/exit gates, artifact schemas, and
   learning hooks that encode *how* development work should proceed, independent of which
   agent or tool executes it.

2. **Composable pipelines** — Ordered sequences of stages that can be defined, reused, and
   customized. Built-in pipeline types (vertical, bug-fix, polish, spike) with the ability
   to create new types by recomposing existing stages.

3. **Budget-bounded cycles** — Shape Up-inspired betting cycles that compose multiple
   pipelines across multiple projects, constrained by token/time budgets. Cooldown phases
   that evaluate outcomes and plan next cycles.

4. **Self-improving knowledge system** — Every pipeline execution captures learnings that
   feed back into future stages. Stage-level learnings load automatically. Category-based
   subscriptions enable specialization. The system gets better at building software over
   time.

5. **Null-state to maturity gradient** — Works immediately with zero configuration (built-in
   stage templates are self-sufficient prompts). Grows more powerful as users add custom
   stages, skills, agents, and knowledge. Never requires an agent lifecycle tool to function.

6. **Execution-layer agnostic** — Produces execution manifests that any runtime can consume.
   Works with plain Claude CLI, Composio, or any future agent lifecycle tool. The
   methodology doesn't know about agents — it knows about stages, gates, artifacts, and
   knowledge.

### Success Criteria

- A developer with just Claude Code and no other tooling can install the package, run
  `init`, and be guided through a structured development pipeline within 5 minutes.
- Pipeline executions produce measurably more consistent artifacts than ad hoc agent work.
- The knowledge system demonstrably improves stage outputs over repeated cycles (measurable
  via artifact quality metrics or human evaluation).
- Switching from one agent lifecycle tool to another requires only swapping the execution
  adapter, not changing any methodology definitions.
