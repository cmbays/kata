# MEMORY.md

## Key Paths

- Repo root: `.` (this repository)
- Ops clone root: set `OPS_ROOT` to the absolute path of your local `ops` checkout.
- Shared agent guidance: `CLAUDE.md`, `AGENTS.md`, `MEMORY.md`
- Acceptance bootstrap: `src/acceptance/setup.ts`, `vitest.acceptance.config.ts`
- Gherkin pilot: `src/infrastructure/execution/session-bridge.feature`
- Quality configs: `crap4ts.config.ts`, `.dependency-cruiser.cjs`, `stryker.config.mjs`

## Operational Notes

- The `execute` helper extraction from issue `#375` is committed separately on branch `codex-execute-helper-phase1-20260314` at `543f300`. It should be reviewed and merged separately instead of stacking unrelated quality-loop bootstrap changes on top of it.
- `quickpickle` is the Vitest-native Gherkin runner in this repo. The older `@quickpickle/vitest` reference in ops notes is stale.
- `.feature` files are co-located with the feature they specify. Their step files are imported centrally from `src/acceptance/setup.ts`.

## Cross-Repo Registry

| Logical Name | Path |
|---|---|
| Kata ops manifest | `$OPS_ROOT/products/kata/MANIFEST.md` |
| Org testing standard | `$OPS_ROOT/standards/testing.md` |
| Quality loop playbook | `$OPS_ROOT/playbooks/quality-loop.md` |
| Org security standard | `$OPS_ROOT/standards/security.md` |
| Cross-repo docs standard | `$OPS_ROOT/standards/cross-repo-docs.md` |
| AGENTS standard | `$OPS_ROOT/standards/agents-md.md` |
| Kata unified roadmap | `$OPS_ROOT/vision/kata/UNIFIED-ROADMAP.md` |
| Kata dogfooding roadmap | `$OPS_ROOT/vision/kata/DOGFOODING-ROADMAP.md` |
