# doc-sync

Keep canonical documentation synchronized with the codebase. Detect drift, propose updates, and maintain docs as a living system that never lies.

## Trigger

Use after completing a step in IMPLEMENTATION_PLAN, when docs feel stale, or at the start of a new phase.

## Workflow

### 1. Identify Sync Scope

Determine what to check:

- **After a step**: Check docs related to what was built
- **Full audit**: Check all canonical docs against current codebase
- **Targeted**: Check specific doc flagged as potentially stale

### 2. Read Current State

For each canonical doc being checked, read:

1. The doc itself — note its "Last Verified" date
2. The relevant code it describes — compare reality to documentation
3. Other docs that cross-reference it — check for contradictions

### 3. Run Drift Detection

Use the checklist at `.claude/skills/doc-sync/checklists/drift-detection.md` to check each doc:

**APP_FLOW.md**:

- Every route in `app/(dashboard)/` has a corresponding entry
- Every screen's sections match the actual components rendered
- Navigation links in the doc match `<Link>` elements in code
- Breadcrumb trails match actual breadcrumb implementations
- Empty/error states documented match actual implementations

**IMPLEMENTATION_PLAN.md**:

- Completed steps are marked as done
- Step descriptions match what was actually built
- Dependencies between steps are still accurate
- Remaining steps are still relevant and correctly scoped

**TECH_STACK.md**:

- All dependencies in `package.json` are documented
- Version numbers match actual installed versions
- No documented dependencies have been removed
- No new dependencies were added without documentation

**PRD.md**:

- Feature acceptance criteria match implemented behavior
- No features were added that aren't in the PRD
- Feature status (planned/built/deferred) is accurate

**CLAUDE.md**:

- Commands section matches actual `package.json` scripts
- Architecture section matches actual file structure
- Design system tokens match `globals.css` `@theme inline` block
- Quality checklist is still accurate
- Lessons Learned section is current

**PROGRESS.md**:

- "What's Built" matches actual built screens
- "What's Next" matches IMPLEMENTATION_PLAN current step
- Session log entries are chronological and accurate

### 4. Compile Drift Report

```markdown
# Doc Sync Report — [Date]

## Docs Checked

- [List of docs checked with Last Verified dates]

## Drift Detected

### [Doc Name]

- **Line/Section**: [where the drift is]
- **Doc says**: [what the doc currently states]
- **Reality**: [what the code actually does]
- **Fix**: [exact edit to make the doc accurate]

## No Drift

- [Docs that are accurate]

## Cross-Reference Issues

- [Any contradictions between docs]

## Proposed Updates

[Numbered list of changes, ready for approval]
```

### 5. Apply Updates (After Approval)

- Update each doc with approved changes
- Update "Last Verified" date on each checked doc
- Log changes in `PROGRESS.md`

### 6. Output

```markdown
# Doc Sync Output — [Date]

## Summary

[1-2 sentences on sync status]

## Deliverables

- Drift report: agent-outputs/doc-sync-[date].md
- Docs updated: [list]

## Drift Found

- [N] docs had drift, [M] changes applied

## Next Step

[When to run doc-sync next — suggest milestone or date]
```

## Rules

- Do NOT modify code. You only read code and update docs.
- Do NOT add information to docs that doesn't come from the codebase — you reflect reality, you don't invent it.
- Do NOT overwrite docs without approval. Present drift report first.
- Every doc update must include "Last Verified: [date]" update.
- Cross-reference accuracy is as important as individual doc accuracy — if APP_FLOW references a route that IMPLEMENTATION_PLAN says isn't built yet, flag it.
- When in doubt, flag the discrepancy rather than making a judgment call.
