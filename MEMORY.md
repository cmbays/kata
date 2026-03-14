# MEMORY.md

## Key Paths

- Repo root: `/Users/cmbays/github/kata`
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
| Kata ops manifest | `/Users/cmbays/github/ops/products/kata/MANIFEST.md` |
| Org testing standard | `/Users/cmbays/github/ops/standards/testing.md` |
| Quality loop playbook | `/Users/cmbays/github/ops/playbooks/quality-loop.md` |
| Org security standard | `/Users/cmbays/github/ops/standards/security.md` |
| Cross-repo docs standard | `/Users/cmbays/github/ops/standards/cross-repo-docs.md` |
| AGENTS standard | `/Users/cmbays/github/ops/standards/agents-md.md` |
| Kata unified roadmap | `/Users/cmbays/github/ops/vision/kata/UNIFIED-ROADMAP.md` |
| Kata dogfooding roadmap | `/Users/cmbays/github/ops/vision/kata/DOGFOODING-ROADMAP.md` |
