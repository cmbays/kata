# Deliver Research Step

## Purpose

Deliver the completed `research-summary` artifact to both Tankyu (knowledge graph) and Renshin (inbox).
This is a mechanical delivery step — do not add new research, revise findings, or summarize differently.
Deliver exactly what the research stage produced.

## Inputs

- `research-summary` artifact from this ryu's artifact directory
- `$KATA_PROJECT` — current project name (from environment or kata context)
- `$TANKYU_WEBHOOK_URL` — Tankyu webhook base URL (default: `http://127.0.0.1:2357`)
- `$RENSHIN_INBOX` — Renshin inbox directory (default: `~/Github/renshin/inbox`)

## Process

### Step 1: Read the research summary

Read the `research-summary` artifact. Do not modify it.

### Step 2: Deliver to Tankyu

POST the research to the Tankyu webhook server.

**Check if Tankyu is running first:**
```bash
curl -sf http://127.0.0.1:2357/health || echo "TANKYU_OFFLINE"
```

If `TANKYU_OFFLINE`: skip Tankyu delivery, note it in output, continue to Renshin.

**POST the report:**
```bash
curl -s -X POST http://127.0.0.1:2357/report \
  -H "Content-Type: application/json" \
  -d '{
    "title": "<research-summary title>",
    "content": "<full markdown content, JSON-escaped>",
    "project": "<KATA_PROJECT>",
    "topic": "<research topic>"
  }'
```

Expected response: `{ "ok": true, "entry_id": "...", "file_path": "..." }`

If the server returns an error, note it but do not fail the step — continue to Renshin.

### Step 3: Deliver to Renshin inbox

Write the research summary to Renshin's inbox using the Renshin provenance format.

**Filename:** `YYYY-MM-DD-<slugified-title>.md` — use today's date.

**Format:**
```markdown
---
description: <1-2 sentence summary of key findings from the research>
source_type: kata-research
kata_project: <KATA_PROJECT>
kata_ryu: <current ryu flavor name>
generated: <ISO 8601 timestamp — run: date -u +"%Y-%m-%dT%H:%M:%SZ">
domain: agentic-development
topics: ["[[Agentic Development]]"]
---

<full content of research-summary artifact, verbatim>
```

Write this file to `~/Github/renshin/inbox/` (expand `~` to the actual home directory).

### Step 4: Report delivery status

Output a clean summary:

```
Research delivered

  Tankyu:  entry_id abc123  (or: skipped — server offline)
  Renshin: ~/Github/renshin/inbox/2026-03-07-<slug>.md

  Next: /suiko ~/Github/renshin/inbox/<filename>
```

## Error handling

| Situation | Behavior |
|-----------|----------|
| Tankyu offline | Skip, note in output, continue |
| Tankyu returns error | Note error, continue to Renshin |
| Renshin inbox missing | Create it with `mkdir -p` |
| research-summary empty | Abort — entry gate should have caught this |

## What NOT to do

- Do not re-summarize or rewrite the research-summary
- Do not add commentary or framing beyond the provenance front matter
- Do not wait for Renshin `/suiko` to run — that's a separate session
- Do not block on Tankyu availability — it is optional infrastructure
