# Deliver Research Step

## Purpose

Deliver the completed `research-summary` artifact to Tankyu and Renshin using the global `/send-research` skill.
This step is a thin wrapper — all delivery logic lives in the skill.

## Process

1. Read the `research-summary` artifact from this ryu's artifact directory
2. Invoke the `/send-research` skill:

```text
/send-research "<research-summary title>" --topic "<research topic>" --project "<KATA_PROJECT>"
```

Pass the full content of the `research-summary` artifact as the research content.

The skill handles:
- Tankyu webhook POST (graceful skip if server is offline)
- Renshin inbox file write with provenance front matter
- Delivery status output

## What NOT to do

- Do not re-summarize or rewrite the research-summary before passing it to the skill
- Do not implement delivery logic directly — use the skill
- Do not block if Tankyu is unavailable — the skill handles this
