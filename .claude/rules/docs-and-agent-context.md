---
description: Public docs and agent-facing context rules.
paths:
  - "README.md"
  - "CLAUDE.md"
  - "AGENTS.md"
  - "MEMORY.md"
  - "docs-site/**/*.md"
  - ".claude/rules/**/*.md"
---

# Docs and Agent Context

- Public repo docs must not hardcode private `ops` repo paths; point readers to `MEMORY.md` for cross-repo registry entries.
- Be explicit about current reality versus target architecture. Do not present aspirational agent behavior as if it already exists.
- When repo conventions change, update both `CLAUDE.md` and the relevant scoped rule file in the same change.
- Keep agent-facing docs concrete: name the actual commands, lifecycle seams, and constraints that exist today.
