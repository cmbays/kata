---
description: Domain and execution-bridge architecture guardrails.
paths:
  - "src/domain/**/*.ts"
  - "src/features/cycle-management/**/*.ts"
  - "src/infrastructure/execution/**/*.ts"
  - "src/infrastructure/persistence/bridge-run-store.ts"
---

# Execution Bridge and Cycles

- Respect the dependency direction documented in `CLAUDE.md`: domain logic belongs in domain services/rules, not in infrastructure coordinators.
- `SessionExecutionBridge` is a prepare/complete seam for agent dispatch, not a generic execution adapter. Keep it focused on orchestration and persistence coordination.
- Prefer extracting deterministic helpers from large orchestration files before adding more brittle side-effect-heavy tests.
- Historical reads may fall back from `cycle.name` to `cycle.id`, but new prepare/launch paths must persist a real cycle name.
- When adding bridge-run metadata, keep cycle and bet identity canonical so status, cooldown, and dojo flows can reconstruct context without extra IO.
