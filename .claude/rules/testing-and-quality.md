---
description: Kata testing and quality-loop expectations.
paths:
  - "src/**/*.feature"
  - "src/**/*.steps.ts"
  - "src/**/*.test.ts"
  - "vitest*.ts"
  - "stryker.config.mjs"
  - "crap4ts.config.ts"
  - ".dependency-cruiser.cjs"
---

- New behavior or clarified behavior should get a co-located `.feature` when practical, and new step files must be imported through `src/acceptance/setup.ts`.
- Keep command tests focused on command wiring and terminal behavior; prefer direct tests for pure helpers and domain rules.
- For changed behavior-heavy code, run focused unit/integration/acceptance tests before broader quality gates.
- Mutation hardening should target meaningful business logic and orchestration seams, not help text or presentation-only literals.
- When ignoring or disabling mutation cases, keep the scope narrow and document why the survivor is acceptable.
