---
description: CLI and cycle command conventions for kata.
paths:
  - "src/cli/**/*.ts"
  - "src/cli/**/*.test.ts"
---

- Keep Commander handlers thin. Push reusable parsing, selection, and formatting logic into direct helpers or lower layers when it improves testability.
- Nested commands that need global flags must use `optsWithGlobals()`, not `opts()`.
- `cycle new` requires a non-empty cycle name. Any path that prepares or launches a cycle must ensure the cycle has a real persisted name, not just an ID fallback.
- Preserve human-friendly reference resolution through `resolveRef`; avoid re-implementing cycle or bet lookup rules ad hoc.
- Command-level tests should focus on wiring, delegation, and user-facing error handling. Put pure parsing/formatting behavior in direct unit tests.
