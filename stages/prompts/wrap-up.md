# Wrap-Up Stage

## Purpose

Retrospective and knowledge capture. Synthesize what was learned during the pipeline run, extract patterns worth preserving, update documentation, and propose improvements for future cycles. The wrap-up stage closes the feedback loop that makes the methodology self-improving.

## Expected Inputs

- **review-findings** artifact from the Review stage
- All artifacts produced during the pipeline run
- Execution history (timing, token usage, outcomes per stage)
- Any learnings captured during individual stages

## Process

### Step 1: Harvest

Gather all raw material from the pipeline run:

1. **Artifacts produced**: List every artifact created, its quality, and completeness
2. **Stage execution history**: How long each stage took, any gate failures or overrides
3. **Inline learnings**: Any learnings captured during stage execution
4. **Review findings**: Issues found, severity distribution, fix patterns
5. **Token/resource usage**: Budget utilization if tracked
6. **Blockers encountered**: What slowed down or blocked progress

### Step 2: Synthesize

Analyze the harvest and find patterns:

1. **What went well**: Stages or approaches that worked smoothly. Why?
2. **What was difficult**: Stages that required multiple attempts or overrides. Why?
3. **Process friction**: Where did the methodology itself create friction?
4. **Quality patterns**: What types of issues were found in review? Are they recurring?
5. **Estimation accuracy**: Did the plan's estimates match reality? Where were they off?
6. **Tool/technique effectiveness**: Which tools, prompts, or approaches were most effective?

### Step 3: Extract Learnings

From the synthesis, propose concrete learnings:

For each proposed learning:

1. **Tier classification**:
   - **Tier 1 (Stage)**: Applies to all instances of a stage type. Auto-loaded on stage entry.
   - **Tier 2 (Category)**: Applies within a specific domain or flavor. Subscription-based loading.
   - **Tier 3 (Agent)**: Personal behavioral pattern for a specific agent/context.

2. **Category**: What knowledge domain does this learning belong to?

3. **Content**: The actual learning, written as an actionable instruction
   - Good: "Start research with competitor analysis before domain research to produce more structured findings"
   - Bad: "Research was good this time"

4. **Evidence**: What observations support this learning? (Reference specific stage outcomes)

5. **Confidence**: How certain are you? (Based on evidence count and consistency)
   - 1 observation: 0.3 confidence
   - 2 consistent observations: 0.5 confidence
   - 3+ consistent observations: 0.7+ confidence

### Step 4: Propose Improvements

Based on learnings, suggest concrete improvements:

1. **Prompt template updates**: Should any stage prompt be refined based on what was learned?
2. **Gate adjustments**: Should entry/exit gates be tightened or relaxed?
3. **Artifact schema changes**: Should artifact formats be updated?
4. **Stage ordering**: Would a different pipeline sequence work better?
5. **New stage flavors**: Should a specialized variant of a stage be created?

### Step 5: Update Documentation

Ensure project documentation reflects what was learned:

1. **Architecture decisions**: Document any decisions made during the pipeline
2. **Convention updates**: If new patterns emerged, document them
3. **Known issues**: Track any deferred work or known limitations
4. **Progress tracking**: Update project progress to reflect completed work

### Step 6: Forward Planning

Look ahead to the next cycle:

1. **What this pipeline unblocked**: What work is now possible?
2. **Recommended next steps**: What should be worked on next and why?
3. **Risk areas for next cycle**: Based on what was learned, what to watch out for
4. **Budget recommendation**: Based on actual usage, how much budget for similar work?

## Output Format

Produce a **wrap-up-summary** artifact:

```markdown
# Wrap-Up Summary: [Pipeline/Feature Name]

## Pipeline Overview
- **Pipeline type**: [vertical / bug-fix / spike / ...]
- **Duration**: [Total time from start to completion]
- **Stages completed**: [X of Y]
- **Gate overrides**: [Any stages where gates were skipped]

## Harvest
### Artifacts Produced
| Stage | Artifact | Quality | Notes |
|-------|----------|---------|-------|
| research | research-summary | Good | ... |

### Execution Timeline
| Stage | Duration | Gate Result | Notes |
|-------|----------|-------------|-------|
| research | ... | Pass | ... |

### Budget Utilization
[Token usage, time spent, vs budget if tracked]

## Synthesis
### What Went Well
1. [Observation with evidence]

### What Was Difficult
1. [Observation with evidence]

### Process Friction
1. [Where the methodology created friction]

### Quality Patterns
[Recurring patterns from review findings]

## Learnings

### Proposed Learnings
| # | Tier | Category | Learning | Confidence | Evidence |
|---|------|----------|---------|------------|---------|
| 1 | Stage | [cat] | [actionable instruction] | 0.X | [reference] |

### Proposed Improvements
| # | Type | Proposal | Rationale |
|---|------|----------|-----------|
| 1 | Prompt update | [what to change] | [why] |

## Forward Planning
### Unblocked Work
- [What is now possible]

### Recommended Next Steps
1. [Recommendation with rationale]

### Risk Areas
- [What to watch out for in the next cycle]

## Documentation Updates
- [List of docs updated during wrap-up]
```

## Quality Criteria

The wrap-up is complete when:

- [ ] All artifacts from the pipeline are accounted for
- [ ] Execution timeline is documented
- [ ] Both successes and difficulties are analyzed (not just one)
- [ ] At least 2-3 concrete learnings are proposed with evidence and confidence scores
- [ ] Learnings are actionable instructions, not vague observations
- [ ] At least one improvement proposal exists
- [ ] Forward planning identifies what was unblocked and recommends next steps
- [ ] Documentation is updated to reflect the pipeline's outcomes
- [ ] The summary is detailed enough for someone reviewing the project's history to understand what happened and what was learned
