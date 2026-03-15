# AGENTS.md

## Mission

Kata is the development methodology engine CLI/runtime. It owns cycle orchestration, run persistence, knowledge capture, and agent execution plumbing. Private strategy, roadmaps, and product governance live in the `ops` repo; resolve those entry points from `MEMORY.md`.

## Primary Workflows

- Read `MEMORY.md` before any cross-repo or governance-heavy task.
- Build: `npm run build`
- Unit tests: `npm run test:unit`
- Integration tests: `npm run test:integration`
- Acceptance tests: `npm run test:acceptance`
- E2E tests: `npm run test:e2e`
- Quality loop:
  - Co-locate or update a `.feature` file for the behavior being added or clarified.
  - Drive implementation with unit/integration tests until acceptance scenarios pass.
  - Run `npm run test:coverage:unit && npm run test:crap`.
  - Run focused mutation testing on the changed behavior-heavy modules.
- Run `npm run lint && npm run test:arch`.
- Worktrees are mandatory for tracked-file edits. Start from `origin/main`, confirm the worktree/branch, and never work in the shared main checkout.

## Guardrails

- Follow the org testing and security standards referenced from `MEMORY.md`.
- Keep public/private boundaries intact. Public repo docs should not point at private `ops` paths directly.
- Prefer extracting pure helpers from CLI/orchestration files before adding more direct tests to large side-effect-heavy modules.
- Keep command-level tests focused on wiring and delegation; put parsing/formatting/selection behavior into direct unit tests.
- Co-locate `.feature` files with the feature they specify, and register their step files through `src/acceptance/setup.ts`.

## Quality Gates

- For new behavior or behavior clarification, acceptance scenarios exist and fail before implementation.
- Changed unit and integration tests pass locally.
- `npm run test:acceptance` passes.
- `npm run test:coverage:unit && npm run test:crap` passes for the changed slice.
- `npm run lint && npm run test:arch` passes.
- Focused mutation testing is run for the changed business logic or orchestration seam, with meaningful survivors called out explicitly.

## References

- Resolve `Kata ops manifest` from `MEMORY.md`.
- Resolve `Org testing standard` from `MEMORY.md`.
- Resolve `Quality loop playbook` from `MEMORY.md`.
- Resolve `Org security standard` from `MEMORY.md`.
