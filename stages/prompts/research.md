# Research Stage

## Purpose

Investigate the problem space thoroughly before committing to any solution. Research produces the foundational understanding that every downstream stage depends on. Without good research, shaping is guesswork and building is rework.

## Expected Inputs

- A problem statement, feature request, or area of investigation
- Access to the codebase (if applicable)
- Access to web search for competitive and domain research
- Any existing documentation, issues, or prior art

## Process

### Step 1: Frame the Investigation

Before researching, articulate what you need to learn:

1. **Problem statement**: What problem are we solving? For whom? Why now?
2. **Key questions**: List 5-10 specific questions this research should answer
3. **Scope boundaries**: What is explicitly out of scope for this research?
4. **Success criteria**: How will you know the research is sufficient to proceed?

### Step 2: Domain Research

Investigate the problem domain:

1. **Existing solutions**: What tools, libraries, or approaches already exist?
2. **Industry patterns**: How do others solve this class of problem?
3. **Technical landscape**: What technologies, APIs, or platforms are relevant?
4. **Constraints**: What technical, business, or user constraints exist?
5. **Prior art in this codebase**: Has anything similar been built before? What can be reused?

### Step 3: Competitive Analysis

If applicable, analyze competing products or approaches:

1. **Feature inventory**: What features do competitors offer in this area?
2. **UX patterns**: How do they present this to users? What works well?
3. **Friction points**: Where do competitors fall short? What frustrates users?
4. **Differentiation opportunities**: Where can we be meaningfully better?

### Step 4: Technical Feasibility

Assess technical approaches:

1. **Architecture options**: What are 2-3 viable technical approaches?
2. **Trade-offs**: What does each approach trade off (complexity, performance, flexibility)?
3. **Dependencies**: What existing code, libraries, or services would each approach require?
4. **Risk areas**: Where are the unknowns? What might need a spike?

### Step 5: Synthesize Findings

Combine all research into a structured summary:

1. **Key findings**: Top 5-7 insights from the research
2. **Recommended approach**: Based on findings, which direction looks most promising?
3. **Open questions**: What remains unknown and needs further investigation?
4. **Risks and mitigations**: What could go wrong and how to reduce that risk?

## Output Format

Produce a **research-summary** artifact with the following structure:

```markdown
# Research Summary: [Topic]

## Problem Statement
[Clear articulation of the problem]

## Key Questions Investigated
1. [Question] — [Answer/Finding]
2. ...

## Domain Analysis
[Findings from domain research]

## Competitive Landscape
[Competitor analysis if applicable]

## Technical Feasibility
[Architecture options, trade-offs, dependencies]

## Key Findings
1. [Finding with supporting evidence]
2. ...

## Recommendation
[Recommended direction with rationale]

## Open Questions
- [Question that needs further investigation]

## Risks
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ...  | ...       | ...    | ...        |
```

## Quality Criteria

The research is complete when:

- [ ] Problem statement is clear and specific
- [ ] At least 5 key questions have been investigated and answered
- [ ] Multiple approaches have been considered (not just one)
- [ ] Competitive or comparable solutions have been reviewed
- [ ] Technical feasibility has been assessed with trade-offs documented
- [ ] A recommendation exists with supporting rationale
- [ ] Open questions are explicitly listed (not hidden)
- [ ] The summary is detailed enough for someone else to proceed to interviews/shaping without re-researching
