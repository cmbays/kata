# How We Work

> Living doc. Describes our methodology, tooling philosophy, and automation trajectory.
> Complement to ROADMAP.md (where we're going).
> Last verified: 2026-02-28

---

## 1. Philosophy — Shape Up for Solo Dev + AI Agents

We use Basecamp's [Shape Up](https://basecamp.com/shapeup) methodology, adapted for a fundamentally different team structure: one human developer + N concurrent Claude Code agent sessions.

**Why Shape Up:**

- **Fixed-time appetite** — we decide how much time a problem deserves before building, not after
- **Shaping before building** — problems are explored and bounded before any code is written
- **Cool-down cycles** — structured space between bets for reflection, polish, and forward planning

**The core adaptation:** Our "team" is 1 human + N concurrent Claude Code sessions — not a traditional dev team of humans. This changes everything about coordination. Humans don't hand off work to each other across time zones; agents start fresh every session with no memory. Structure IS memory.

**The human's three irreplaceable roles:**

| Role           | When           | What                                                                     |
| -------------- | -------------- | ------------------------------------------------------------------------ |
| **Bet**        | Between cycles | Decide what to build next, based on appetite and strategic value         |
| **Interview**  | During shaping | Provide domain knowledge, validate requirements, make business decisions |
| **Smoke Test** | After build    | Verify the built thing matches intent                                    |

Everything between these touchpoints — research, shaping, breadboarding, planning, building, reviewing — is agent-executable.

**Why this matters:** PM infrastructure isn't just tracking — it's the coordination layer that enables agent autonomy. Labels are queryable via `gh issue list -l`. Templates enforce structure. The system is designed for `gh` CLI consumption, not just human eyeballs on a web UI.

---

## 2. The Pipeline

Every significant piece of work flows through a pipeline of stages. Not every pipeline uses every stage — a bug fix skips shaping, a polish cycle skips research — but the full sequence is:

```
Research → Interview → Shape → Breadboard → Plan → Build → Review → Wrap-up
```

### Skills That Encode Each Step

> This mapping is a working baseline. Skills will be refined as kata's built-in stage templates mature.

| Stage      | Skill                                     | Output                                            |
| ---------- | ----------------------------------------- | ------------------------------------------------- |
| Research   | `vertical-discovery`                      | Competitor analysis, domain research              |
| Interview  | `pre-build-interrogator`                  | Requirements validation, domain decisions         |
| Shape      | `shaping`                                 | Frame (problem) + Shaping doc (R x S methodology) |
| Breadboard | `breadboarding` + `breadboard-reflection` | Affordance maps, wiring, vertical slices          |
| Plan       | `implementation-planning`                 | Execution manifest (YAML) with waves and sessions |
| Build      | `build-session-protocol`                  | Code, tests, PRs                                  |
| Review     | `quality-gate` + `design-audit`           | Audit reports, review comments                    |
| Wrap-up    | `cool-down`                               | KB docs, retrospective, forward planning          |

---

## 3. GitHub as the PM Platform

### Why GitHub Issues

We chose GitHub Issues over Linear, Jira, and Notion. The reasoning:

- **Co-located with code** — issues live in the same repo as the codebase. No context switching, no sync.
- **`gh` CLI for agents** — every PM operation is a shell command. Agents don't need browser automation or API clients.
- **PR linking is automatic** — `Closes #123` in a PR body creates the link. No manual cross-referencing.
- **No sync tax** — one source of truth. Linear/Jira require bidirectional sync with GitHub, which always drifts.
- **Lower lock-in** — issues are Markdown. Exportable, readable, version-controlled.

### Label Taxonomy

Labels are the organizational backbone. Every issue should have a `type` label + `priority` label + at least one domain label.

| Dimension    | Purpose           | Examples                                                    |
| ------------ | ----------------- | ----------------------------------------------------------- |
| `type`       | What kind of work | `bug`, `enhancement`, `documentation`, `tech-debt`, `refactor` |
| `priority`   | When to do it     | `priority: now`, `priority: next`, `priority: later`, `priority: icebox` |
| `domain`     | What area of kata | `cli`, `ux`, `architecture`, `dojo`, `meta-learning`, `testing`, `infrastructure` |
| `source`     | How we found it   | (aspiration) `interview`, `testing`, `review`, `cool-down`  |

Labels encode stable categorical metadata. Status and wave tracking live on labels too (`wave-f`, `epic`, `cross-cutting`).

### Issue Templates

> Not yet created for kata. The following are the templates worth adding.

| Template        | Purpose                                    |
| --------------- | ------------------------------------------ |
| Feature Request | New functionality with acceptance criteria |
| Bug Report      | Something broken, with reproduction steps  |
| Research Task   | Investigation with specific questions      |

### Milestones

Milestones group issues that must ship together for a specific goal — a release, a public launch, or a significant capability threshold. Kata hasn't yet established a milestone cadence; this is an area to develop as the project approaches v1 release.

### GitHub Actions

One workflow today:

| Action          | Trigger                          | Effect                          |
| --------------- | -------------------------------- | ------------------------------- |
| Lint, Test & Build | Push/PR to `main`             | `lint` + `typecheck` + `test` + `build` |

The PR labeler and auto-add-to-project automations from the print4ink playbook are aspirational additions once a project board is in place.

---

## 4. The Automation Trajectory

> **For discussion:** This level model was designed for the print4ink project but captures something real about agent autonomy. The question for kata: how does kata *itself* embody or enable these levels? Is kata the tool that makes L3–L5 possible for other projects?

Where we've been, where we are, and where we're going — framed as increasing agent autonomy:

| Level                   | Description                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L0: Manual**          | Human creates issues, assigns work, manages everything                                                                                                      |
| **L1: Structured**      | Label taxonomy, issue templates, standardized pipeline stages                                                                                               |
| **L2: Instrumented**    | Project board, auto-add, auto-label, groomed backlog                                                                                                        |
| **L3: Self-Orienting**  | Agents read board state to find work. Pipeline stages tracked. Grooming becomes scheduled/semi-automated.                                                   |
| **L4: Self-Organizing** | Agents propose pipeline stages, auto-create sub-issues, auto-update board status. Human approves bets and reviews output.                                   |
| **L5: Autonomous**      | Agents detect when work is needed (stale issues, user feedback, dependency resolution), self-shape, self-plan, execute. Human gates only at Bet and Review. |

**The key insight:** PM infrastructure isn't just tracking — it's the coordination layer that enables agent autonomy. Clean taxonomy + structured templates + automated sync = agents that can self-orient without human hand-holding.

Kata is being built to make L3–L5 accessible: the pipeline engine, stage gates, manifest execution, and learning system are all infrastructure for autonomous agent operation.
