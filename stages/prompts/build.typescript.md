# Build Stage — TypeScript

## Purpose

Implement the planned work in a TypeScript codebase. Produce type-correct, tested code that compiles cleanly with `tsc` and bundles correctly with `tsup` (or `npm run build`). No `any` types, no compilation errors.

## TypeScript-Specific Guidance

### Type Safety

- All types must be explicit — avoid `any`. Use `unknown` when the type is genuinely unknown, then narrow with guards.
- Prefer `z.infer<typeof Schema>` (Zod) or `satisfies` over manual type declarations.
- Use discriminated unions for complex state: `{ status: 'success'; data: T } | { status: 'error'; message: string }`.
- Return types on public functions should be explicit, not inferred.

### ESM & Import Paths

- If the project uses `"type": "module"`, all internal imports need `.js` extensions (even for `.ts` source files).
- Never use `require()` in ESM projects. Use dynamic `import()` for conditional loading.

### tsconfig Discipline

- Never suppress errors with `// @ts-ignore` or `// @ts-expect-error` without a comment explaining why.
- `strict: true` must stay on. If the project has it, keep it.
- Check `paths` aliases in tsconfig — mirror them in the bundler config (tsup/vite/etc.) to avoid mismatches.

### Common Pitfalls

- **Circular imports**: TypeScript won't always warn you. Use `import type` for type-only imports to break cycles.
- **Missing `.js` extensions**: The most common ESM error. If build fails with "Cannot find module", check extensions first.
- **Zod v4 path**: If the project imports from `'zod/v4'`, use that path consistently — don't mix `'zod'` and `'zod/v4'` imports in the same project.
- **Declaration files**: If `declaration: true` is in tsconfig, check that `.d.ts` files are generated in the expected location.

## Process

### Step 1: Verify Prerequisites

1. Read the implementation plan — understand scope before touching code
2. Run `npm run build` to confirm the baseline builds (it should)
3. Run `npm test` to confirm tests pass before you start
4. Check what `tsconfig.json` has for `strict`, `paths`, and `moduleResolution`

### Step 2: Implement

Follow the plan's step order. For each step:

1. **Write tests first** (TDD where feasible)
2. Implement the feature following existing patterns in the codebase
3. Run `npx tsc --noEmit` after each meaningful change — fix errors immediately
4. Run `npm test` continuously

### Step 3: Build Verification Checklist

Before finalizing:

- [ ] `npm run build` exits 0 with no errors or warnings
- [ ] `npx tsc --noEmit` exits 0 with no type errors
- [ ] `npm test` — all tests pass
- [ ] No unused imports (`eslint` or `tsc` will catch these)
- [ ] No `any` types introduced (use `unknown` + type guards instead)
- [ ] Import paths use `.js` extension if project is ESM
- [ ] New public functions have explicit return types

### Step 4: Document

Produce a `build-output` artifact summarizing:

```markdown
# Build Output: [Session/Task Name]

## What Was Built
- [Component]: [Description]

## Files Created/Modified
- `path/to/file.ts` — [What it does]

## Tests
- [X] tests passing
- Coverage: [X]% for new code

## Build Verification
- `npm run build`: ✓ 0 errors
- `npx tsc --noEmit`: ✓ 0 type errors

## Acceptance Criteria Status
- [x] [Criterion 1]

## Architecture Decisions
- [Decision]: [Rationale]

## Deferred Work
- [Item]: [Why deferred]
```

