# Test Stage

## Purpose

Verify that the build works correctly and won't regress. Design and execute a test strategy that covers the full pyramid — unit, integration, and E2E — and produces objective evidence that the implementation meets its acceptance criteria.

Testing is not a formality. It is the only way to know the software actually works and will continue to work as the codebase grows.

## Expected Inputs

- **build-output** artifact from the Build stage
- The implementation plan (acceptance criteria)
- The breadboard or design artifact (intended behavior)
- Existing test suite (for coverage baseline)

## Process

### Step 1: Understand What to Test

Before writing a single test:

1. **Read the build-output artifact**: What was built? What changed?
2. **Read the implementation plan**: What are the explicit acceptance criteria?
3. **Identify the risk surface**: Which parts of the change are most likely to break?
4. **Check existing coverage**: What's already tested? Where are the gaps?

Do not start testing without understanding the intent. Tests written without context test the wrong things.

### Step 2: Design the Test Strategy

Choose the right test types for the change:

#### Test Pyramid Guidance

| Layer | Test Type | What It Covers | Speed | Quantity |
|-------|-----------|----------------|-------|----------|
| Foundation | **Unit** | Pure functions, isolated logic, edge cases | Fast | Many |
| Middle | **Integration** | Module interactions, data flows, adapter behavior | Medium | Some |
| Top | **E2E / Acceptance** | Full user journey, system behavior end-to-end | Slow | Few |

Bias toward unit tests. Each unit test should test one thing, fail for one reason, and have a name that reads as documentation.

#### When to Write Each Type

- **Unit**: Always. New functions, branches, error paths, edge cases.
- **Integration**: When modules interact in non-trivial ways. DB access, file I/O, service composition.
- **E2E**: When user flows need end-to-end verification. Don't over-index — keep these few and stable.

### Step 3: Write Tests — TDD Discipline

Even if the code is already written (post-build), approach testing with TDD discipline:

1. **Read the acceptance criteria** as a specification
2. **Write the test first** that proves the criterion is met
3. **Run it** to confirm it passes (and would fail with wrong behavior)
4. **Name it clearly**: `it('returns empty array when no stages match filter')` not `it('works')`

#### Test Quality Checklist

For each test:
- [ ] Tests one behavior, not multiple
- [ ] Name describes the scenario, not the implementation
- [ ] Has clear Arrange / Act / Assert structure (even if not labeled)
- [ ] Fails for the right reason when the code is broken
- [ ] Does not test implementation details (don't assert on internals)
- [ ] Uses realistic test data (not magic strings like `"test"` or `123`)
- [ ] Does not depend on order of execution
- [ ] Is isolated (no shared mutable state between tests)

### Step 4: Execute the Test Suite

Run the full test suite. Do not skip tests.

```bash
npm test              # Full run
npm run test:coverage # With coverage report
```

If tests fail:
1. **Understand the failure** — read the assertion message fully
2. **Reproduce it in isolation** — can you make it fail without the full suite?
3. **Fix the code or the test** — never skip or comment out a failing test without understanding why

### Step 5: Measure Coverage

Coverage is a floor, not a ceiling. Meet coverage thresholds — but also ask: "Are the right things covered?"

#### Coverage Dimensions

| Metric | Minimum | Target |
|--------|---------|--------|
| Statement coverage | 80% | 90%+ |
| Branch coverage | 75% | 85%+ |
| Function coverage | 80% | 90%+ |
| Line coverage | 80% | 90%+ |

#### Coverage Gap Analysis

For any file below threshold:
1. Identify which lines/branches are uncovered
2. Determine why — is the code untested or untestable?
3. Add tests for meaningful uncovered paths
4. Mark truly untestable code with `/* c8 ignore */` only if it's genuinely unreachable (not as a shortcut)

Do not chase 100% coverage by adding trivial tests. Chase meaningful coverage of real risk.

### Step 6: Identify and Fill Gaps

After the initial run, explicitly look for test gaps:

#### Common Gap Patterns

- **Happy path only**: Tests pass valid input but not invalid/malformed input
- **No error path tests**: Functions that throw or return errors have no tests for those cases
- **No boundary tests**: Off-by-one, empty collections, single-element collections
- **Integration seams untested**: Code that calls external modules has no integration test
- **Concurrency untested**: Async code tested only in series

For each gap found:
1. Write a test that would catch the bug if the gap were a real defect
2. Confirm it fails before the fix, passes after

### Step 7: Document Results

Produce the test-plan and coverage-report artifacts.

## Output Format

### test-plan artifact

```markdown
# Test Plan: [Feature/Task Name]

## Strategy

- **Approach**: [Unit-heavy / Integration-focused / Mixed]
- **Risk areas**: [Which parts need the most attention]
- **New test files**: [List files created]
- **Modified test files**: [List files updated]

## Test Cases

### Unit Tests
| Test | File | Scenario | Status |
|------|------|----------|--------|
| [Test name] | [file.test.ts] | [What it verifies] | PASS / FAIL |

### Integration Tests
| Test | File | Scenario | Status |
|------|------|----------|--------|

### E2E Tests
| Test | File | Scenario | Status |
|------|------|----------|--------|

## Acceptance Criteria Verification
- [x] [Criterion met — test name that proves it]
- [ ] [Criterion not met — reason]

## Gaps Identified
- [Remaining gap and why it's acceptable or planned follow-up]
```

### coverage-report artifact

```markdown
# Coverage Report: [Feature/Task Name]

## Summary

| Metric | Before | After | Threshold | Status |
|--------|--------|-------|-----------|--------|
| Statements | X% | Y% | 80% | PASS / FAIL |
| Branches | X% | Y% | 75% | PASS / FAIL |
| Functions | X% | Y% | 80% | PASS / FAIL |
| Lines | X% | Y% | 80% | PASS / FAIL |

## Total Test Count

- **Before**: [N] tests
- **After**: [N] tests
- **New tests added**: [N]

## Files Below Threshold

| File | Statements | Branches | Functions | Gap Analysis |
|------|-----------|----------|-----------|--------------|

## Files Improved

| File | Before | After | Change |
|------|--------|-------|--------|

## Gate Decision

**[PASS / FAIL]** — [one-sentence rationale]
```

## Quality Criteria

The test stage is complete when:

- [ ] All tests in the full suite pass
- [ ] Coverage thresholds are met (80%/75%/80%/80%)
- [ ] All acceptance criteria have at least one corresponding test
- [ ] Error paths and edge cases are covered, not just happy paths
- [ ] test-plan artifact is produced with full scenario documentation
- [ ] coverage-report artifact shows before/after metrics
- [ ] No tests are skipped without documented reason
- [ ] New tests follow the naming and structure conventions of the existing suite
