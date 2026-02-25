# Synthesis Format — Stage Synthesis Structure

> A synthesis artifact summarizes a completed stage and provides a handoff to the next stage.
> Write it as `synthesis.md` and record it with `kata artifact record --type synthesis`.

---

## When to Write a Synthesis

After all flavors in a stage have completed, the **bet teammate** (not a flavor sub-agent) writes the stage synthesis. It:

1. Reads artifacts from all completed flavors
2. Reads flavor-level synthesis files if present
3. Combines key findings into a single coherent document
4. Records it as a synthesis artifact

---

## Synthesis File Structure

```markdown
# <Stage Name> Synthesis — <Bet Name>

**Run**: <run-id>
**Stage**: <category>
**Flavors executed**: <flavor-1>, <flavor-2>
**Completed at**: <ISO 8601 timestamp>

---

## Summary

[2–4 sentences capturing the most important finding of this stage. What did we learn or produce?]

---

## Key Findings

### <Flavor 1 Name>
- Finding 1
- Finding 2
- [Reference artifacts: see `stages/research/flavors/web-standards/artifacts/oauth2-analysis.md`]

### <Flavor 2 Name>
- Finding 1
- [Reference artifacts as needed]

---

## Gaps Identified

[List any coverage gaps the orchestrator found during this stage. If none, write "None identified."]

- Gap 1 (severity: low/medium/high): description
- Gap 2: description

---

## Handoff Notes for Next Stage

[What does the next stage need to know? What constraints, decisions, or facts from this stage should inform the next one?]

- Constraint 1: [e.g., "OAuth2 library only supports authorization code flow, not PKCE — next stage must account for this"]
- Fact 2: [e.g., "Existing session middleware uses express-session v2; any auth additions must be compatible"]

---

## Artifact Index

| Artifact | Flavor | Step | Summary |
|----------|--------|------|---------|
| `oauth2-analysis.md` | web-standards | analyze | OAuth2 spec notes and PKCE gap analysis |
| `existing-auth-map.md` | internal-docs | scan | Map of current auth middleware and session handling |
```

---

## Example: Research Stage Synthesis

```markdown
# Research Synthesis — Add OAuth2 Login Flow

**Run**: 7c9e6679-7425-40de-944b-e07fc1f90ae7
**Stage**: research
**Flavors executed**: web-standards, internal-docs
**Completed at**: 2026-02-25T11:30:00Z

---

## Summary

Research confirmed that the project uses Passport.js with a local strategy and express-session for session management. The OAuth2 RFC requires PKCE for public clients, but the existing Passport.js version (0.6.0) does not natively support PKCE — this is the critical constraint for the plan stage.

---

## Key Findings

### web-standards
- OAuth2 authorization code flow with PKCE is the current best practice for web clients
- Token expiry handling requires refresh token rotation or re-authentication prompt
- CSRF protection via state parameter is mandatory

### internal-docs
- `passport` v0.6.0 is installed; PKCE requires `passport-oauth2` >= 1.7.0 or a manual implementation
- Session store is in-memory (MemoryStore) — not suitable for production; Redis store exists in `packages/cache`
- Existing `/auth/login` route uses local strategy; `/auth/logout` exists and works correctly

---

## Gaps Identified

- Gap (severity: medium): No load testing or rate limiting on auth endpoints — should add in review stage
- Gap (severity: low): No documentation of the current auth flow exists

---

## Handoff Notes for Next Stage

- **Critical**: `passport-oauth2` must be upgraded or PKCE must be implemented manually. Evaluate in plan stage.
- **Redis session store**: Switch from MemoryStore to Redis (already in packages/cache) before OAuth2 can go to production.
- **Existing logout works**: Do not rewrite `/auth/logout` — extend it for OAuth2 token revocation only.

---

## Artifact Index

| Artifact | Flavor | Step | Summary |
|----------|--------|------|---------|
| `oauth2-spec-notes.md` | web-standards | analyze | Key OAuth2 RFC requirements and PKCE flow diagram |
| `existing-auth-map.md` | internal-docs | scan | Annotated map of current auth code and dependencies |
```

---

## Recording the Synthesis

```bash
# Write the synthesis to a temp file first
cat > /tmp/research-synthesis.md << 'EOF'
[synthesis content]
EOF

# Record it
kata artifact record "$RUN_ID" \
  --stage research \
  --flavor web-standards \
  --file /tmp/research-synthesis.md \
  --summary "Research synthesis: OAuth2 spec + existing auth analysis" \
  --type synthesis
```

The `--type synthesis` flag ensures the file is stored as `synthesis.md` in the flavor directory and indexed as a synthesis artifact. The `priorStageSyntheses` field in subsequent `kata step next --json` calls will include a path to this file.
