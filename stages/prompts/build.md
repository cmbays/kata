# Build Stage

## Purpose

Execute the implementation work defined in the plan. Produce working code, comprehensive tests, and any required documentation. The build stage transforms design decisions into tangible, tested software.

## Expected Inputs

- **implementation-plan** artifact from the Planning stage
- Specific session/task assignment from the plan
- Access to the project codebase
- Knowledge of the tech stack and project conventions

## Process

### Step 1: Read and Understand the Assignment

Before writing any code:

1. **Read the implementation plan**: Understand the overall structure, your session's place in it
2. **Read the specific task**: Files to create/modify, steps, acceptance criteria
3. **Read referenced documentation**: Breadboard, shaping doc, project conventions
4. **Identify dependencies**: What must exist before you start? Is it in place?
5. **Understand the scope boundary**: What is in scope and what is NOT

### Step 2: Set Up the Work Environment

1. **Verify prerequisites**: Dependencies from prior waves/sessions are merged and available
2. **Create a feature branch** or use the assigned worktree
3. **Confirm test infrastructure**: Tests can run, linting works
4. **Review existing patterns**: Look at similar code in the codebase for conventions

### Step 3: Implement in Order

Follow the plan's step order. For each step:

1. **Write tests first** (when feasible): Define expected behavior before implementing
2. **Implement the feature**: Follow project conventions (types, naming, file structure)
3. **Run tests continuously**: Verify each step before moving to the next
4. **Keep commits atomic**: One logical change per commit with descriptive messages

### Step 4: Code Quality Checklist

Before considering the build complete:

**Functionality**:
- [ ] All acceptance criteria from the plan are met
- [ ] Edge cases are handled (empty inputs, errors, boundary conditions)
- [ ] Error messages are clear and actionable

**Testing**:
- [ ] Unit tests cover all public functions/methods
- [ ] Tests cover happy path and error cases
- [ ] Tests are colocated with source files (`.test.ts` next to `.ts`)
- [ ] All tests pass (`npm test`)

**Code Quality**:
- [ ] TypeScript strict mode passes — no `any` types
- [ ] No unused imports, variables, or parameters
- [ ] Functions have clear names describing what they do
- [ ] Complex logic has comments explaining WHY (not WHAT)
- [ ] No hardcoded values that should be configurable

**Architecture**:
- [ ] Dependencies flow in the correct direction (domain has zero external deps)
- [ ] No circular imports
- [ ] Interfaces/types are used for external boundaries
- [ ] Side effects are isolated and injectable

### Step 5: Document Implementation Notes

Before finalizing:

1. **Architecture decisions**: Document any decisions made during implementation
2. **Trade-offs**: What was traded off and why
3. **Deferred work**: Anything explicitly left for future sessions
4. **Blockers discovered**: Issues that may affect downstream sessions

### Step 6: Verify and Commit

1. **Run full test suite**: `npm test` must pass
2. **Run type checking**: `npm run typecheck` must pass
3. **Run linting**: `npm run lint` must pass (if configured)
4. **Review your own changes**: Read through the diff as if reviewing someone else's code
5. **Commit with clear message**: Describe the what and why

## Output Format

Produce a **build-output** artifact summarizing what was built:

```markdown
# Build Output: [Session/Task Name]

## What Was Built
- [Component/feature 1]: [Brief description]
- [Component/feature 2]: [Brief description]

## Files Created/Modified
- `path/to/file.ts` — [What this file does]
- `path/to/file.test.ts` — [What these tests cover]

## Tests
- [X] tests passing
- Coverage: [X]% for new code

## Acceptance Criteria Status
- [x] [Criterion 1]
- [x] [Criterion 2]
- [ ] [Criterion not met — explanation]

## Architecture Decisions
- [Decision]: [Rationale]

## Deferred Work
- [Item]: [Why deferred, suggested approach]

## Notes
[Any important context for reviewers or downstream sessions]
```

## Quality Criteria

The build is complete when:

- [ ] All acceptance criteria from the plan are met
- [ ] All tests pass with reasonable coverage (80%+ for new code)
- [ ] TypeScript strict mode passes with no errors
- [ ] Code follows project conventions and patterns
- [ ] No secrets, credentials, or sensitive data in the code
- [ ] Build output artifact documents what was done
- [ ] Changes are committed with clear, descriptive messages
- [ ] The code is ready for review (not a rough draft)
