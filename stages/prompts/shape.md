# Shaping Stage

## Purpose

Define the solution space by articulating requirements, proposing solution shapes, and selecting the best approach. Shaping bridges the gap between "we understand the problem" (research + interviews) and "we know what to build" (breadboard + plan). It constrains scope with appetite and boundaries.

This stage follows the Shape Up methodology: shape the work before betting on it.

## Expected Inputs

- **interview-notes** artifact from the Interview stage
- **research-summary** from the Research stage (for reference)
- Any existing domain knowledge or constraints

## Process

### Step 1: Extract Requirements

From the interview notes and research, formulate requirements:

1. **List all candidate requirements** using the R-notation:
   - `R0`: Core goal (the fundamental problem being solved)
   - `R1`, `R2`, ... : Specific requirements
2. **Classify each requirement**:
   - **Core goal**: The fundamental problem being solved
   - **Must-have**: Required for the solution to succeed
   - **Nice-to-have**: Valuable but can be cut if needed
   - **Out**: Explicitly excluded from scope
3. **Show full requirement text** in a table — never abbreviate

| ID | Requirement | Status |
|----|------------|--------|
| R0 | [Core goal] | Core goal |
| R1 | [Requirement] | Must-have |
| R2 | [Requirement] | Nice-to-have |

### Step 2: Design Solution Shapes

Propose 1-3 solution shapes (labeled A, B, C):

1. **Each shape describes mechanisms** — what we build or change, not intentions
2. **Break shapes into parts** (A1, A2, A3...):
   - Parts should be vertical slices, not horizontal layers
   - Each part describes a concrete mechanism
   - Extract shared logic into standalone parts
3. **Avoid tautologies** — if R says "users can X" and S says "we let users X", the part is not adding information. S must describe HOW.
4. **Include architecture sketch** for each shape

### Step 3: Evaluate with Fit Check

For each shape, evaluate against every requirement:

| Req | Requirement | A | B |
|-----|------------|---|---|
| R0 | [Full text] | Pass/Fail | Pass/Fail |
| R1 | [Full text] | Pass/Fail | Pass/Fail |

**Fit check rules**:
- Binary only: Pass or Fail (no partial credit)
- Notes explain failures only
- Flagged unknowns count as failures
- If a shape passes all checks but feels wrong, articulate the implicit constraint as a new R

### Step 4: Identify Rabbit Holes and Risks

For the selected shape:

1. **Rabbit holes**: Areas where scope could expand dangerously. Define explicit boundaries.
2. **Risks**: Technical or design risks with mitigation strategies
3. **Unknowns requiring spikes**: If any component has unknowable complexity, flag it for a spike

### Step 5: Set Appetite

Define the appetite (time/effort budget) for this shape:

1. **Size**: Small (1-2 sessions), Medium (3-5 sessions), Large (5+ sessions)
2. **Boundaries**: What is in scope and what is explicitly out
3. **Fixed time, variable scope**: If appetite is consumed, cut scope rather than extending time

### Step 6: Select and Document

Select the winning shape and document the full decision:

1. **Selected shape** with rationale
2. **Decision log**: Key decisions made during shaping with reasoning
3. **Open questions**: Anything needing spike resolution before breadboarding

## Output Format

Produce a **shaping-doc** artifact with this structure:

```markdown
# Shaping: [Feature/Project Name]

## Requirements (R)

| ID | Requirement | Status |
|----|------------|--------|
| R0 | ... | Core goal |
| R1 | ... | Must-have |

### R0: [Core goal detail]
[Expanded description]

### R1: [Requirement detail]
[Expanded description]

## Shape A: [Name]

### Parts

| Part | Mechanism | Flag |
|------|-----------|------|
| A1 | [What we build/change] | |
| A2 | [What we build/change] | |

### Architecture
[High-level architecture description or diagram]

## Shape B: [Name] (if applicable)
[Same structure as A]

## Fit Check

| Req | Requirement | A | B |
|-----|------------|---|---|
| R0 | [Full text] | Pass | Pass |

**Selected shape: [A/B]**

## Rabbit Holes
- [Area to avoid with explicit boundary]

## Appetite
- **Size**: [Small/Medium/Large]
- **Boundaries**: [What is in/out]

## Decision Points
| # | Decision | Resolution | Reasoning |
|---|---------|-----------|-----------|
| D1 | ... | ... | ... |

## Open Questions
- [Questions for spikes or further investigation]
```

## Quality Criteria

The shaping is complete when:

- [ ] All requirements are listed with clear status classifications
- [ ] At least one solution shape is fully defined with parts
- [ ] Parts describe mechanisms (HOW), not intentions (WHAT)
- [ ] Fit check evaluates every requirement against every shape
- [ ] Rabbit holes are identified with explicit boundaries
- [ ] Appetite is set with clear scope boundaries
- [ ] Decision points are logged with reasoning
- [ ] The document is detailed enough for breadboarding without re-shaping
- [ ] No flagged unknowns remain unaddressed (either resolved or marked for spike)
