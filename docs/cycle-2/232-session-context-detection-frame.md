---
shaping: true
---

# Session Context Detection — Frame

**Issue:** #232
**Date:** 2026-03-02
**Status:** Draft

---

## Source

> A Claude session can be launched in multiple ways — with `--worktree`, without
> it, in a kata-initialized project or not. The sensei needs to know which mode
> it's in to adapt behavior: whether to suggest `kata init`, whether to warn
> about shared-state conflicts when spawning agents, and whether worktree
> isolation is available.

---

## Problem

The sensei skill has no startup awareness. It doesn't check whether `.kata/`
exists, what cycle is active, or whether the session is running inside a
worktree. It treats every session the same, leading to confusing errors when
the user hasn't initialized kata, or missed isolation opportunities when
worktrees are available.

---

## Outcome

On first kata-related interaction, the sensei detects the session context and
adapts:

| Context | Detection | Sensei behavior |
|---------|-----------|-----------------|
| `.kata/` missing | `!existsSync('.kata/')` | Suggest `kata init` before proceeding |
| `.kata/` present, no active cycle | `kata cycle status` returns no active | Suggest planning a cycle |
| `.kata/` present, active cycle | `kata cycle status` returns active | Resume cycle (offer status, launch, continue) |
| `.claude/worktrees/` present | Inside a worktree session | Note worktree mode; agents can use sub-worktrees safely |
| Plain session (no worktree) | No `.claude/worktrees/` in CWD parents | Warn before multi-agent spawning (shared state) |

---

## Shape

This is small enough to not need a full architectural analysis. It's a
**CLI utility function + sensei skill instructions**.

### Implementation

A single function in `src/shared/lib/session-context.ts`:

```typescript
export interface SessionContext {
  kataInitialized: boolean;
  kataDir: string | null;
  inWorktree: boolean;
  activeCycle: { id: string; name: string } | null;
}

export function detectSessionContext(cwd?: string): SessionContext
```

Detection logic:
1. Walk up from CWD looking for `.kata/` directory → `kataInitialized`, `kataDir`
2. Check if CWD is inside a git worktree (`git rev-parse --is-inside-work-tree`
   + check for `.git` file vs directory) → `inWorktree`
3. If kata initialized, read `.kata/config.json` for active cycle → `activeCycle`

### CLI surface

```bash
kata status --context --json
→ { kataInitialized: true, inWorktree: false, activeCycle: { id: "...", name: "Cycle 2" } }
```

Adds a `--context` flag to the existing `kata status` command. The sensei
calls this on startup.

### Sensei skill integration

Add a "Session Start" section to `skill/kata-sensei.md`:

```markdown
## Session Start

On your first kata-related interaction, run `kata status --context --json`.
Based on the result:

- If `kataInitialized: false` → "This project doesn't have kata initialized
  yet. Want me to run `kata init`?"
- If `activeCycle: null` → "No active cycle. Want to plan one?"
- If `activeCycle` exists → "We're on {name}. Want a status update?"
- If `inWorktree: false` and user wants multi-agent work → "We're not in a
  worktree session. Agents will share the working tree. Consider restarting
  with `--worktree` for cleaner isolation, or I can proceed with shared mode."
```

---

## Rabbit holes

- Don't build an auto-activation hook system. The sensei checks context on
  first interaction, not on every tool call.
- Don't gate execution on worktree mode. Shared mode works fine for most
  tasks. Just inform the user of the tradeoff.

---

## Related

- Bridge Frame (#229): `docs/cycle-2/229-claude-native-adapter-frame.md`
- Sensei Frame (#230): `docs/cycle-2/230-sensei-state-awareness-frame.md`
