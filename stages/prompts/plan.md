# Planning Stage

## Purpose

Translate the breadboard into an executable implementation plan. Organize work into waves of parallel sessions, map dependencies, define task-level detail, and produce prompts that enable each session to execute independently.

The plan is the bridge between design (breadboard) and execution (build). A good plan makes building predictable; a bad plan forces mid-build re-planning.

## Expected Inputs

- **breadboard-doc** artifact from the Breadboarding stage
- **shaping-doc** from the Shaping stage (for scope/appetite reference)
- Knowledge of the project's tech stack, conventions, and existing codebase

## Process

### Step 1: Gather Context

Read and internalize:

1. **Breadboard document**: All places, affordances, wiring, and vertical slices
2. **Shaping document**: Requirements, selected shape, appetite, boundaries
3. **Project standards**: Tech stack, code conventions, testing requirements
4. **Existing codebase**: What already exists that can be reused or extended

### Step 2: Design Waves

Group work into waves following dependency principles:

1. **Wave 0: Foundation** (always serial, one session)
   - Schemas, types, shared utilities, mock data
   - Everything that other waves depend on
   - Must be merged before any other wave starts

2. **Wave 1+: Feature waves**
   - Sessions within a wave run in parallel (unless marked serial)
   - Dependencies flow forward: Wave N+1 depends on Wave N being merged
   - Each session should target non-overlapping files to avoid merge conflicts

**Dependency rules**:
- Schemas before UI components
- Shared components before vertical-specific ones
- Data layer before presentation layer
- Core features before edge cases
- Infrastructure before features that use it

### Step 3: Define Sessions

For each session in each wave, specify:

1. **Topic**: Kebab-case identifier (used for branch naming)
2. **Files to create/modify**: Explicit list of files this session touches
3. **Steps**: Numbered implementation steps with acceptance criteria
4. **Dependencies**: Which prior sessions must be merged first
5. **Estimated complexity**: Low / Medium / High

### Step 4: Write Session Prompts

Each session gets a self-contained prompt that enables execution without prior context:

1. **What to build**: Specific components, services, features
2. **What to read first**: Which docs provide necessary context
3. **What to produce**: Code, tests, documentation
4. **Quality criteria**: How to verify the session is complete
5. **Constraints**: What NOT to modify, boundaries to respect

Prompts must be self-contained: a fresh context with no prior knowledge should be able to execute the task from the prompt alone.

### Step 5: Map Dependencies and Identify Conflicts

1. **Dependency DAG**: Draw the dependency graph across all sessions
2. **Critical path**: Identify the longest sequential chain
3. **Conflict points**: Where might parallel sessions touch the same files?
4. **Resolution strategy**: How to handle potential merge conflicts

### Step 6: Validate the Plan

Before committing:

1. All session topics are unique across all waves
2. All dependency references point to real sessions
3. Wave 0 is serial (foundation work)
4. Session sizes are reasonable (completable in one context window)
5. Total effort aligns with the appetite from shaping
6. Every breadboard slice is covered by at least one session

## Output Format

Produce an **implementation-plan** artifact with this structure:

```markdown
# Implementation Plan: [Feature/Project Name]

**Goal:** [One sentence]
**Architecture:** [2-3 sentences]
**Tech Stack:** [Key technologies]
**Appetite:** [From shaping — Small/Medium/Large]

---

## Wave Structure

[ASCII or text diagram showing waves and dependencies]

## Wave 0: Foundation

### Task 0.1: [Session Name]

**Topic:** `kebab-case-topic`
**Depends on:** None
**Files:**
- [list of files to create/modify]

**Steps:**
1. [Step with acceptance criteria]
2. ...

**Acceptance:**
- [Verification criteria]

---

## Wave 1: [Wave Name]

### Task 1.1: [Session Name]

**Topic:** `kebab-case-topic`
**Depends on:** `foundation-topic`
**Files:**
- [list of files]

**Steps:**
1. ...

**Acceptance:**
- ...

### Task 1.2: [Session Name] (parallel with 1.1)

...

---

## Session Sizing

| Wave | Session | Estimated Complexity | Files |
|------|---------|---------------------|-------|
| W0 | ... | Medium | N files |

## Dependency DAG

[Text representation of dependency graph]

## Critical Path

[Longest sequential chain: W0 -> W1:X -> W2:Y -> ...]

## Merge Strategy

[How parallel sessions avoid conflicts]

## Notes

[Important context, caveats, decisions]
```

## Quality Criteria

The plan is complete when:

- [ ] Every breadboard vertical slice is assigned to at least one session
- [ ] Wave 0 covers all foundational work (types, shared utilities)
- [ ] Dependencies are explicit and acyclic
- [ ] Each session has a clear, self-contained prompt
- [ ] File ownership is clear (no two parallel sessions modifying the same file)
- [ ] Session sizes are reasonable (not too large for one context window)
- [ ] Total estimated effort aligns with the appetite
- [ ] Critical path is identified
- [ ] Merge strategy addresses potential conflicts
- [ ] The plan is detailed enough to begin building without re-planning
