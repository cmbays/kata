# Review Stage — Bug Fix Verification

## Purpose

Lightweight verification of a bug fix. Confirm the root cause analysis is sound, the fix is minimal and correct, and regression tests adequately prevent recurrence. This is not a full code review — it is a focused quality gate for bug fixes.

## Expected Inputs

- **bugfix-output** artifact from the Build stage
- Access to the code changes (diff)
- The original bug report or issue

## Process

### Check 1: Root Cause Assessment

- [ ] The root cause identified in `bugfix-output` is the actual defect, not a symptom
- [ ] The explanation is specific — names the exact logic error, missing condition, or incorrect behavior
- [ ] The reproduction path is clear and verifiable
- [ ] If the root cause is in shared/foundational code, downstream impact has been considered

### Check 2: Fix Assessment

- [ ] The fix is **minimal** — no unrelated changes, refactors, or "improvements"
- [ ] The fix addresses the root cause, not just the symptom
- [ ] The fix follows existing codebase patterns (no new abstractions introduced for a bug fix)
- [ ] No `any` types, `// @ts-ignore`, or suppressed errors introduced
- [ ] Type safety is maintained — `npx tsc --noEmit` passes
- [ ] Build is clean — `npm run build` passes
- [ ] All existing tests still pass

### Check 3: Regression Test Assessment

- [ ] At least one new test exists that fails without the fix and passes with it
- [ ] The test covers the specific trigger condition from the bug report
- [ ] Boundary conditions are tested if the bug was a boundary error
- [ ] Tests are in the right location (colocated with the source file being tested)
- [ ] Test names clearly describe the bug being prevented

## Gate Decision

| Decision | Criteria |
|----------|----------|
| **PASS** | All three checks pass. Fix is sound, minimal, and well-tested. |
| **PASS_WITH_NOTES** | Fix is correct but has minor observations (e.g., related bug noticed, test could be stronger). Proceed, file follow-ups. |
| **NEEDS_FIXES** | Root cause is wrong, fix is incomplete, or regression tests are missing/inadequate. Return to build. |

## Output Format

Produce a **bugfix-verification** artifact:

```markdown
# Bug Fix Verification: [Brief description]

## Gate Decision: [PASS / PASS_WITH_NOTES / NEEDS_FIXES]

## Root Cause Assessment
- **Sound**: [Yes/No]
- **Notes**: [Any observations about the root cause analysis]

## Fix Assessment
- **Minimal**: [Yes/No]
- **Correct**: [Yes/No]
- **Notes**: [Any observations about the fix]

## Regression Test Assessment
- **Adequate**: [Yes/No]
- **Coverage**: [What conditions are tested]
- **Notes**: [Any observations about test quality]

## Follow-Up Items
- [Any related issues, improvements, or observations for future work]
```
