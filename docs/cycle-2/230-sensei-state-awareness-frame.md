---
shaping: true
---

# Sensei State Awareness — Frame

**Issue:** #230
**Date:** 2026-03-01
**Status:** Draft

---

## Source

> The sensei skill (PR #225) gives the sensei role its identity and
> orchestration pattern, but it doesn't read live `.kata/` state. A user can't
> ask Claude "what cycle are we on?" and get a meaningful answer grounded in
> actual kata data.

> As a user, I want to start a Claude session, maybe with --worktree or not.
> At some point I want to ask "what should we work on next?", "what keiko are
> we on?", "what kadai are available?" I want Claude to either automatically
> load the sensei or activate on trigger words. Then we discuss the roadmap,
> pick bets, assign kata, and when I confirm — launch the cycle. During the
> cycle I want to ask where things are at. After the cycle I want Claude to
> close things out, launch cooldown, do the diary. It should be conversational,
> grounded in real state, and natural to use with either English or Japanese
> kata vocabulary.

---

## Problem

The current sensei skill (`skill/kata-sensei.md`) describes **how** to
orchestrate once a cycle is running, but is blind to **what** is happening.
It has no instructions for:

1. **Reading project state** — the sensei can't answer "what cycle are we on?"
   because it doesn't know to run `kata cycle status --json` and interpret the
   output.

2. **Conversational planning** — the user says "let's pick bets for next cycle"
   and the sensei doesn't know how to list available bets, present them for
   discussion, or add them to a cycle via CLI.

3. **Natural language intent mapping** — the user says "kiai the cycle" or
   "let's do a keiko" and the sensei doesn't map these to kata CLI commands.

4. **Proactive state surfacing** — the sensei doesn't check for pending human
   approval gates, doesn't notice when agents stall, doesn't surface budget
   warnings when token usage approaches the cycle's appetite.

5. **Session lifecycle** — the sensei doesn't guide the user through the full
   arc: planning → launch → monitoring → conclusion → cooldown → diary. Each
   phase requires different behavior but the skill treats them all the same.

The result: the user has to manually run kata CLI commands and interpret JSON
output, defeating the purpose of having a sensei orchestrator.

---

## Outcome

A user opens a Claude session in a kata-initialized project and has a
conversation like:

```
User: Hey, what keiko are we on?
Claude: We're on Cycle 2 — "Agent Infrastructure." 4 kadai loaded, 0 started.
        Want me to walk through the bets?

User: Yeah, what's the lineup?
Claude: Here are the 4 bets in Cycle 2:
        1. #229 claude-native adapter (appetite: 40%) — no kata assigned yet
        2. #230 sensei state awareness (appetite: 25%) — no kata assigned yet
        3. #231 agent context [collapsed into #229]
        4. #232 session detection (appetite: 15%) — no kata assigned yet

        I'd suggest assigning research-deep to #229 since it needs architecture
        work, and bugfix-ts to #232 since it's mostly detective work. Thoughts?

User: Sounds good. Let's kiai it.
Claude: Starting Cycle 2. Preparing all bets...
        [calls kata kiai cycle ... --prepare --json]
        3 runs prepared. Spawning teammates now.
        ...
```

The sensei acts as a conversational interface to the kata system — reading
live state, presenting options, accepting natural language commands, and
driving the full cycle lifecycle without the user ever needing to type a
kata CLI command directly.

---

## What the sensei skill needs

### 1. State reading protocol

The sensei needs a "check state" reflex — a set of kata CLI commands it runs
at key moments to ground its understanding in real data:

| When | What to run | Why |
|------|-------------|-----|
| Session start (or first kata intent) | `kata cycle status --json` | Learn current cycle, bets, progress |
| User asks about bets/roadmap | `kata cycle kadai --json` | List bets with status, appetite, assignments |
| Before launching cycle | `kata kiai cycle <id> --prepare --json` | Get prepared runs (bridge, #229) |
| During cycle (periodic or on ask) | `kata kiai cycle <id> --status --json` | Aggregate agent progress |
| After cycle | `kata cooldown --prepare --json` | Prepare cooldown data |
| On demand | `kata status --json` | Project-level overview (belt, config) |

The key design choice: **the sensei reads state via CLI commands (not by
parsing `.kata/` files directly)**. This keeps the sensei skill decoupled
from the file format and uses the same interface a human would.

### 2. Intent recognition vocabulary

The sensei needs to map natural language (English and Japanese) to kata
operations:

| User says (examples) | Intent | Kata command(s) |
|---|---|---|
| "what keiko/cycle are we on?" | Check cycle status | `kata cycle status --json` |
| "what kadai/bets do we have?" | List bets | `kata cycle kadai --json` |
| "let's kiai / launch / start" | Start cycle execution | `kata kiai cycle <id> --prepare --json` |
| "where are things at?" | Check progress | `kata kiai cycle <id> --status --json` |
| "let's do ma / cooldown" | Start cooldown | `kata cooldown --prepare` |
| "what's our belt / how are we doing?" | Project status | `kata status --json` |
| "add a bet / kadai for X" | Add bet to cycle | `kata cycle add-bet ...` |
| "assign research-deep to bet 1" | Assign kata | `kata cycle update-bet ...` |
| "what's on the roadmap?" | Show roadmap | Read `docs/dogfooding-roadmap.md` or `.kata/` proposals |

The vocabulary table from the system guide (Section 11) is the canonical
mapping. The sensei skill should reference it, not duplicate it.

### 3. Session phase awareness

The sensei's behavior should adapt based on where the user is in the cycle
lifecycle:

```
┌─────────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐
│  Planning   │ →  │  Launch  │ →  │ Execution │ →  │  Close   │ →  │ Cooldown │
│             │    │          │    │           │    │          │    │          │
│ Read state  │    │ Prepare  │    │ Monitor   │    │ Complete │    │ Reflect  │
│ Discuss     │    │ Confirm  │    │ Surface   │    │ Summarize│    │ Diary    │
│ Assign kata │    │ Spawn    │    │ gates     │    │ Report   │    │ Learn    │
└─────────────┘    └──────────┘    └───────────┘    └──────────┘    └──────────┘
```

**Planning phase**: Sensei reads state, presents options, helps user pick bets
and assign kata. Conversational, exploratory. The sensei suggests but the user
decides.

**Launch phase**: Sensei runs `--prepare`, shows the user what's about to
happen (which agents, which isolation mode, which gates). Waits for explicit
confirmation before spawning agents.

**Execution phase**: Sensei monitors progress, surfaces human approval gates
proactively, answers "where are things at?" with real data. Sensei checks
for stalled agents (no kansatsu in >N minutes) and flags them.

**Close phase**: All agents done. Sensei runs `--complete`, presents cycle
summary (duration, tokens, artifacts, bet outcomes). Asks if user is ready
for cooldown.

**Cooldown phase**: Runs the deterministic cooldown process, then opens the
diary conversation. Captures human observations, logs Claude's own perspective.
Extracts learnings. Files issues for anything that went wrong.

The phase is **implicit** — the sensei infers it from `.kata/` state (is there
an active cycle? are runs in progress? are all runs complete?). It doesn't
need the user to say "we're in the execution phase."

### 4. Proactive surfacing

The sensei should not wait to be asked. It should proactively surface:

- **Human approval gates**: When an agent sets a `human-approved` gate, the
  sensei should notice (via status check) and surface it: "Agent working on
  bet 2 hit a gate that needs your approval. Here's the context..."

- **Budget warnings**: When token usage approaches the cycle's appetite, warn
  the user: "We've used 85% of the cycle budget with 2 bets remaining."

- **Stalled execution**: If an agent hasn't written a kansatsu in a while,
  flag it: "The agent working on bet 3 hasn't reported in 10 minutes. Want
  me to check on it?"

- **Gate violations**: If an agent completes a stage but the exit gate
  condition isn't satisfied, catch it at the boundary: "Bet 1's build stage
  completed but the required test-report artifact wasn't recorded."

### 5. Cooldown + diary integration

After cycle close, the sensei guides the cooldown and diary flow:

1. `kata cooldown --prepare` — deterministic data gathering.
2. Present cooldown summary to user (stats, outcomes, proposals).
3. Open diary conversation:
   - Ask user about their experience ("How did this cycle feel? Any friction?")
   - Log human perspective entry via `kata dojo diary record --perspective human`
   - Log Claude's perspective via `kata dojo diary record --perspective claude`
4. Learning extraction — review proposed learnings, promote/archive.
5. Issue filing — surface anything that went wrong as potential roadmap items.
6. `kata cooldown --complete` — finalize proposals for next cycle.

---

## Where this lives

The sensei skill is a **markdown file** loaded by Claude Code's skill system.
It lives at `skill/kata-sensei.md` (already exists). #230 expands this file
significantly.

This is NOT TypeScript code. It's LLM instructions. The sensei reads state
by calling kata CLI commands via the Bash tool and interprets the JSON output.
The intelligence is in the prompt engineering, not in new TypeScript services.

The only new TypeScript needed is:
- The bridge commands from #229 (`--prepare`, `--status`, `--complete`), which
  the sensei calls
- Potentially a `kata status --json` command if one doesn't exist (needs
  verification)

Everything else is sensei skill instructions telling Claude how to behave.

---

## Scope boundary

**In scope:**
- Rewriting `skill/kata-sensei.md` to include state reading, intent mapping,
  phase awareness, proactive surfacing, and cooldown/diary integration
- Adding any missing `--json` output formats to existing CLI commands the
  sensei needs
- Testing the conversational flow end-to-end (manual, not automated)

**Out of scope:**
- The bridge infrastructure (#229) — sensei calls it but doesn't build it
- Session context detection (#232) — startup/activation is separate
- New TypeScript services for the sensei — it's a skill file, not code
- Automated intent classification — the sensei uses Claude's native language
  understanding, not a classifier

---

## Rabbit holes to avoid

1. **Don't build an NLU system.** Claude already understands natural language.
   The skill file just needs to tell Claude which kata commands map to which
   intents. Claude handles the fuzzy matching.

2. **Don't make the sensei parse `.kata/` files directly.** Use CLI commands
   with `--json` output. This decouples the skill from the file format and
   makes it testable (you can verify CLI output, not file parsing).

3. **Don't try to make the sensei handle every edge case.** Start with the
   happy path (planning → launch → execute → close → cooldown). Handle
   error cases as they surface in dogfooding.

4. **Don't duplicate the lexicon.** The system guide (Section 11) is the
   canonical vocabulary table. The sensei skill should reference it, not
   maintain its own copy.

5. **Don't over-specify the diary conversation.** The diary is inherently
   freeform — it's a conversation about how the cycle went. Give the sensei
   guidelines (ask about friction, observations, what surprised you) but
   don't script a rigid interview.

---

## Dependency analysis

```
#229 (Bridge)                    #230 (This — Sensei State)
  ├─ kata kiai --prepare           ├─ kata cycle status --json      (exists)
  ├─ kata kiai --status            ├─ kata cycle kadai --json       (exists)
  ├─ kata kiai --complete          ├─ kata status --json            (verify)
  └─ formatAgentContext            ├─ kata cooldown --prepare       (exists)
       │                           ├─ kata dojo diary record        (exists)
       │                           └─ Calls bridge commands ←──────── depends
       │                                                              on #229
       └───────────────────────────────────────────────────────────────┘

#232 (Session Detection)
  ├─ Detect .kata/ presence
  ├─ Detect .claude/worktrees/
  └─ Sensei activation trigger  ←── feeds into #230's phase detection
```

**#230 can be shaped and partially built in parallel with #229.** The state
reading protocol (cycle status, bet listing) uses existing CLI commands. The
cycle execution commands (`--prepare`, `--status`, `--complete`) depend on
#229.

**Recommended sequence:**
1. Shape both #229 and #230 now (this document)
2. Implement #229 bridge infrastructure first
3. Implement #230 sensei skill rewrite — the non-bridge parts can start
   immediately (state reading, intent mapping, phase detection)
4. Wire #230 to #229 bridge commands once they exist
5. #232 can be done anytime (small, independent)

---

## Related

- Current sensei skill: `skill/kata-sensei.md`
- Bridge Frame (#229): `docs/cycle-2/229-claude-native-adapter-frame.md`
- Sensei orchestration doc: `docs/sensei-orchestration.md`
- System guide lexicon (Section 11): `docs/kata-system-guide.md`
- Cycle-as-a-Team design: `memory/cycle-as-team-design.md`
- Dogfooding roadmap: `docs/dogfooding-roadmap.md`
