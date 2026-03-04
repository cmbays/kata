# San-Sō (三層) — Context Strata

> A framework for managing agent context by durability. The counterpart to San-Ma (三間), which organizes what your project *stores* — San-Sō governs what gets *loaded* into every agent turn.

---

## The Problem

Every file you put in always-injected context costs tokens on every single message — whether you need it or not. As projects mature, context files accumulate: architectural notes, lexicons, vision docs, workflow shortcuts, open issues. Eventually you're paying to re-read project history when you just want to fix a bug.

The root cause: not all knowledge has the same durability. Injecting everything the same way treats a permanent architectural rule the same as a temporary working note. They shouldn't be in the same place.

---

## Three Strata

Adapted from Ars Contexta's three-space model (Heinrich, 2026), applied to agent context injection.

### Stratum 1: Self (shin 心)

> "Who am I? How do I work?"

**Durability**: Permanent. Changes only through deliberate methodology evolution, not during normal sessions.

**Load pattern**: Always injected. Every session, no exception.

**Content**: Identity, behavioral rules, project-level non-negotiables, build commands, architectural constraints, path conventions.

**Test**: Would a brand-new session fail without this? If yes — it's self.

**Files**: `CLAUDE.md` (global + project), global tool preferences, core workflow rules.

**Signs you've put knowledge-tier content here**: The file is over 150 lines. It contains summaries of docs that already exist elsewhere. It describes things that rarely change and never affect behavior mid-session.

---

### Stratum 2: Knowledge (chi 智)

> "What have we learned? Where do I look?"

**Durability**: Stable. Grows over time, queried on demand.

**Load pattern**: Not auto-injected. Read explicitly when the current task touches that domain.

**Content**: CLI lexicons, architectural deep-dives, design decisions, vision docs, roadmaps, tool-suite overviews, reference tables.

**Test**: Do I need this right now, or just when working on a specific thing? If "just when..." — it's knowledge.

**Files**: Topic files in the memory directory (`memory/lexicon.md`, `memory/tool-suite.md`), project docs (`docs/`), vision docs (`docs/vision/`).

**Pattern**: `MEMORY.md` holds a **reference map** — a pointer table to knowledge files — rather than inlining their content. When a topic is needed, read the file directly.

---

### Stratum 3: Ops (do 動)

> "What's happening right now?"

**Durability**: Temporal. Valid for roughly one session to one cycle. Decays aggressively.

**Load pattern**: Auto-injected (via `MEMORY.md`), but kept ruthlessly thin.

**Content**: Current cycle state, immediate open issues, recent decisions from the last session, active workflow shortcuts, what was done last time.

**Test**: Will this still matter three sessions from now? If no — it's ops.

**Files**: `MEMORY.md` — the only always-injected file that changes frequently.

**Decay rule**: If something in `MEMORY.md` hasn't been relevant for two cycles, remove it. If it's worth keeping, promote it to a knowledge file or a project doc.

---

## The Reference Map Pattern

The key technique: `MEMORY.md` (ops) tells you *where* to find things rather than *what* they say.

```markdown
## Reference Map

| Topic | Location |
|-------|----------|
| CLI lexicon | `memory/lexicon.md` |
| Architecture vision | `docs/vision/three-space-architecture.md` |
| Dogfooding roadmap | `docs/dogfooding-roadmap.md` |
```

This keeps ops thin while making knowledge accessible. When you need the lexicon, you read `memory/lexicon.md`. You don't pay to re-read it on turns where you're just fixing a test.

---

## Applying to a Claude Code Project

### Always-Injected (self + ops)

```
~/.claude/CLAUDE.md          # Global: tools, git rules, identity
<project>/CLAUDE.md          # Project: what it is, commands, key rules
<project>/memory/MEMORY.md   # Current: state, issues, recent decisions, reference map
```

**Target sizes**: Global CLAUDE.md < 120 lines. Project CLAUDE.md < 80 lines. MEMORY.md < 80 lines.

### On-Demand (knowledge)

```
<project>/memory/lexicon.md       # CLI / domain vocabulary
<project>/memory/tool-suite.md    # Tool ecosystem overview
<project>/docs/vision/*.md        # Architecture visions
<project>/docs/*.md               # Reference documentation
```

Read these explicitly with the Read tool when the task touches that domain.

### What the codebase provides for free

You don't need to summarize in context what you can read from source:
- Service API surfaces → read the source files
- Domain model schemas → read `src/domain/types/`
- CLI command structure → read `src/cli/commands/`
- Test patterns → read adjacent test files

Always prefer reading the actual source over maintaining a stale summary.

---

## Audit Checklist

Run this when a context file feels heavy:

**For each section in CLAUDE.md or MEMORY.md, ask:**

1. **Self or not?** Would a fresh session break without this? If no, it doesn't belong in CLAUDE.md.
2. **Ops or knowledge?** Does this change session-to-session, or is it stable reference? Stable → topic file.
3. **Exists elsewhere?** Is this a summary of a doc that already exists in `docs/`? Remove the summary, add a pointer.
4. **Readable from source?** Is this a list of methods or file paths that I could just read from the codebase? Remove it.
5. **Still current?** Is this reflecting the actual state, or what was true two keikos ago? Update or remove.

**Target: every line in MEMORY.md should answer "what's happening right now." Everything else has a home elsewhere.**

---

## Relationship to San-Ma (三間)

San-Ma organizes what your project **stores** in `.kata/`:
- `self/` — identity and methodology
- `knowledge/` — accumulated wisdom
- `ops/` — active execution data

San-Sō governs what gets **loaded** into agent context each turn. The two frameworks mirror each other:

| San-Ma (storage) | San-Sō (context injection) |
|------------------|---------------------------|
| `self/` — permanent project identity | `CLAUDE.md` — always-injected rules |
| `knowledge/` — durable learnings | Topic files — read on demand |
| `ops/` — temporal execution data | `MEMORY.md` — thin working state |

A well-structured project applies both: San-Ma to how it stores knowledge between cycles, San-Sō to how it loads context within a session.

---

## Naming

- **San (三)** = three
- **Sō (層)** = stratum, layer — geological depth metaphor: bedrock (self), sediment (knowledge), surface (ops)
- Complements **San-Ma (三間)**: Ma (間) = space/interval; Sō (層) = stratum/depth

*"Structure prevents accumulation. Accumulation prevents thinking."*
