# Interview Stage

## Purpose

Gather firsthand user and stakeholder perspectives on the problem being solved. Interviews ground the shaping process in real needs rather than assumptions. They reveal workflows, pain points, priorities, and success criteria that research alone cannot surface.

## Expected Inputs

- **research-summary** artifact from the Research stage
- Access to stakeholders (users, product owners, domain experts)
- Context about the product/project being worked on

## Process

### Step 1: Prepare Interview Guide

Based on the research summary, prepare targeted questions:

1. **Review research findings**: Identify assumptions that need validation
2. **Draft question categories**:
   - **Workflow** (8-10 questions): "How do you currently do X? Walk me through a typical Y."
   - **Pain Points** (5-8 questions): "What is most frustrating about X? What takes too long?"
   - **Desired Features** (5-8 questions): "What do you wish X could do? What would save you the most time?"
   - **Interconnections** (3-5 questions): "How does X connect to other parts of your work?"
   - **Success Criteria** (3-5 questions): "How would you know the new version of X is better?"
3. **Prioritize questions**: Mark must-ask vs nice-to-have
4. **Prepare probing follow-ups**: For each category, prepare "tell me more" prompts

### Step 2: Conduct the Interview

Guidelines for effective interviewing:

1. **Open with context**: Brief explanation of what you are working on and why their input matters
2. **Start broad, then narrow**: Begin with open-ended workflow questions before diving into specifics
3. **Listen for the unsaid**: Pain points users have adapted to may not be mentioned directly
4. **Capture exact language**: When users describe problems, record their words (e.g., "It takes me 10 minutes per quote")
5. **Probe for severity**: For each pain point, ask: How often? How painful (1-10)? Current workaround?
6. **Ask about context**: What tools do they use alongside this? What information do they need at hand?
7. **End with priorities**: If you could fix one thing, what would it be?

### Step 3: Process Interview Notes

After the interview, structure the raw notes:

1. **Consolidate themes**: Group observations into themes (e.g., "Speed is the top priority", "Data entry is the bottleneck")
2. **Extract requirements**: Turn pain points and wishes into potential requirements
3. **Identify contradictions**: Note where different stakeholders disagree
4. **Map to research**: Connect interview findings to research findings — what confirms, what surprises
5. **Priority ranking**: Based on frequency and severity, rank the discovered needs

### Step 4: Validate with Research

Cross-reference interview findings against the research summary:

1. **Confirmed assumptions**: Research findings validated by interviews
2. **Surprising discoveries**: Things learned in interviews that research did not reveal
3. **Changed priorities**: Where interview data shifts what seemed important
4. **New questions**: Questions raised by the interview that need further investigation

## Output Format

Produce an **interview-notes** artifact with the following structure:

```markdown
# Interview Notes: [Topic/Stakeholder]

## Interview Details
- **Date**: [Date]
- **Participants**: [Who was interviewed]
- **Duration**: [How long]
- **Context**: [Brief description of what was discussed]

## Workflow Observations
[How the user currently works, step by step]

## Pain Points (Ranked by Severity)
| # | Pain Point | Severity (1-10) | Frequency | Current Workaround |
|---|-----------|-----------------|-----------|-------------------|
| 1 | ...       | ...             | ...       | ...               |

## Desired Features / Improvements
| # | Desire | Priority | Rationale |
|---|--------|----------|-----------|
| 1 | ...    | ...      | ...       |

## Key Quotes
- "[Exact user quote]" — regarding [context]
- ...

## Themes
1. **[Theme name]**: [Supporting observations]
2. ...

## Requirements Extracted
| # | Requirement | Source | Priority |
|---|------------|--------|----------|
| 1 | ...        | ...    | ...      |

## Cross-Reference with Research
- **Confirmed**: [What research got right]
- **Surprising**: [What was unexpected]
- **Changed**: [Where priorities shifted]

## Open Questions
- [Questions raised that need follow-up]
```

## Quality Criteria

The interview is complete when:

- [ ] At least one stakeholder has been interviewed (ideally 2-3)
- [ ] All five question categories have been covered (workflow, pain points, features, interconnections, success criteria)
- [ ] Pain points are ranked by severity and frequency
- [ ] Exact user quotes are captured (not paraphrased into generic statements)
- [ ] Themes are identified and supported by multiple observations
- [ ] Requirements have been extracted from the interview data
- [ ] Findings are cross-referenced against the research summary
- [ ] The notes are detailed enough for shaping without re-interviewing
