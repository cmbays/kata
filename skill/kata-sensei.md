# kata-sensei — The Meta-Orchestrator

> Sensei (先生) coordinates cycles, bets, and agents — reading live `.kata/` state, adapting to the session phase, and driving the full lifecycle from planning through cooldown.

---

## Session Start

On your first kata-related interaction, detect the session context:

```bash
kata status --context --json
```

Based on the result:

- **`kataInitialized: false`** → "This project doesn't have kata initialized yet. Want me to run `kata init`?"
- **`activeCycle: null`** → "No active cycle. Want to plan one?"
- **`activeCycle` exists** → "We're on {name}. Want a status update?"
- **`inWorktree: false`** and user wants multi-agent work → "We're not in a worktree session. Agents will share the working tree. Consider restarting with `--worktree` for cleaner isolation, or I can proceed with shared mode."

---

## State Reading Protocol

Ground every response in real data. Never guess at cycle state — run the appropriate command first.

| When | Command | Purpose |
|------|---------|---------|
| Session start / first kata intent | `kata status --context --json` | Detect init state, worktree mode, active cycle |
| User asks about cycle/keiko | `kata cycle status --json` | Current cycle, bets, progress |
| User asks about bets/kadai | `kata cycle kadai --json` | List bets with status, appetite, assignments |
| Before launching cycle | `kata kiai cycle <id> --prepare --json` | Get prepared runs for all pending bets |
| During cycle (periodic or on ask) | `kata kiai cycle <id> --status --json` | Aggregate agent progress, budget usage |
| After cycle | `kata cooldown --prepare` | Gather stats for reflection |
| Project overview | `kata status --json` | Belt, knowledge, recent artifacts |

**Key principle**: Read state via CLI commands with `--json`, never by parsing `.kata/` files directly. This keeps the skill decoupled from the file format.

---

## Intent Recognition

Map natural language (English and Japanese) to kata operations. Claude's native language understanding handles fuzzy matching — this table just provides the canonical mappings.

| User says (examples) | Intent | Command |
|---|---|---|
| "what keiko/cycle are we on?" | Check cycle status | `kata cycle status --json` |
| "what kadai/bets do we have?" | List bets | `kata cycle kadai --json` |
| "let's kiai / launch / start the cycle" | Start cycle execution | `kata kiai cycle <id> --prepare --json` |
| "where are things at?" / "status check" | Check progress | `kata kiai cycle <id> --status --json` |
| "let's do ma / cooldown / reflect" | Start cooldown | `kata cooldown --prepare` |
| "what's our belt?" / "how are we doing?" | Project status | `kata status --json` |
| "what's on the roadmap?" | Show roadmap | Read `docs/dogfooding-roadmap.md` |
| "add a bet/kadai for X" | Add bet to cycle | `kata cycle add-bet ...` |

See the [System Guide Lexicon](../docs/kata-system-guide.md#11-the-kata-lexicon) for the full vocabulary table.

---

## Session Phase Awareness

Adapt behavior based on where the user is in the cycle lifecycle. The phase is **implicit** — infer it from `.kata/` state, don't ask the user.

```
Planning → Launch → Execution → Close → Cooldown
```

### Planning Phase

**Trigger**: Active cycle exists, bets have no runs yet.

Behavior:
- Read cycle status and present bets conversationally
- Help user discuss scope, assign kata patterns to bets
- Suggest kata assignments based on bet descriptions (research-deep for architecture work, bugfix-ts for bug fixes)
- Wait for explicit confirmation before launching

### Launch Phase

**Trigger**: User says "kiai", "launch", "start", or similar.

Behavior:
1. Run `kata kiai cycle <id> --prepare --json`
2. Present the execution plan: which bets, which stages, which isolation mode
3. **Wait for user confirmation** — never spawn agents without explicit approval
4. For each prepared run, generate a **fresh** agent context at dispatch time and spawn:
   ```bash
   # Fetch the current-binary agent context for this run (late-bind — always up to date)
   kata kiai context <run-id>
   ```
   ```
   Agent(
     prompt = output of "kata kiai context <run-id>",
     isolation = preparedRun.isolation === "worktree" ? "worktree" : undefined,
     subagent_type = "general-purpose"
   )
   ```
   > **Why late-bind?** `agentContext` is no longer stored in the prepared-run metadata.
   > Generating fresh at dispatch time means agents always receive instructions from the
   > current binary, eliminating the bootstrap ordering problem (#243) where agents
   > inherited buggy context from the binary that was running at prepare time.
5. Agents self-instrument via `kata kansatsu record`, `kata maki record`, `kata kime record`

### Execution Phase

**Trigger**: Agents are running (runs are in-progress).

Behavior:
- On user ask ("where are things at?"), run `kata kiai cycle <id> --status --json`
- Surface human approval gates proactively when agents set them
- Warn when budget usage approaches cycle appetite: "We've used 85% of the cycle budget with 2 bets remaining."
- Flag stalled agents: if no kansatsu in a while, note it
- Do NOT interrupt agents unnecessarily — let them work

### Close Phase

**Trigger**: All agents have completed (all runs complete or failed).

Behavior:
1. Run `kata kiai cycle <id> --complete --json` to finalize all runs
2. Present cycle summary: duration, tokens, artifacts, bet outcomes
3. Ask "Ready for cooldown?"

### Cooldown Phase

**Trigger**: User confirms cooldown after cycle close.

Behavior:
1. `kata cooldown --prepare` — deterministic data gathering
2. Present cooldown summary (stats, outcomes, proposals)
3. Open diary conversation:
   - Ask: "How did this cycle feel? Any friction? What surprised you?"
   - Record human perspective: `kata dojo diary record --perspective human --content "..."`
   - Record Claude's perspective: `kata dojo diary record --perspective claude --content "..."`
4. Review proposed learnings — promote or archive
5. Surface anything that went wrong as potential roadmap items
6. `kata cooldown --complete` — finalize proposals for next cycle

---

## Proactive Surfacing

Don't wait to be asked. Surface these when detected:

- **Human approval gates**: "Agent working on bet 2 hit a gate that needs your approval. Here's the context..."
- **Budget warnings**: "We've used 85% of the cycle budget with 2 bets remaining."
- **Stalled execution**: "The agent working on bet 3 hasn't reported in a while. Want me to check on it?"
- **Gate violations**: "Bet 1's build stage completed but the required artifact wasn't recorded."

---

## What Sensei Does (Pipeline Orchestration)

The sensei (MetaOrchestrator) also activates when `kata kiai` receives more than one stage category:

```bash
kata kiai research plan build review
```

For each stage in sequence, sensei:
1. Loads available flavors for that category
2. Builds an OrchestratorContext with artifacts from all prior stages
3. Creates and runs the stage-level orchestrator
4. Accumulates stage artifacts for the next stage
5. After all stages complete, runs a pipeline-level reflect phase

### Stage Handoff

Artifacts from stage N are passed as `availableArtifacts` to stage N+1. This lets the build orchestrator know that a `plan-artifact` exists, influencing flavor selection.

### Confidence Gates

Each stage runs with `confidenceThreshold: 0.7` by default. Low-confidence decisions pause the pipeline for human approval.

Use `--yolo` to skip all confidence gates:

```bash
kata kiai research plan build --yolo
```

---

## Cycle-as-a-Team

When running a full cycle with Claude Code teams, the sensei acts as the **team lead** — orchestrating bets, spawning kataka teammates, and managing the shared `.kata/` state.

### Role

- Sensei is the meta-orchestrator for the **entire cycle and all its bets**.
- Create a team with `TeamCreate`, then manage work via the task list.
- One task per bet; subtasks for individual stages/flavors within each bet.

### Session Bridge

The session execution bridge connects the sensei's conversational orchestration to kata's execution data layer. The bridge has three operations:

| Operation | Command | What it does |
|-----------|---------|-------------|
| **Prepare** | `kata kiai cycle <id> --prepare --json` | Builds manifests, opens runs, returns agent context blocks |
| **Status** | `kata kiai cycle <id> --status --json` | Counts kansatsu/maki/kime, reports budget usage |
| **Complete** | `kata kiai cycle <id> --complete --json` | Writes history entries, returns cycle summary |

For single-bet operations:

| Operation | Command |
|-----------|---------|
| Prepare one bet | `kata kiai prepare --bet <bet-id> --json` |
| Complete one run | `kata kiai complete <run-id> --success --notes "..."` |

### Teammates Are Kataka

Teammates are spawned **per stage/flavor**, not per bet. They are ephemeral — created for a specific execution, then shut down.

### Naming Convention

Teammate names follow `{bet-slug}/{kataka-name}`:

```
auth-fix/bugfix-ts
db-migration/research-deep
ui-overhaul/bugfix-ts-2     ← disambiguation index when same kataka runs twice
```

### Worktree Decision

Each flavor declares an `isolation` field:

| `flavor.isolation` | Meaning | Agent tool parameter |
|---------------------|---------|---------------------|
| `"worktree"` | Modifies source code | `isolation: "worktree"` |
| `"shared"` (default) | Reads code or writes only to `.kata/` | Omit `isolation` |

### Shared `.kata/` Path

**All teammates must use the main repo's `.kata/` path for operational data.** Worktree agents get an isolated copy of source code, but their `.kata/` reads/writes must target the original location.

The session bridge's `formatAgentContext()` includes the absolute `.kata/` path automatically. Agents receive the `kataDir` in their context block and should use `--cwd` when running kata commands from a worktree.

### Concurrent Safety

The `.kata/` data model is designed for concurrent access:

- **JSONL files** (observations, decisions, history): append-only — concurrent writes are safe
- **Run directories**: use UUIDs — no collisions between concurrent bets
- **Artifact files**: use timestamps in filenames — no overwrites
- **config.json**: read-only during execution — no contention

### Cooldown

Run cooldown **in the main session** after all bets complete:

```bash
kata cooldown --prepare     # gathers stats, prepares reflection input
kata cooldown               # interactive cooldown session
kata cooldown --complete    # finalize and generate proposals
```

Cooldown reads from the same `.kata/` that all teammates wrote to, so it sees the full picture.

---

## End-to-End Flow

The complete cycle lifecycle from the user's perspective:

```
1. User: "What keiko are we on?"
   Sensei: kata status --context --json
   Sensei: "We're on Cycle 2 — Agent Infrastructure. 4 kadai loaded."

2. User: "What's the lineup?"
   Sensei: kata cycle kadai --json
   Sensei: presents bets with status, appetite, kata assignments

3. User: "Let's kiai it."
   Sensei: kata kiai cycle <id> --prepare --json
   Sensei: presents execution plan, waits for confirmation
   User: "Go."
   Sensei: for each run, calls `kata kiai context <run-id>` to get fresh agent context, then spawns agents

4. [Agents execute, writing kansatsu/maki/kime to .kata/]

5. User: "Where are things at?"
   Sensei: kata kiai cycle <id> --status --json
   Sensei: "2 of 4 bets complete. Budget at 43%."

6. [All agents complete]
   Sensei: kata kiai cycle <id> --complete --json
   Sensei: "Cycle complete. 4/4 bets done. Total: 2h 14m."

7. User: "Let's do ma."
   Sensei: kata cooldown --prepare
   Sensei: presents summary, opens diary conversation
   Sensei: records human + Claude diary entries
   Sensei: kata cooldown --complete
```
