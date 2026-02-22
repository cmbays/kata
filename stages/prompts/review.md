# Review Stage

## Purpose

Quality gate for code and design artifacts. Systematically evaluate the build output for correctness, completeness, security, and adherence to project standards. The review catches issues before they reach users and produces a structured record of findings.

## Expected Inputs

- **build-output** artifact from the Build stage
- Access to the code changes (diff/PR)
- Project standards and conventions documentation
- Knowledge of the architecture and design decisions

## Process

### Step 1: Understand the Context

Before reviewing:

1. **Read the build output artifact**: Understand what was built and why
2. **Read the implementation plan**: Understand the intended scope
3. **Review the breadboard/shaping docs**: Understand the design intent
4. **Check acceptance criteria**: Know what "done" means for this work

### Step 2: Classify the Changes

Categorize the changes to determine review depth:

1. **Scope**: How many files changed? How many lines?
2. **Type**: New feature / Bug fix / Refactor / Infrastructure / Docs
3. **Risk areas**: Which domains are affected? (data model, security, UI, API)
4. **Complexity**: Simple/straightforward or complex/subtle?

### Step 3: Systematic Review

Review the changes systematically across these dimensions:

#### A. Correctness
- [ ] Does the code do what the plan/acceptance criteria specify?
- [ ] Are edge cases handled (null, empty, boundary values)?
- [ ] Are error paths handled gracefully with clear messages?
- [ ] Are race conditions or timing issues possible?
- [ ] Do calculations produce correct results?

#### B. Completeness
- [ ] Are all acceptance criteria met?
- [ ] Are tests comprehensive (happy path + error cases + edge cases)?
- [ ] Is error handling complete (not just try/catch with generic messages)?
- [ ] Are all TODO/FIXME items addressed or tracked?
- [ ] Is documentation updated where needed?

#### C. Architecture
- [ ] Do dependencies flow in the correct direction?
- [ ] Are interfaces used for external boundaries?
- [ ] Is there unnecessary coupling between modules?
- [ ] Are side effects isolated and injectable?
- [ ] Does the code follow established patterns in the codebase?

#### D. Code Quality
- [ ] Are names clear and descriptive?
- [ ] Is complex logic commented with WHY (not WHAT)?
- [ ] Are there code duplication opportunities to extract?
- [ ] Is the code readable by someone unfamiliar with it?
- [ ] Are types precise (no unnecessary `any` or overly broad types)?

#### E. Security
- [ ] No hardcoded secrets, tokens, or credentials
- [ ] Input validation is present where needed
- [ ] No SQL injection, XSS, or other injection vectors
- [ ] Sensitive data is not logged or exposed in errors
- [ ] File paths are validated (no path traversal)

#### F. Performance (where relevant)
- [ ] No obvious N+1 queries or unnecessary iterations
- [ ] Large data sets are paginated or streamed
- [ ] Expensive operations are not repeated unnecessarily
- [ ] Memory usage is reasonable (no unbounded growth)

### Step 4: Classify Findings

For each issue found, classify:

| Severity | Meaning | Action Required |
|----------|---------|-----------------|
| **Critical** | Blocks merge — correctness, security, or data integrity issue | Must fix before proceeding |
| **Major** | Should fix — significant quality, architecture, or completeness issue | Fix before merge |
| **Warning** | Should address — minor quality or style issue | Create issue for follow-up |
| **Info** | Observation — suggestion for improvement | Optional, no action required |

### Step 5: Gate Decision

Based on findings, determine the gate result:

- **PASS**: No findings, or info-only findings. Proceed.
- **PASS WITH WARNINGS**: Only warning/info findings. Proceed, create follow-up issues.
- **NEEDS FIXES**: Major findings present. Fix and re-review.
- **FAIL**: Critical findings present. Fix and re-review from scratch.

### Step 6: Communicate Findings

Present findings clearly with:
1. **File and line reference** for each finding
2. **Clear description** of the issue
3. **Suggested fix** or approach to resolution
4. **Severity classification** for prioritization

## Output Format

Produce a **review-findings** artifact:

```markdown
# Review Findings: [Build Session/Task Name]

## Summary
- **Gate Decision**: [PASS / PASS_WITH_WARNINGS / NEEDS_FIXES / FAIL]
- **Files Reviewed**: [count]
- **Findings**: [X critical, Y major, Z warning, W info]

## Change Classification
- **Scope**: [Files changed, lines added/removed]
- **Type**: [Feature / Bug fix / Refactor / ...]
- **Risk Areas**: [Domains affected]

## Findings

### Critical
| # | File | Line | Finding | Suggested Fix |
|---|------|------|---------|---------------|

### Major
| # | File | Line | Finding | Suggested Fix |
|---|------|------|---------|---------------|

### Warning
| # | File | Line | Finding | Suggested Fix |
|---|------|------|---------|---------------|

### Info
| # | File | Line | Finding | Suggested Fix |
|---|------|------|---------|---------------|

## Acceptance Criteria Verification
- [x] [Criterion met]
- [ ] [Criterion not met — finding #X]

## Architecture Assessment
[Brief assessment of architecture decisions]

## Recommendations
- [Recommendation for improvement]
```

## Quality Criteria

The review is complete when:

- [ ] All changed files have been reviewed
- [ ] All six review dimensions have been evaluated (correctness, completeness, architecture, quality, security, performance)
- [ ] Every finding has a severity, description, and suggested fix
- [ ] The gate decision is clearly stated with rationale
- [ ] Acceptance criteria are verified against the plan
- [ ] The review is objective and constructive (not nitpicking)
- [ ] Critical and major findings include actionable fix suggestions
