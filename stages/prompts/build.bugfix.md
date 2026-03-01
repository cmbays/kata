# Build Stage — Bug Fix

## Purpose

Reproduce, diagnose, and fix a bug in a TypeScript codebase. Produce a minimal, correct fix with regression tests that prevent recurrence. No scope creep — fix the bug, nothing else.

## Process

### Step 1: Reproduce

1. **Read the bug report** — understand the expected vs actual behavior
2. **Find a reproduction path** — write a failing test or identify the exact command/input that triggers the bug
3. **Confirm the failure** — run the reproduction and verify it fails as described
4. If you cannot reproduce, document why and stop — don't guess-fix

### Step 2: Diagnose Root Cause

1. **Trace the execution path** — follow the code from the trigger point to the failure
2. **Identify the root cause** — not the symptom, the actual defect (wrong logic, missing condition, incorrect type, stale state, etc.)
3. **Understand the blast radius** — what else depends on the broken code? Could the fix affect other behavior?
4. **Check for related bugs** — is this a pattern that occurs elsewhere? (Don't fix them now — note them for follow-up)

### Step 3: Fix

1. **Make the minimal change** that corrects the root cause
2. **Follow existing patterns** in the codebase — don't introduce new abstractions for a bug fix
3. **Run `npx tsc --noEmit`** after the fix — no type errors
4. **Run `npm test`** — all existing tests must still pass

### Step 4: Regression Tests

1. **Write at least one test** that fails without the fix and passes with it
2. **Cover the specific trigger condition** from the bug report
3. **Cover boundary conditions** if the bug was a boundary error
4. **Run the full test suite** — `npm test` must exit 0

### Step 5: Build Verification

Before finalizing:

- [ ] `npm run build` exits 0
- [ ] `npx tsc --noEmit` exits 0 — no type errors
- [ ] `npm test` — all tests pass (old and new)
- [ ] The reproduction from Step 1 no longer fails
- [ ] No unrelated changes in the diff

### Step 6: Document

Produce a `bugfix-output` artifact:

```markdown
# Bug Fix: [Brief description]

## Bug
- **Reported behavior**: [What was wrong]
- **Expected behavior**: [What should happen]
- **Reproduction**: [How to trigger it]

## Root Cause
[What was actually broken and why]

## Fix Applied
- `path/to/file.ts` — [What changed and why]

## Regression Tests
- `path/to/test.ts` — [What the test covers]

## Build Verification
- `npm run build`: 0 errors
- `npx tsc --noEmit`: 0 type errors
- `npm test`: X tests passing

## Related Issues
- [Any related bugs noticed but NOT fixed in this change]
```

## Anti-Patterns

- **Symptom-fixing**: Adding a null check where the real problem is that the value should never be null. Trace deeper.
- **Scope creep**: Refactoring adjacent code, adding features, or "improving" code near the bug. A bug fix is a bug fix.
- **Missing regression tests**: Every fix must have a test that would have caught the bug. No exceptions.
- **Shotgun debugging**: Changing multiple things at once hoping one works. Diagnose first, then make one targeted change.
- **Fixing related bugs**: Note them in "Related Issues" and file separate tickets. One fix per change.
